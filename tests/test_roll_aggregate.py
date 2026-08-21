"""Tests for the rickroll beacon aggregator (atds/server/roll_aggregate.py):
allowlist from directory.json, cumulative counts across runs, logrotate
survival (inode change drains the .1 file), and copytruncate reset."""
from __future__ import annotations

import json
import sys
from pathlib import Path

_SERVER = Path(__file__).resolve().parents[1] / "server"
if str(_SERVER) not in sys.path:
    sys.path.insert(0, str(_SERVER))

import roll_aggregate as ra  # noqa: E402


def _setup(tmp_path):
    docroot = tmp_path / "docroot"
    (docroot / "rickroll").mkdir(parents=True)
    (docroot / "directory.json").write_text(json.dumps([
        {"subname": "sam", "status": "claimed"},
        {"subname": "ghost", "status": "unclaimed"},
    ]))
    log = tmp_path / "atds-roll.log"
    state = tmp_path / "state.json"
    return docroot, log, state


def _run(docroot, log, state):
    rc = ra.main(["--log", str(log), "--state", str(state),
                  "--docroot", str(docroot)])
    assert rc == 0
    return json.loads((docroot / "rickroll" / "leaderboard.json").read_text())


def test_counts_allowlisted_only(tmp_path):
    docroot, log, state = _setup(tmp_path)
    log.write_text("t1 sam\nt2 sam\nt3 ghost\nt4 mallory\nt5\n")
    lb = _run(docroot, log, state)
    assert lb["rolls"] == {"sam": 2}     # ghost unclaimed, mallory unknown


def test_counts_accumulate_incrementally(tmp_path):
    docroot, log, state = _setup(tmp_path)
    log.write_text("t1 sam\n")
    assert _run(docroot, log, state)["rolls"]["sam"] == 1
    with open(log, "a") as fh:
        fh.write("t2 sam\n")
    assert _run(docroot, log, state)["rolls"]["sam"] == 2
    # no new lines -> unchanged, not double-counted
    assert _run(docroot, log, state)["rolls"]["sam"] == 2


def test_survives_logrotate(tmp_path):
    docroot, log, state = _setup(tmp_path)
    log.write_text("t1 sam\n")
    assert _run(docroot, log, state)["rolls"]["sam"] == 1
    # rotate: old inode becomes .1 with one unread line; fresh file gets one
    with open(log, "a") as fh:
        fh.write("t2 sam\n")
    log.rename(log.with_name("atds-roll.log.1"))
    log.write_text("t3 sam\n")
    assert _run(docroot, log, state)["rolls"]["sam"] == 3


def test_copytruncate_reset(tmp_path):
    docroot, log, state = _setup(tmp_path)
    log.write_text("t1 sam\nt2 sam\n")
    assert _run(docroot, log, state)["rolls"]["sam"] == 2
    log.write_text("t3 sam\n")   # same inode, smaller size -> read from 0
    assert _run(docroot, log, state)["rolls"]["sam"] == 3


def test_missing_directory_refuses(tmp_path):
    log = tmp_path / "l.log"
    log.write_text("t sam\n")
    rc = ra.main(["--log", str(log), "--state", str(tmp_path / "s.json"),
                  "--docroot", str(tmp_path / "nope")])
    assert rc == 1
