# LAN SYNC FAILURE PATHS: what the office actually experiences when a peer
# machine is powered off for a day, when office clocks drift apart, and when
# a DHCP reassigned a stale address to a printer. Real-machine facts these
# tests pin down:
#   1. The catch-up watermark looks back a little further than the newest
#      local record, so a peer whose clock runs behind ours still lands its
#      records (a plain `updated_at > my newest` filter would drop them
#      FOREVER: they are already past a watermark that never moves backwards).
#   2. One poisoned record in a peer's payload must not throw away the rest
#      of that peer's pull — actually defended: the row parse tolerates a
#      missing updated_at instead of raising.
#   3. A peer that keeps failing pulls is dropped from the registry after a
#      bounded number of misses (no more dead timeouts and crash-log spam
#      every cycle), and a heard broadcast from it re-adds it instantly.

import sys
import os
import time
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import sync_engine
from database import Base


PHT = timezone(timedelta(hours=8))


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.ok = status < 400

    def json(self):
        return self._payload


@pytest.fixture
def memory_office(monkeypatch):
    """One cycle of the real pull loop against its own in-memory database,
    with a single fake peer whose canned responses are controlled per test."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    MemSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    monkeypatch.setattr(sync_engine, "SessionLocal", MemSession)
    monkeypatch.setattr(sync_engine, "PEERS", {"192.168.50.20"})
    monkeypatch.setattr(sync_engine, "_last_sync_check", None)
    monkeypatch.setattr(sync_engine, "_peer_failures", {})
    return engine


def run_one_pass(monkeypatch, passes=1):
    """Drive exactly `passes` cycles of the real sync_with_peers loop, then
    stop it the same way the production thread would end a test."""
    state = {"n": 0}

    def controlled_wait(timeout=None):
        state["n"] += 1
        if state["n"] > passes:
            raise KeyboardInterrupt
        return False

    monkeypatch.setattr(sync_engine._wake_pull_loop, "wait", controlled_wait)
    with pytest.raises(KeyboardInterrupt):
        sync_engine.sync_with_peers()
    return state


def test_watermark_looks_back_by_skew_guard(memory_office, monkeypatch):
    # Our newest local record is stamped NOW (PHT). A peer's clock runs five
    # minutes behind: its "new" edit carries an updated_at slightly in OUR
    # past. The naive filter `> newest_local` would exclude it forever —
    # the pull must ask for watermark - guard instead.
    engine, = [None]
    MemSession = sync_engine.SessionLocal
    db = MemSession()
    newer_stamp = datetime.now(PHT).replace(tzinfo=None)
    older_stamp = newer_stamp - timedelta(minutes=5)
    db.add(sync_engine.FranchiseRecord(
        route="SALOG", operator_name="LOCAL RECORD", sbn_no="090-2026-001",
        updated_at=newer_stamp))
    db.commit()
    db.close()

    captured = {}

    def fake_get(url, headers=None, timeout=None):
        captured["since"] = url.split("since=")[1]
        return FakeResponse({"records": [], "users": []})

    monkeypatch.setattr(sync_engine.requests, "get", fake_get)
    run_one_pass(monkeypatch)

    asked_for = datetime.fromisoformat(captured["since"])
    assert asked_for <= older_stamp, (
        "the pull must look back past the newest local stamp by the skew "
        "guard, or a behind-clock peer's edits are dropped forever")


def test_one_poisoned_record_does_not_kill_the_peer_pull(memory_office, monkeypatch):
    # The peer sends a row with a missing updated_at (real databases can carry
    # such rows from old versions). The pull used to raise inside the payload
    # loop, rollback EVERYTHING from that peer, and retry the same poison
    # every cycle forever. Now the row parses without raising and the pull
    # still lands the healthy rows.
    poisoned = {"id": 1, "route": "SALOG", "operator_name": "POISON ROW",
                "sbn_no": "090-2026-002", "updated_at": None}
    healthy = {"id": 2, "route": "SALOG", "operator_name": "HEALTHY ROW",
               "sbn_no": "090-2026-003", "updated_at": datetime.now(PHT).isoformat()}

    def fake_get(url, headers=None, timeout=None):
        return FakeResponse({"records": [poisoned, healthy], "users": []})

    monkeypatch.setattr(sync_engine.requests, "get", fake_get)
    run_one_pass(monkeypatch)

    db = sync_engine.SessionLocal()
    try:
        assert db.query(sync_engine.FranchiseRecord).filter_by(id=2).first() is not None, \
            "the healthy record from the same payload must survive"
        assert db.query(sync_engine.FranchiseRecord).filter_by(id=1).first() is not None, \
            "a row without updated_at must still be inserted (timestamp falls back)"
    finally:
        db.close()


def test_failures_are_pruned_and_reappearance_works(memory_office, monkeypatch):
    # The peer is powered off. Connection attempts fail over and over; after
    # the bounded miss count the peer leaves the registry (no more timeouts,
    # no crash-log line every cycle), and one heard broadcast re-adds it.
    def dead_peer(url, headers=None, timeout=None):
        raise ConnectionError("Connection reset")

    monkeypatch.setattr(sync_engine.requests, "get", dead_peer)
    run_one_pass(monkeypatch, passes=sync_engine.PEER_MAX_CONSECUTIVE_FAILURES + 1)

    assert sync_engine.PEERS == set(), (
        "a peer that failed pull after pull must be pruned from the registry")

    # It is powered back on. Its discovery broadcast is heard by the REAL
    # listener (same code production runs), and the peer is registry-eligible
    # again without any app restart.
    import socket as _socket
    import threading as _threading

    listener_thread = _threading.Thread(target=sync_engine.listen_for_peers,
                                        daemon=True)
    listener_thread.start()
    time.sleep(0.3)  # let the listener bind before the first datagram
    try:
        # The listener binds the engine's CONFIGURED port (PASADA_SYNC_PORT
        # env, default 54321) — never a hardcoded copy of the constant here.
        bind_ip, _, bind_port = (os.environ.get("PASADA_SYNC_BIND", "")).partition(":")
        listen_port = int(bind_port) if bind_port else sync_engine.SYNC_PORT
        for _ in range(40):
            if "192.168.50.20" in sync_engine.PEERS:
                break
            sender = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
            sender.sendto(
                sync_engine.build_discovery_payload("192.168.50.20"),
                (bind_ip or "127.0.0.1", listen_port))
            sender.close()
            time.sleep(0.1)
    finally:
        pass
    assert "192.168.50.20" in sync_engine.PEERS, (
        "a pruned peer must re-enter the registry through a heard broadcast")


def test_success_resets_the_failure_counter(memory_office, monkeypatch):
    # One flaky miss must not be counted against a peer forever: a later
    # successful pull clears the streak.
    state = {"fail": True}

    def flaky_peer(url, headers=None, timeout=None):
        if state["fail"]:
            raise ConnectionError("dropped frame")
        return FakeResponse({"records": [], "users": []})

    monkeypatch.setattr(sync_engine.requests, "get", flaky_peer)
    run_one_pass(monkeypatch, passes=1)
    assert sync_engine._peer_failures.get("192.168.50.20", 0) == 1

    state["fail"] = False
    run_one_pass(monkeypatch, passes=1)
    assert sync_engine._peer_failures.get("192.168.50.20", 0) == 0, (
        "a successful pull must reset the miss streak")
    assert "192.168.50.20" in sync_engine.PEERS, (
        "a flaky peer must not be pruned while it succeeds between misses")
