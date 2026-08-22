"""Tests for the at.diligentservices.io builder (the CEDIA pages).

Covers the deltas from the atparty builder it was ported from: the [contact]
exemption (deliberately-public business-card data passes; the same phone in a
BLURB still fails the whole build), contact shape validation, vCard emission
(CRLF + escaping), the certbot domain list (at.<apex> + claimed only — never
the marketing apex), and the claimed-only about-page directory. The shared
markdown-subset/XSS behavior is covered by test_build_atparty.py.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parents[1] / "atds" / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import build_atds as b  # noqa: E402

APEX = "diligentservices.io"


def _profile_toml(name: str, *, blurb: str = "A fine person.",
                  contact: bool = True, status: str = "claimed") -> str:
    contact_block = """
[contact]
phone = "(424) 448-5200"
email = "%s@diligentservices.io"
title = "Tester"
""" % name if contact else ""
    return f'''
name   = "{name.title()} Myers"
status = "{status}"
blurb  = """{blurb}"""
{contact_block}
'''


def _build(tmp_path: Path, profiles: dict[str, str]) -> tuple[int, Path]:
    pdir = tmp_path / "profiles"
    pdir.mkdir()
    for sub, toml_text in profiles.items():
        (pdir / f"{sub}.toml").write_text(toml_text, encoding="utf-8")
    out = tmp_path / "dist"
    rc = b.main(["--profiles", str(pdir), "--out", str(out),
                 "--apex-domain", APEX])
    return rc, out


# --- [contact] exemption vs the PII gate -------------------------------------

def test_contact_phone_passes_gate(tmp_path):
    rc, out = _build(tmp_path, {"sam": _profile_toml("sam")})
    assert rc == 0
    assert (out / "sam" / "index.html").exists()


def test_phone_in_blurb_still_fails_closed(tmp_path, capsys):
    dirty = _profile_toml("sam", blurb="call me at (424) 448-5200 anytime")
    rc, out = _build(tmp_path, {"sam": dirty, "pearl": _profile_toml("pearl")})
    assert rc == 1
    # fail CLOSED: the clean profile is not published either
    assert not (out / "pearl").exists()


def test_bad_contact_shape_fails_closed(tmp_path):
    bad = _profile_toml("sam").replace('"(424) 448-5200"', '"not a phone!!"')
    rc, out = _build(tmp_path, {"sam": bad})
    assert rc == 1


def test_unknown_contact_key_fails_closed(tmp_path):
    bad = _profile_toml("sam") + '\naddress = "123 Elm St"\n'  # lands in [contact]
    rc, out = _build(tmp_path, {"sam": bad})
    assert rc == 1


# --- vCard -------------------------------------------------------------------

def test_vcard_content_and_crlf(tmp_path):
    rc, out = _build(tmp_path, {"sam": _profile_toml("sam")})
    assert rc == 0
    raw = (out / "sam" / "sam.vcf").read_bytes()
    assert raw.startswith(b"BEGIN:VCARD\r\n")
    text = raw.decode()
    assert "FN:Sam Myers" in text
    assert "TEL;TYPE=WORK,VOICE:(424) 448-5200" in text
    assert "EMAIL;TYPE=INTERNET,WORK:sam@diligentservices.io" in text
    assert f"URL:https://sam.at.{APEX}/" in text
    assert text.endswith("END:VCARD\r\n")


def test_vcard_escapes_separators():
    vcf = b.make_vcard({"name": "Sam Myers",
                        "contact": {"title": "Owner; Operator, LLC"}},
                       "sam", APEX)
    assert "TITLE:Owner\\; Operator\\, LLC" in vcf


def test_no_contact_no_vcard_but_page_builds(tmp_path):
    rc, out = _build(tmp_path, {"sam": _profile_toml("sam", contact=False)})
    assert rc == 0
    assert (out / "sam" / "index.html").exists()
    assert not (out / "sam" / "sam.vcf").exists()


# --- certbot domains + directory ---------------------------------------------

def test_certbot_domains_are_at_lane_only(tmp_path):
    rc, out = _build(tmp_path, {
        "sam": _profile_toml("sam"),
        "ghost": _profile_toml("ghost", status="unclaimed", contact=False),
    })
    assert rc == 0
    doms = (out / "certbot-domains.txt").read_text()
    assert f"-d at.{APEX}" in doms
    assert f"-d sam.at.{APEX}" in doms
    # unclaimed stays on the wildcard lane (no roster in CT logs)
    assert "ghost" not in doms
    # the marketing apex + www belong to the Quarto site's cert, never ours
    assert f"-d {APEX} " not in doms and not doms.rstrip().endswith(f"-d {APEX}")
    assert f"www.{APEX}" not in doms


def test_no_public_roster_emitted(tmp_path):
    # Sam nixed the public roster 2026-08-21: no about/index page exists at
    # all — the bare at. host 301s to the marketing site in nginx. The
    # directory.json data file still feeds the roll aggregator (it is not
    # reachable through any vhost).
    rc, out = _build(tmp_path, {"sam": _profile_toml("sam")})
    assert rc == 0
    assert not (out / "about.html").exists()
    assert not (out / "index.html").exists()
    assert (out / "directory.json").exists()


def test_profile_page_has_vcard_link(tmp_path):
    rc, out = _build(tmp_path, {"sam": _profile_toml("sam")})
    page = (out / "sam" / "index.html").read_text()
    assert 'href="sam.vcf"' in page and "download" in page
    assert "noindex" not in page  # marketing pages are indexable


# --- phase 2: preroll + rickroll page -----------------------------------------

def test_preroll_on_claimed_page(tmp_path):
    rc, out = _build(tmp_path, {"sam": _profile_toml("sam")})
    page = (out / "sam" / "index.html").read_text()
    assert 'id="preroll"' in page
    assert "atds_rolled=1" in page                       # cookie gate + set
    assert "/roll.gif?who=sam" in page                   # beacon
    assert "youtube-nocookie.com/embed/dQw4w9WgXcQ" in page
    assert "mute=1" in page                              # autoplay is muted
    assert 'id="preroll-skip"' in page                   # dismissable
    assert "rickroll.at." in page                        # footer tease


def test_no_preroll_on_unclaimed_stub(tmp_path):
    rc, out = _build(tmp_path, {
        "ghost": _profile_toml("ghost", status="unclaimed", contact=False)})
    page = (out / "ghost" / "index.html").read_text()
    # (the shared CSS mentions #preroll on every page; the overlay + beacon
    # must not be there)
    assert 'id="preroll"' not in page and "roll.gif" not in page


def test_rickroll_page_rides_wildcard_lane_only(tmp_path):
    rc, out = _build(tmp_path, {"sam": _profile_toml("sam")})
    rr = (out / "rickroll" / "index.html").read_text()
    assert "youtube-nocookie.com/embed/dQw4w9WgXcQ" in rr
    assert "leaderboard.json" in rr
    # never in the SAN cert list, the directory, or the apex listing
    assert "rickroll" not in (out / "certbot-domains.txt").read_text()
    assert all(d["subname"] != "rickroll"
               for d in json.loads((out / "directory.json").read_text()))


# --- markdown subset extensions (Sam's hand-edits rely on these) --------------

def test_md_ordered_list():
    out = b.md_to_html("1. Business cards are forgettable.\n2. ??\n3. Profit")
    assert "<ol><li>Business cards are forgettable.</li><li>??</li>" in out
    assert "<li>Profit</li></ol>" in out


def test_md_underscore_italics_word_bounded():
    out = b.md_to_html("this is _citation needed_ but snake_case_name stays")
    assert "<em>citation needed</em>" in out
    assert "snake_case_name" in out


# --- /qr pages ----------------------------------------------------------------

def test_qr_pages_emitted_for_claimed_and_apex(tmp_path):
    pytest.importorskip("segno")
    rc, out = _build(tmp_path, {
        "sam": _profile_toml("sam"),
        "ghost": _profile_toml("ghost", status="unclaimed", contact=False),
    })
    assert rc == 0
    qr = (out / "sam" / "qr" / "index.html").read_text()
    assert "<svg" in qr and f"https://sam.at.{APEX}/" in qr
    assert not (out / "qr").exists()                 # no bare-host QR (no roster)
    assert not (out / "ghost" / "qr").exists()       # unclaimed: no QR


def test_rickroll_federation_tab_is_textcontent_only(tmp_path):
    rc, out = _build(tmp_path, {"sam": _profile_toml("sam")})
    rr = (out / "rickroll" / "index.html").read_text()
    assert 'id="tab-rr"' in rr and "rickroll.win/leaderboard.json" in rr
    # federated names are attacker-adjacent: the loader must never innerHTML
    load = rr.split("function loadRR")[1]
    assert "innerHTML" not in load
    assert "textContent" in load


def test_skip_qr_builds_without_qr_pages(tmp_path):
    pdir = tmp_path / "profiles"
    pdir.mkdir()
    (pdir / "sam.toml").write_text(_profile_toml("sam"), encoding="utf-8")
    out = tmp_path / "dist"
    rc = b.main(["--profiles", str(pdir), "--out", str(out),
                 "--apex-domain", APEX, "--skip-qr"])
    assert rc == 0
    assert not (out / "sam" / "qr").exists()
