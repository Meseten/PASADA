# SYNC CONNECTIVITY FIX TESTS: regression coverage for the LAN-sync
# connect-tissue bugs that strand offices in silence —
#   1. unicast pairing replies must target the LIVE SYNC_PORT (lab overrides),
#      not the hardcoded BROADCAST_PORT constant;
#   2. a machine whose ENTIRE peer registry is failing must be allowed to
#      re-pair again (offers/challenges) instead of waiting out the
#      20-miss drop forever while PEERS looks non-empty;
#   3. packets rejected ONLY for age must leave a throttled one-line mark
#      in the crash log (a >5-minute clock difference otherwise looks
#      identical to total silence);
#   4. /api/sync/diagnostics must expose the engine's pairing state so the
#      Connections tab can say WHY nothing syncs.
#
# CHANGE-2 mirror design: like test_auto_pairing, one process plays both
# machines by swapping module-level identity where needed.

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import time
import pytest

import sync_engine as se


@pytest.fixture(autouse=True)
def _clean_sync_state():
    old_secret = se.CLUSTER_SECRET
    old_priv, old_pub = se._PAIRING_PRIV, se._PAIRING_PUB
    se.PEERS.clear()
    se.PEER_NAMES.clear()
    with se._peer_failures_lock:
        se._peer_failures.clear()
    with se._throttle_lock:
        se._reply_throttle.clear()
        se._challenge_throttle.clear()
    se._auto_pair_events.clear()
    se._stale_drop_throttle.clear()
    yield
    se._PAIRING_PRIV, se._PAIRING_PUB = old_priv, old_pub
    se._adopt_cluster_secret(old_secret)
    se.PEERS.clear()
    se.PEER_NAMES.clear()
    with se._peer_failures_lock:
        se._peer_failures.clear()
    with se._throttle_lock:
        se._reply_throttle.clear()
        se._challenge_throttle.clear()
    se._auto_pair_events.clear()
    se._stale_drop_throttle.clear()


# ---------------------------------------------------------------------------
# CHANGE 1: unicast replay port
# ---------------------------------------------------------------------------
def test_unicast_reply_targets_live_sync_port(monkeypatch):
    """Challenge/secret replies go unicast to the DESTINATION'S discovery
    port — which is SYNC_PORT (env-overridable), never the hardcoded
    BROADCAST_PORT constant, or two lab instances on overridden ports can
    never complete the pairing handshake."""
    se.SYNC_PORT_ENV_BACKUP = se.SYNC_PORT
    monkeypatch.setattr(se, "SYNC_PORT", 55555)
    sent = []

    class FakeSock:
        def sendto(self, payload, dest):
            sent.append(dest)

        def close(self):
            pass

    monkeypatch.setattr(se.socket, "socket", lambda *a, **k: FakeSock())
    se._send_unicast(b"x", "127.0.0.2")
    assert sent == [("127.0.0.2", 55555)], sent
    del se.SYNC_PORT_ENV_BACKUP


def test_unicast_reply_default_port_matches_discovery(monkeypatch):
    """With no override, SYNC_PORT and BROADCAST_PORT agree; the constant no
    longer appears anywhere in the reply path."""
    monkeypatch.setattr(se, "SYNC_PORT", se.BROADCAST_PORT)
    sent = []

    class FakeSock:
        def sendto(self, payload, dest):
            sent.append(dest)

        def close(self):
            pass

    monkeypatch.setattr(se.socket, "socket", lambda *a, **k: FakeSock())
    se._send_unicast(b"x", "127.0.0.2")
    assert sent == [("127.0.0.2", se.BROADCAST_PORT)]


# ---------------------------------------------------------------------------
# CHANGE 2: pairing reachability gate
# ---------------------------------------------------------------------------
def _fake_send(monkeypatch, sink):
    monkeypatch.setattr(se, "_send_unicast", lambda payload, dest: sink.append(dest))
    monkeypatch.setattr(se, "build_join_challenge", lambda pub, ip: (b"challenge", "n"))


def test_offer_is_answered_while_registry_empty(monkeypatch):
    """Baseline: a machine with no peers answers a heard offer (the salvo
    still guarantees at least one challenge datagram)."""
    sink = []
    _fake_send(monkeypatch, sink)
    se._handle_offer("10.0.0.9", b"pub", "ROOM 1", "127.0.0.1")
    assert len(sink) >= 1


def test_offer_is_ignored_while_a_healthy_peer_exists(monkeypatch):
    """A formed cluster must keep ignoring offers (anti-rekey rail)."""
    se.PEERS.add("10.0.0.5")
    sink = []
    _fake_send(monkeypatch, sink)
    with se._peer_failures_lock:
        se._peer_failures["10.0.0.5"] = 0
    se._handle_offer("10.0.0.9", b"pub", "ROOM 1", "127.0.0.1")
    assert sink == []


def test_offer_is_answered_again_when_every_peer_fails(monkeypatch):
    """KEY-MISMATCH RECOVERY: PEERS non-empty but every entry at/over the
    drop threshold means the registry is de facto dead — re-pairing must be
    allowed again instead of looping on 403s until the misses drop it."""
    se.PEERS.add("10.0.0.5")
    sink = []
    _fake_send(monkeypatch, sink)
    with se._peer_failures_lock:
        se._peer_failures["10.0.0.5"] = se.PEER_MAX_CONSECUTIVE_FAILURES
    assert se._peers_all_failing()
    se._handle_offer("10.0.0.9", b"pub", "ROOM 1", "127.0.0.1")
    assert len(sink) >= 1


def test_offer_still_ignored_when_any_peer_still_works(monkeypatch):
    """One healthy peer among several blocks re-pairing: the cluster is not
    broken enough to justify handing the key to strangers."""
    se.PEERS.update({"10.0.0.5", "10.0.0.6"})
    sink = []
    _fake_send(monkeypatch, sink)
    with se._peer_failures_lock:
        se._peer_failures["10.0.0.5"] = se.PEER_MAX_CONSECUTIVE_FAILURES
        se._peer_failures["10.0.0.6"] = 0
    se._handle_offer("10.0.0.9", b"pub", "ROOM 1", "127.0.0.1")
    assert sink == []


# ---------------------------------------------------------------------------
# CHANGE 4: stale-packet visibility
# ---------------------------------------------------------------------------
def test_stale_discovery_leaves_one_crash_log_line(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    old = se.build_discovery_payload("127.0.0.2", now=time.time() - 400)
    # clock difference with a stale timestamp: signature VALID, age too old
    assert se.parse_discovery_payload(old, "127.0.0.1") is None
    assert lines and "old" in lines[0] and "127.0.0.2" in lines[0], lines


def test_stale_nudge_leaves_one_crash_log_line(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    old = se.build_nudge_payload("127.0.0.2", now=time.time() - 400)
    assert se.parse_nudge_payload(old, "127.0.0.1") is None
    assert lines and "nudge" in lines[0].lower(), lines


def test_stale_offer_leaves_one_crash_log_line(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    old = se.build_offer_payload("127.0.0.2", now=time.time() - 400)
    assert old is not None
    assert se.parse_offer_payload(old, "127.0.0.1") is None
    assert lines, lines


def test_fresh_discovery_is_not_logged_as_stale(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    fresh = se.build_discovery_payload("127.0.0.2", now=time.time())
    assert se.parse_discovery_payload(fresh, "127.0.0.1") is not None
    assert lines == []


def test_stale_logging_is_throttled_per_kind(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    now = time.time()
    for _ in range(3):
        old = se.build_discovery_payload("127.0.0.2", now=now - 400)
        assert se.parse_discovery_payload(old, "127.0.0.1") is None
    # first drop logs, the two repeats within the 60s window stay quiet
    assert len(lines) == 1, lines


# ---------------------------------------------------------------------------
# PAIRING ROBUSTNESS REQUEST (hardening round): verbose [PASADA-SYNC] event
# logging with ignore reasons, a short challenge/retry salvo, a 3-envelope
# reply salvo, post-adoption fingerprint logging, startup line fields,
# get_local_ip loopback fallback, and per-peer pull outcome logging.
# ---------------------------------------------------------------------------
def test_diagnostics_endpoint_reports_engine_state():
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    # The endpoint requires auth like every other /system endpoint.
    res = client.get("/api/sync/diagnostics")
    assert res.status_code in (401, 403), res.text


def test_diagnostics_endpoint_shape_when_signed_in():
    """Full contract check on a private test DB: sign in, read the snapshot,
    require every key the frontend Connections panel consumes."""
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from passlib.context import CryptContext
    from main import app, get_db
    from database import Base, User

    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_sync_diag.db"))
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

    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    db.add(User(first_name="DIAG", last_name="ADMIN", username="DIAG ADMIN",
                password_hash=pwd_context.hash("diagpass123"), role="Admin"))
    db.commit()
    db.close()

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        res = client.post("/token", json={"username": "DIAG ADMIN", "password": "diagpass123"})
        assert res.status_code == 200, res.text
        headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
        data = client.get("/api/sync/diagnostics", headers=headers).json()
        for key in ("crypto_ok", "pairing_enabled", "secret_fingerprint", "peers",
                    "peer_status", "auto_pair_events", "last_sync_check",
                    "sync_port", "api_port", "local_ip", "all_local_ips"):
            assert key in data, f"missing diagnostics key: {key}"
        assert data["secret_fingerprint"] == se.cluster_secret_fingerprint()
        assert isinstance(data["peers"], list) and isinstance(data["peer_status"], dict)
    finally:
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


@pytest.fixture(autouse=True)
def _clean_sync_log_state(monkeypatch):
    """Event-log throttle map cleared per test; retry constants restored."""
    old = dict(getattr(se, "_sync_log_throttle", {"__absent__": 0}))
    old_attempts = se._CHALLENGE_ATTEMPTS, se._CHALLENGE_GAP_SECONDS
    old_reply = se._REPLY_ATTEMPTS, se._REPLY_GAP_SECONDS
    se._sync_log_throttle.clear()
    yield
    se._sync_log_throttle.clear()
    se._CHALLENGE_ATTEMPTS, se._CHALLENGE_GAP_SECONDS = old_attempts
    se._REPLY_ATTEMPTS, se._REPLY_GAP_SECONDS = old_reply


class _Rec:
    """force_log capture passed as a list of strings."""
    pass


# ---------------------------------------------------------------------------
# VERBOSITY: every ignored offer says WHY
# ---------------------------------------------------------------------------
def test_offer_ignored_because_pairing_off_logs_reason(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    monkeypatch.setattr(se, "auto_pairing_enabled", lambda: False)
    se._handle_offer("10.0.0.9", b"pub", "ROOM 1", "127.0.0.1")
    assert any("IGNORED" in ln and "auto-pairing" in ln for ln in lines), lines


def test_offer_ignored_because_paired_logs_reason(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    se.PEERS.add("10.0.0.5")
    with se._peer_failures_lock:
        se._peer_failures["10.0.0.5"] = 0
    se._handle_offer("10.0.0.9", b"pub", "ROOM 1", "127.0.0.1")
    assert any("IGNORED" in ln and ("already" in ln or "working peer" in ln)
               for ln in lines), lines


def test_challenge_send_is_logged_with_peer(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    sink = []
    _fake_send(monkeypatch, sink)
    se._handle_offer("10.0.0.9", b"pub", "ROOM 1", "127.0.0.1")
    assert any("challenge" in ln.lower() and "10.0.0.9" in ln for ln in lines), lines


# ---------------------------------------------------------------------------
# RETRY SALVOS: one in-flight UDP loss must not kill the handshake
# ---------------------------------------------------------------------------
def test_challenge_send_is_retried_in_a_short_salvo(monkeypatch):
    monkeypatch.setattr(se, "_CHALLENGE_ATTEMPTS", 3)
    monkeypatch.setattr(se, "_CHALLENGE_GAP_SECONDS", 0)
    sink = []
    _fake_send(monkeypatch, sink)
    se._handle_offer("10.0.0.9", b"pub", "ROOM 1", "127.0.0.1")
    assert len(sink) == 3, sink


def test_secret_reply_is_retried_with_a_fresh_envelope_each_attempt(monkeypatch):
    monkeypatch.setattr(se, "_REPLY_ATTEMPTS", 3)
    monkeypatch.setattr(se, "_REPLY_GAP_SECONDS", 0)
    sent = []
    monkeypatch.setattr(se, "_send_unicast", lambda payload, dest: sent.append(payload))
    # Joiner's pub = our own pub: the envelope round-trips, attempts are
    # independently decryptable, and re-encryption must differ per attempt.
    se._maybe_send_secret("10.0.0.9", se._PAIRING_PUB, "ROOM 1", "127.0.0.1")
    assert len(sent) == 3, sent
    assert len(set(sent)) == 3, "every reply attempt must carry a fresh AES key/nonce"


def test_secret_reply_attempts_all_decrypt(monkeypatch):
    monkeypatch.setattr(se, "_REPLY_ATTEMPTS", 3)
    monkeypatch.setattr(se, "_REPLY_GAP_SECONDS", 0)
    sent = []
    monkeypatch.setattr(se, "_send_unicast", lambda payload, dest: sent.append(payload))
    se._maybe_send_secret("10.0.0.9", se._PAIRING_PUB, "ROOM 1", "127.0.0.1")
    for payload in sent:
        plaintext = se.parse_join_reply(payload)
        assert plaintext is not None and plaintext.startswith(b"PASADA_SECRET:")
        assert plaintext[len(b"PASADA_SECRET:"):] == se.CLUSTER_SECRET.encode("utf-8")


# ---------------------------------------------------------------------------
# STARTUP SELF-DIAGNOSIS: ip, auto-pair state, peers, fingerprint
# ---------------------------------------------------------------------------
def test_startup_line_names_autopair_state_and_peer_count(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    se._log_sync_startup()
    assert any("auto-pairing" in ln for ln in lines), lines
    assert any("known peers" in ln for ln in lines), lines
    assert any("fingerprint" in ln for ln in lines), lines
    assert any("local ip" in ln for ln in lines), lines


# ---------------------------------------------------------------------------
# get_local_ip: never strand a machine on 127.0.0.1 when it has a LAN address
# ---------------------------------------------------------------------------
def test_get_local_ip_falls_back_to_lan_address(monkeypatch):
    monkeypatch.setattr(se, "_SYNC_LOCAL_IP_ENV", "")  # the conftest sandbox pins one
    monkeypatch.setattr(se, "_local_ipv4_addresses", lambda: ["192.168.7.7"])

    class _DeadSock:
        def __init__(self, *a, **k):
            pass

        def connect(self, addr):
            raise OSError("no route to host")

        def getsockname(self):
            raise OSError("not connected")

        def close(self):
            pass

    monkeypatch.setattr(se.socket, "socket", lambda *a, **k: _DeadSock())
    assert se.get_local_ip() == "192.168.7.7", se.get_local_ip()


# ---------------------------------------------------------------------------
# PER-PEER SYNC OUTCOME LOG: every pull cycle says ok/failed, throttled
# ---------------------------------------------------------------------------
def _drive_sync_cycles(monkeypatch, fake_get, passes=1):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import Base

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    MemSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    monkeypatch.setattr(se, "SessionLocal", MemSession)
    monkeypatch.setattr(se, "PEERS", {"192.168.7.7"})
    monkeypatch.setattr(se, "_peer_failures", {})
    monkeypatch.setattr(se.requests, "get", fake_get)
    state = {"n": 0}

    def controlled_wait(timeout=None):
        state["n"] += 1
        if state["n"] > passes:
            raise KeyboardInterrupt
        return False

    monkeypatch.setattr(se._wake_pull_loop, "wait", controlled_wait)
    try:
        with pytest.raises(KeyboardInterrupt):
            se.sync_with_peers()
    finally:
        engine.dispose()
    return state


def test_pull_success_is_logged_per_peer(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))

    def fake_get(url, headers=None, timeout=None):
        return _FakeOk({"records": [], "users": []})

    _drive_sync_cycles(monkeypatch, fake_get)
    assert any("pull from 192.168.7.7" in ln and "OK" in ln for ln in lines), lines


def test_pull_failure_is_logged_with_reason_each_cycle(monkeypatch):
    lines = []
    monkeypatch.setattr(se, "force_log", lambda msg: lines.append(msg))
    monkeypatch.setattr(se, "PEER_MAX_CONSECUTIVE_FAILURES", 3)

    def fake_get(url, headers=None, timeout=None):
        raise ConnectionError("connection reset")

    _drive_sync_cycles(monkeypatch, fake_get, passes=4)
    assert any("FAILED" in ln and "connection reset" in ln for ln in lines), lines
    assert any("unreachable after 3" in ln for ln in lines), lines


class _FakeOk:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200
        self.ok = True

    def json(self):
        return self._payload


# ---------------------------------------------------------------------------
# WATERMARK TIES: a record stamped EXACTLY at since= must still be pulled
# ---------------------------------------------------------------------------
def test_pull_payload_includes_record_stamped_at_the_watermark():
    from datetime import datetime
    from fastapi.testclient import TestClient
    from main import app
    from database import FranchiseRecord
    import time as _time

    marker = "TIEPULL-001"
    db = se.SessionLocal()
    try:
        db.query(FranchiseRecord).filter(FranchiseRecord.sbn_no == marker).delete(
            synchronize_session=False)
        stamp = datetime.now()
        db.add(FranchiseRecord(route="TIEPULL", operator_name="TIE OPERATOR",
                               sbn_no=marker, updated_at=stamp))
        db.commit()
        supplied = stamp.isoformat()

        ts = str(int(_time.time()))
        nonce = se.secrets.token_hex(8)
        body = f"PULL:127.0.0.1:{ts}:{nonce}".encode("utf-8")
        client = TestClient(app)
        res = client.get(
            f"/api/sync/pull?since={supplied}",
            headers={
                "X-Cluster-Timestamp": ts,
                "X-Cluster-Nonce": nonce,
                "X-Cluster-Signature": se._hmac_hex(body),
            },
        )
        assert res.status_code == 200, res.text
        sbns = [r.get("sbn_no") for r in res.json().get("records", [])]
        assert marker in sbns, f"watermark-tie row was dropped: {sbns[-3:]}"
    finally:
        try:
            db.query(FranchiseRecord).filter(FranchiseRecord.sbn_no == marker).delete(
                synchronize_session=False)
            db.commit()
        finally:
            db.close()
