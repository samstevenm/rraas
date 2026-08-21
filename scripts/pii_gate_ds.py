#!/usr/bin/env python3
"""Regex PII gate for at.diligentservices.io profiles — non-LLM, fail-closed.

A profile must pass this gate before the builder (`build_atparty.py`) will
render it. The gate is a SAFETY CONTRACT, not a suggestion: any finding blocks
publication of the whole site (fail closed), so one dirty page can't slip out in
a batch.

It is tuned to catch the silly-mistake cases Sam named — a street address, a
birthday, a phone number — plus their obvious cousins, WITHOUT false-positiving
normal prose ("since 2009", "Southern California", a diligentservices.io email). It
is deliberately not a perfect DLP; it is a guardrail for a moderated family site
where a human (Sam) is always the one who publishes.

Usage:
    pii_gate_ds.py profiles/david.toml [more.toml ...]   # CLI: exit 1 if any finding
    from pii_gate_ds import check_profile, check_text     # importable

The CLI lets Sam pre-check a submission someone emailed him before he files it.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover - fallback for older interpreters
    import tomli as tomllib  # type: ignore


@dataclass(frozen=True)
class Finding:
    """One PII hit. `field` is where it was found, `match` is the offending
    substring, `hint` tells the person how to fix it."""

    rule: str
    field: str
    match: str
    hint: str

    def __str__(self) -> str:
        return f"[{self.rule}] in {self.field}: {self.match!r} — {self.hint}"


# --- detectors ---------------------------------------------------------------
# Each is (rule, compiled pattern, hint). Order is cosmetic; all run.

_STREET_TYPES = (
    r"st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|"
    r"way|pl|place|ter|terrace|cir|circle|hwy|highway|pkwy|parkway|apt|"
    r"suite|ste|unit"
)
# Common words that look like a street NAME slot but aren't — pronouns,
# articles, prepositions. "talked my way", "on the way", "found our way" must
# NOT read as addresses just because "way" is a street-type token.
_NOT_A_STREET_NAME = (
    r"my|your|our|his|her|their|its|the|a|an|this|that|these|those|no|any|"
    r"some|one|to|of|in|on|off|up|by|as|at|for"
)
# number, a street NAME (>=1 word, the last of which is a real name — not a
# pronoun/article), then a street-type token. "123 Main St", "456 North Oak
# Avenue", "12 Elm Ct" match; "Route 66 road trip" (number immediately before
# the type) and "2007 I talked my way" (pronoun before the type) do not.
_STREET = re.compile(
    rf"\b\d{{1,6}}\s+(?:[A-Za-z0-9.'\-]+\s+){{0,2}}"
    rf"(?!(?:{_NOT_A_STREET_NAME})\s)[A-Za-z][A-Za-z0-9.'\-]*\s+"
    rf"(?:{_STREET_TYPES})\b\.?",
    re.I,
)

# explicit birthday context near a date, OR a full numeric/textual date.
# A bare year ("since 2009") is allowed.
_DOB_CONTEXT = re.compile(
    r"\b(?:born|birth\s*day|birthday|d\.?o\.?b\.?|date\s+of\s+birth)\b"
    r"[^.\n]{0,24}?"
    r"(?:\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?"
    r"|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})",
    re.I,
)
_FULL_DATE = re.compile(
    r"\b(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"
    r"|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b",
    re.I,
)

_PHONE = re.compile(
    r"(?<!\d)(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}(?!\d)"
)

_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b")

# 5-digit ZIP sitting next to a state token (name or 2-letter), either order.
_STATES2 = (
    r"AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|"
    r"MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY"
)
_ZIP_GEO = re.compile(
    rf"(?:\b(?:{_STATES2})\b[\s,]*\d{{5}}(?:-\d{{4}})?\b"
    rf"|\b\d{{5}}(?:-\d{{4}})?\s*,?\s*(?:{_STATES2})\b)"
)
# decimal lat,long pair
_LATLONG = re.compile(r"[-+]?\d{1,3}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}")

# 13–16 digit run (spaces/dashes allowed) — checked with a loose Luhn below.
_CARDISH = re.compile(r"\b(?:\d[ \-]?){13,16}\b")


def _luhn_ok(digits: str) -> bool:
    ds = [int(c) for c in digits if c.isdigit()]
    if not 13 <= len(ds) <= 16:
        return False
    total, alt = 0, False
    for d in reversed(ds):
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def check_text(text: str, field: str = "text") -> list[Finding]:
    """Return every PII finding in `text`. Empty list == clean."""
    if not text:
        return []
    out: list[Finding] = []

    for m in _STREET.finditer(text):
        out.append(Finding("street-address", field, m.group(0).strip(),
                           "the pages are public — keep it to a city/region, not a street address"))
    for pat in (_DOB_CONTEXT, _FULL_DATE):
        for m in pat.finditer(text):
            out.append(Finding("birthday", field, m.group(0).strip(),
                               "don't post a full birthday/DOB; a bare year is fine"))
    for m in _PHONE.finditer(text):
        out.append(Finding("phone", field, m.group(0).strip(),
                           "no phone numbers on a public page — the contact channel is Sam"))
    for m in _SSN.finditer(text):
        out.append(Finding("ssn", field, m.group(0).strip(),
                           "never put an SSN anywhere near this"))
    for m in _EMAIL.finditer(text):
        domain = m.group(1).lower()
        if domain != "diligentservices.io":
            out.append(Finding("foreign-email", field, m.group(0).strip(),
                               "use an @diligentservices.io address, or link 'Email' to sam@diligentservices.io"))
    for pat in (_ZIP_GEO, _LATLONG):
        for m in pat.finditer(text):
            out.append(Finding("precise-location", field, m.group(0).strip(),
                               "a ZIP or exact coordinates is too precise for a public page"))
    for m in _CARDISH.finditer(text):
        if _luhn_ok(m.group(0)):
            out.append(Finding("card-number", field, m.group(0).strip(),
                               "that looks like a card number — remove it"))
    return out


# fields whose FULL text is prose and gets every detector
_PROSE_FIELDS = ("name", "location", "blurb")


def check_profile(profile: dict, name: str = "?") -> list[Finding]:
    """Check a parsed profile dict. Prose fields get all detectors; link labels
    get all detectors; link URLs get everything except the foreign-email rule
    (a `mailto:` to your own address is a deliberate, allowed choice)."""
    findings: list[Finding] = []
    for field in _PROSE_FIELDS:
        val = profile.get(field)
        if isinstance(val, str):
            findings += check_text(val, field)
        elif isinstance(val, list):  # e.g. tags
            for item in val:
                if isinstance(item, str):
                    findings += check_text(item, field)

    for tag in profile.get("tags", []) or []:
        if isinstance(tag, str):
            findings += check_text(tag, "tags")

    for link in profile.get("links", []) or []:
        if not isinstance(link, dict):
            continue
        label = link.get("label", "")
        url = link.get("url", "")
        if isinstance(label, str):
            findings += check_text(label, "link.label")
        if isinstance(url, str):
            # URLs: skip the email rule (mailto is deliberate), keep the rest.
            findings += [f for f in check_text(url, "link.url")
                         if f.rule != "foreign-email"]
    return findings


def check_profile_file(path: Path) -> list[Finding]:
    with open(path, "rb") as fh:
        profile = tomllib.load(fh)
    return check_profile(profile, name=path.stem)


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print("usage: pii_gate.py <profile.toml> [more.toml ...]", file=sys.stderr)
        return 2
    any_findings = False
    for arg in argv:
        path = Path(arg)
        try:
            findings = check_profile_file(path)
        except Exception as exc:  # noqa: BLE001 - surface parse errors clearly
            print(f"ERROR  {path}: {exc}", file=sys.stderr)
            any_findings = True
            continue
        if findings:
            any_findings = True
            print(f"BLOCKED  {path} ({len(findings)} finding(s)):")
            for f in findings:
                print(f"    {f}")
        else:
            print(f"OK       {path}")
    return 1 if any_findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
