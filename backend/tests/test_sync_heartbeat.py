# LAN SYNC HEARTBEAT: a deactivation or password reset used to wait for the
# next periodic sync cycle (up to 10 seconds) before other office computers
# saw it. Now every user-mutating action fires one HMAC-signed UDP nudge on
# the discovery channel, and every listener wakes its pull loop for an
# immediate cycle. These tests pin the wire format, the trust gates (signature,
# freshness, replay), the wake mechanics, the real UDP roundtrip, and the
# rule that user-mutating endpoints fire the nudge while read-only ones do not.

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import socket
import threading
import time
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

import sync_engine
from main import app, get_db
from database import Base, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# --- WIRE FORMAT AND TRUST GATES ---

def test_nudge_payload_format_and_no_secret():
    payload = sync_engine.build_nudge_payload("192.168.1.10")
    text = payload.decode("utf-8")
    assert text.startswith("PASADA_NUDGE:")
    # MAGIC:VER:IP:TIMESTAMP:NONCE:SIGNATURE, exactly six fields.
    assert len(text.split(":")) == 6
    # The cluster secret never crosses the network in readable form.
    assert sync_engine.CLUSTER_SECRET.encode() not in payload


def test_nudge_roundtrip_accepts_valid():
    now = time.time()
    payload = sync_engine.build_nudge_payload("192.168.1.10", now=now)
    result = sync_engine.parse_nudge_payload(payload, "192.168.1.99", now=now)
    assert result == "192.168.1.10"


def test_nudge_rejects_tampered_ip():
    now = time.time()
    payload = sync_engine.build_nudge_payload("192.168.1.10", now=now)
    forged = payload.replace(b"192.168.1.10", b"192.168.1.66")
    assert sync_engine.parse_nudge_payload(forged, "192.168.1.99", now=now) is None


def test_nudge_rejects_stale_timestamp():
    now = time.time()
    stale = sync_engine.build_nudge_payload("192.168.1.10", now=now - 4000)
    assert sync_engine.parse_nudge_payload(stale, "192.168.1.99", now=now) is None


def test_nudge_rejects_replayed_nonce():
    now = time.time()
    payload = sync_engine.build_nudge_payload("192.168.1.10", now=now)
    first = sync_engine.parse_nudge_payload(payload, "192.168.1.99", now=now)
    assert first == "192.168.1.10"
    # The exact same datagram again is a replay: dropped even though the
    # signature itself is still valid.
    assert sync_engine.parse_nudge_payload(payload, "192.168.1.99", now=now) is None


def test_nudge_rejects_wrong_secret():
    import hmac as _hmac
    import hashlib as _hashlib
    ts = str(int(time.time()))
    nonce = "forged-nonce-1"
    body = f"PASADA_NUDGE:{sync_engine.DISCOVERY_PROTOCOL_VERSION}:192.168.1.10:{ts}:{nonce}".encode("utf-8")
    forged_sig = _hmac.new(b"not-the-cluster-secret", body, _hashlib.sha256).hexdigest()
    assert sync_engine.parse_nudge_payload(
        body + b":" + forged_sig.encode("ascii"), "192.168.1.99") is None


def test_nudge_rejects_garbage_and_discovery_frames():
    assert sync_engine.parse_nudge_payload(b"hello world", "192.168.1.99") is None
    assert sync_engine.parse_nudge_payload(b"", "192.168.1.99") is None
    # A discovery broadcast shares the port but is a different dialect: the
    # nudge parser must not mistake it for a wake-up (and vice versa).
    discovery = sync_engine.build_discovery_payload("192.168.1.10")
    assert sync_engine.parse_nudge_payload(discovery, "192.168.1.99") is None


def test_nudge_ignores_own_datagram():
    now = time.time()
    payload = sync_engine.build_nudge_payload("192.168.1.10", now=now)
    assert sync_engine.parse_nudge_payload(payload, "192.168.1.10", now=now) is None


# --- WAKE MECHANICS ---

def test_request_sync_cycle_wakes_waiting_pull_loop():
    # The pull loop waits on the event with a 10 second timeout; a nudge must
    # cut that wait short.
    sync_engine._wake_pull_loop.clear()
    woke = threading.Event()

    def waiter():
        if sync_engine._wake_pull_loop.wait(timeout=5):
            woke.set()

    t = threading.Thread(target=waiter, daemon=True)
    t.start()
    time.sleep(0.05)
    sync_engine.request_sync_cycle()
    assert woke.wait(timeout=2), "the waiting pull loop was not woken"
    # One wake is one cycle: the loop clears the event before pulling, so a
    # second wait with no new nudge stays blocked.
    sync_engine._wake_pull_loop.clear()
    assert not sync_engine._wake_pull_loop.wait(timeout=0.2)


def test_signed_nudge_travels_over_real_udp():
    # Wire-level roundtrip on loopback: build, send through a real UDP socket,
    # receive, parse. The production listener runs exactly the same two steps.
    receiver = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    receiver.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        receiver.bind(("127.0.0.1", sync_engine.BROADCAST_PORT))
    except OSError:
        receiver.close()
        pytest.skip("port 54321 is busy: the real LAN listener is running")
    receiver.settimeout(5)
    try:
        sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sender.sendto(
            sync_engine.build_nudge_payload("127.0.0.1"),
            ("127.0.0.1", sync_engine.BROADCAST_PORT))
        sender.close()
        data, _ = receiver.recvfrom(1024)
    finally:
        receiver.close()
    # Heard on another machine (a different local_ip), the nudge names its sender.
    assert sync_engine.parse_nudge_payload(data, "192.168.50.50") == "127.0.0.1"


def test_notify_users_changed_does_not_self_wake():
    # The machine that MADE the change already has it; a nudge must not wake
    # its own pull loop (only remote listeners wake theirs).
    sync_engine._wake_pull_loop.clear()
    try:
        sync_engine.notify_users_changed()
        assert not sync_engine._wake_pull_loop.wait(timeout=0.3), \
            "the sender must not wake its own pull loop"
    finally:
        sync_engine._wake_pull_loop.clear()


# --- ENDPOINT TRIGGERS (admin office) ---

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_heartbeat.db"))
engine = create_engine(
    f"sqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def client():
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    db.add(User(first_name="ADMIN", last_name="BOSS", username="ADMIN BOSS",
                password_hash=pwd_context.hash("password123"), role="Admin"))
    db.commit()
    db.close()

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    if previous_override is not None:
        app.dependency_overrides[get_db] = previous_override
    else:
        app.dependency_overrides.pop(get_db, None)
    engine.dispose()
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass


@pytest.fixture
def nudge_spy(monkeypatch):
    calls = []
    monkeypatch.setattr(sync_engine, "notify_users_changed", lambda: calls.append(1))
    return calls


def _token(client, username="ADMIN BOSS", password="password123"):
    res = client.post("/token", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_create_user_fires_nudge(client, nudge_spy):
    res = client.post("/users", headers=_token(client), json={
        "first_name": "HEART", "last_name": "BEAT",
        "username": "HEART BEAT", "password": "heartbeat123", "role": "Clerk",
    })
    assert res.status_code == 200, res.text
    assert nudge_spy, "creating an account must fire the heartbeat nudge"


def test_reset_password_fires_nudge(client, nudge_spy):
    client.post("/users", headers=_token(client), json={
        "first_name": "RESET", "last_name": "ME",
        "username": "RESET ME", "password": "originalpass1", "role": "Clerk",
    })
    nudge_spy.clear()
    res = client.put("/users/reset-password", headers=_token(client),
                     json={"username": "RESET ME", "new_password": "freshpass123"})
    assert res.status_code == 200, res.text
    assert nudge_spy, "a password reset must fire the heartbeat nudge"


def test_set_active_fires_nudge_both_ways(client, nudge_spy):
    client.post("/users", headers=_token(client), json={
        "first_name": "SWITCH", "last_name": "ME",
        "username": "SWITCH ME", "password": "switchpass1", "role": "Clerk",
    })
    headers = _token(client)
    nudge_spy.clear()
    # Single-admin module: the override valve demands a written reason.
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "SWITCH ME", "is_active": False, "override_reason": "account left the office"})
    assert res.status_code == 200, res.text
    assert nudge_spy, "deactivating an account must fire the heartbeat nudge"
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "SWITCH ME", "is_active": True, "override_reason": "clerk returns"})
    assert res.status_code == 200, res.text
    assert len(nudge_spy) == 2, "reactivating an account must fire the nudge too"


def test_read_only_endpoints_do_not_nudge(client, nudge_spy):
    client.get("/users", headers=_token(client))
    client.get("/admin/needed", headers=_token(client))
    assert nudge_spy == [], "read-only endpoints must not fire the nudge"


# --- ENDPOINT TRIGGERS (fresh office: bootstrap and recovery) ---

FRESH_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_heartbeat_fresh.db"))
fresh_engine = create_engine(
    f"sqlite:///{FRESH_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
FreshSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=fresh_engine)


def fresh_override_get_db():
    db = FreshSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def fresh_client():
    if os.path.exists(FRESH_DB_PATH):
        try:
            os.remove(FRESH_DB_PATH)
        except OSError:
            pass
    Base.metadata.create_all(bind=fresh_engine)

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = fresh_override_get_db
    with TestClient(app) as c:
        yield c
    if previous_override is not None:
        app.dependency_overrides[get_db] = previous_override
    else:
        app.dependency_overrides.pop(get_db, None)
    fresh_engine.dispose()
    if os.path.exists(FRESH_DB_PATH):
        try:
            os.remove(FRESH_DB_PATH)
        except OSError:
            pass


def test_bootstrap_and_recovery_reset_fire_nudge(fresh_client, nudge_spy):
    # First-run bootstrap: the signed-in first account promotes itself to
    # Admin. The role change roams, so the nudge must fire.
    res = fresh_client.post("/signup", json={
        "first_name": "FIRST", "last_name": "BOOT",
        "username": "FIRST BOOT", "password": "firstboot123",
        "password_confirm": "firstboot123", "role": "Clerk",
    })
    assert res.status_code == 200, res.text
    nudge_spy.clear()
    res = fresh_client.post("/token", json={"username": "FIRST BOOT", "password": "firstboot123"})
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    res = fresh_client.post("/admin/bootstrap", headers=headers, json={"password": "firstboot123"})
    assert res.status_code == 200, res.text
    assert nudge_spy, "bootstrapping an admin must fire the heartbeat nudge"

    # Recovery reset: a correct three-answer reset changes the password (and
    # can promote to Admin while no admin exists), so the nudge must fire too.
    client_post = fresh_client.post("/users", headers=headers, json={
        "first_name": "RECO", "last_name": "VERER",
        "username": "RECO VERER", "password": "recopass123", "role": "Clerk",
    })
    assert client_post.status_code == 200, client_post.text
    db = FreshSessionLocal()
    reco = db.query(User).filter(User.username == "RECO VERER").first()
    reco.security_q1 = "Question one?"
    reco.security_q2 = "Question two?"
    reco.security_q3 = "Question three?"
    reco.security_a1_hash = pwd_context.hash("answer one")
    reco.security_a2_hash = pwd_context.hash("answer two")
    reco.security_a3_hash = pwd_context.hash("answer three")
    db.commit()
    db.close()
    nudge_spy.clear()
    res = fresh_client.post("/recovery/reset", json={
        "username": "RECO VERER",
        "a1": "answer one", "a2": "answer two", "a3": "answer three",
        "new_password": "newrecopass1",
    })
    assert res.status_code == 200, res.text
    assert nudge_spy, "a recovery password reset must fire the heartbeat nudge"


# --- SYNC NOW ENDPOINT AND LAST SYNC CHECK STAMP ---

def test_sync_now_requires_admin(client):
    # No token at all: the door is closed before anything else happens.
    res = client.post("/system/sync-now")
    assert res.status_code in (401, 403)

    # A Clerk may not force sync cycles; waking the pull loop is an Admin
    # control on the Technical tab.
    client.post("/users", headers=_token(client), json={
        "first_name": "PLAIN", "last_name": "CLERK",
        "username": "PLAIN CLERK", "password": "plainclerk1", "role": "Clerk",
    })
    res = client.post("/system/sync-now", headers=_token(client, "PLAIN CLERK", "plainclerk1"))
    assert res.status_code == 403


def test_sync_now_endpoint_wakes_pull_loop(client, monkeypatch):
    woken = threading.Event()
    monkeypatch.setattr(sync_engine, "request_sync_cycle", woken.set)
    res = client.post("/system/sync-now", headers=_token(client))
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "success"
    assert woken.is_set(), "Sync now must wake the pull loop immediately"


def test_network_endpoint_reports_last_sync_check(client):
    res = client.get("/system/network", headers=_token(client))
    assert res.status_code == 200, res.text
    data = res.json()
    assert "last_sync_check" in data
    # None until the first cycle finishes, or a PHT-aware ISO stamp.
    if data["last_sync_check"] is not None:
        parsed = datetime.fromisoformat(data["last_sync_check"])
        assert parsed.utcoffset() is not None


def test_sync_cycle_stamps_last_check(monkeypatch):
    # Hermetic single pass of the real pull loop: empty peer list, its own
    # in-memory database, and a wait() that lets exactly one cycle run.
    mem_engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=mem_engine)
    MemSession = sessionmaker(autocommit=False, autoflush=False, bind=mem_engine)
    monkeypatch.setattr(sync_engine, "SessionLocal", MemSession)
    monkeypatch.setattr(sync_engine, "PEERS", set())
    monkeypatch.setattr(sync_engine, "_last_sync_check", None)

    passes = {"n": 0}
    def one_pass_then_stop(timeout=None):
        passes["n"] += 1
        if passes["n"] > 1:
            raise KeyboardInterrupt
        return False
    monkeypatch.setattr(sync_engine._wake_pull_loop, "wait", one_pass_then_stop)

    with pytest.raises(KeyboardInterrupt):
        sync_engine.sync_with_peers()

    assert passes["n"] == 2, "exactly one full cycle should have run"
    stamped = sync_engine.get_last_sync_check()
    assert stamped, "a finished cycle must stamp the last sync check"
    parsed = datetime.fromisoformat(stamped)
    assert parsed.utcoffset() is not None, "the stamp must carry the PHT offset"


def test_last_sync_check_thread_safe_marks(monkeypatch):
    # Many cycles finishing at once must all stamp without stepping on each
    # other, and the value must stay a readable ISO string.
    errors = []
    def marker():
        try:
            sync_engine._mark_sync_cycle_finished()
        except Exception as e:
            errors.append(e)
    threads = [threading.Thread(target=marker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    parsed = datetime.fromisoformat(sync_engine.get_last_sync_check())
    assert parsed.utcoffset() is not None


# --- PEER VISIBILITY + LIVE DIAGNOSTICS (Connections card) ---
def test_get_peer_status_reflects_seen_and_misses():
    """The Connections card must be able to tell 'the laptop went silent'
    from 'the laptop answers but pulls keep failing' — per-peer last_seen
    and miss streak, not just the miss count."""
    import time as t
    sync_engine._peer_seen.clear()
    sync_engine._peer_failures.clear()
    sync_engine.PEERS.discard("203.0.113.77")
    try:
        sync_engine._mark_peer_seen("203.0.113.77")
        sync_engine.PEERS.add("203.0.113.77")
        with sync_engine._peer_failures_lock:
            sync_engine._peer_failures["203.0.113.77"] = 3
        rows = sync_engine.get_peer_status()
        row = rows["203.0.113.77"]
        assert row["registered"] is True
        assert row["misses"] == 3
        assert row["last_seen"], "a heard peer must have a last_seen stamp"
        before = row["last_seen"]
        t.sleep(0.01)
        sync_engine._mark_peer_seen("203.0.113.77")
        assert sync_engine.get_peer_status()["203.0.113.77"]["last_seen"] >= before
    finally:
        sync_engine.PEERS.discard("203.0.113.77")
        sync_engine._peer_seen.pop("203.0.113.77", None)
        with sync_engine._peer_failures_lock:
            sync_engine._peer_failures.pop("203.0.113.77", None)


def test_sync_diagnostics_reports_exact_failure(client):
    """The live check must name the failure per peer (timeout/refused/
    wrong-secret) instead of the background loop's opaque miss counter. With
    a peer that is up but signature-rejected, the reason is wrong-secret."""
    from unittest.mock import patch, MagicMock
    headers = _token(client)
    sync_engine.PEERS.add("203.0.113.99")
    try:
        fake = MagicMock()
        fake.exceptions = __import__("requests").exceptions
        fake.get = MagicMock(
            side_effect=__import__("requests").exceptions.ConnectionError("boom"))
        with patch("main.requests", fake):
            res = client.post("/system/sync-diagnostics", headers=headers)
        assert res.status_code == 200, res.text
        results = res.json()["results"]
        match = [r for r in results if r["peer"] == "203.0.113.99"]
        assert match, "the live check must report the visible peer"
        assert match[0]["ok"] is False
        assert match[0]["reason"] in ("refused", "timeout", "error")

        # Wrong cluster secret on the other side answers 403; the check must
        # call it out by name instead of just "failed".
        rejected = MagicMock(status_code=403)
        fake.get = MagicMock(return_value=rejected)
        with patch("main.requests", fake):
            res = client.post("/system/sync-diagnostics", headers=headers)
        match = [r for r in res.json()["results"] if r["peer"] == "203.0.113.99"]
        assert match[0]["reason"] == "wrong-secret"
    finally:
        sync_engine.PEERS.discard("203.0.113.99")


def test_sync_diagnostics_requires_admin(client):
    res = client.post("/system/sync-diagnostics")
    assert res.status_code in (401, 403)


# --- CLUSTER KEY ROTATION / IMPORT ---
def test_cluster_key_fingerprint_is_stable_and_display_safe():
    """Same secret = same fingerprint; the fingerprint must never contain the
    key text itself (reverse lookup impossible)."""
    fp = sync_engine.cluster_secret_fingerprint()
    assert len(fp) == 16
    assert fp == sync_engine.cluster_secret_fingerprint()
    assert sync_engine.CLUSTER_SECRET not in fp


def test_rotate_and_import_key_roundtrip(client):
    """Rotate mints+adopts a fresh key and returns its text ONCE. Importing
    the exact text adopts it and clears stale peers. Garbage is refused, and
    the adopted key persists to cluster_secret.key."""
    headers = _token(client)
    secret_file = sync_engine.CLUSTER_SECRET_PATH
    original = sync_engine.CLUSTER_SECRET
    try:
        res = client.post("/system/cluster-key/rotate", headers=headers)
        assert res.status_code == 200, res.text
        data = res.json()
        rotated = data["key"]
        assert rotated and rotated != original
        assert sync_engine.CLUSTER_SECRET == rotated, "rotation must adopt live"
        with open(secret_file) as f:
            assert f.read().strip() == rotated, "rotation must persist to disk"

        # Registries were cleared; an admin cannot see a stale peer expectation.
        assert sync_engine.PEERS == set()

        # Garbage import = 400, no state change.
        bad = client.post("/system/cluster-key/import", headers=headers, json={"key": "short"})
        assert bad.status_code == 400

        # Hand-deliver: a DIFFERENT computer adopts the rotated text.
        res = client.post("/system/cluster-key/import", headers=headers, json={"key": rotated})
        assert res.status_code == 200, res.text
        assert sync_engine.CLUSTER_SECRET == "".join(rotated.split())
        with open(secret_file) as f:
            assert f.read().strip() == "".join(rotated.split())
    finally:
        sync_engine._adopt_cluster_secret(original)


def test_cluster_key_endpoints_require_admin(client):
    assert client.get("/system/cluster-key").status_code in (401, 403)
    assert client.post("/system/cluster-key/rotate").status_code in (401, 403)
    assert client.post("/system/cluster-key/import", json={"key": "x" * 40}).status_code in (401, 403)
