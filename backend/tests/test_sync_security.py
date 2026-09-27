# Security: HMAC-signed LAN discovery and signed sync pulls.
# The cluster secret must never cross the network in readable form.

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import time
import platform
import sync_engine
from sync_engine import build_discovery_payload, parse_discovery_payload
from main import _verify_pull_signature, PULL_MAX_AGE_SECONDS


def test_discovery_payload_has_no_secret():
    payload = build_discovery_payload("192.168.1.10")
    assert b"PASADA_NODE:" in payload
    assert sync_engine.CLUSTER_SECRET.encode() not in payload


def test_discovery_roundtrip_accepts_valid():
    payload = build_discovery_payload("192.168.1.10")
    result = parse_discovery_payload(payload, "192.168.1.99", now=time.time())
    assert result == ("192.168.1.10", sync_engine.COMPUTER_NAME)


def test_discovery_rejects_tampered_ip():
    payload = build_discovery_payload("192.168.1.10")
    forged = payload.replace(b"192.168.1.10", b"192.168.1.66")
    assert parse_discovery_payload(forged, "192.168.1.99", now=time.time()) is None


def test_discovery_rejects_stale_timestamp():
    payload = build_discovery_payload("192.168.1.10", now=time.time() - 4000)
    assert parse_discovery_payload(payload, "192.168.1.99", now=time.time()) is None


def test_discovery_rejects_garbage():
    assert parse_discovery_payload(b"hello world", "192.168.1.99") is None
    assert parse_discovery_payload(b"", "192.168.1.99") is None


def test_discovery_ignores_own_broadcast():
    payload = build_discovery_payload("192.168.1.10")
    assert parse_discovery_payload(payload, "192.168.1.10", now=time.time()) is None


def test_discovery_rejects_old_format():
    # The pre-HMAC wire format carried the raw secret; it must never verify.
    old = f"PASADA_NODE:{sync_engine.CLUSTER_SECRET}:192.168.1.10".encode()
    assert parse_discovery_payload(old, "192.168.1.99", now=time.time()) is None


def test_pull_signature_roundtrip():
    # The caller signs the host it ADDRESSED. Loopback is always an accepted
    # target (dev and tests run on the same machine), so sign that.
    ts = str(int(time.time()))
    nonce = "abc123"
    import hmac as _hmac
    import hashlib as _hashlib
    body = f"PULL:127.0.0.1:{ts}:{nonce}".encode()
    sig = _hmac.new(sync_engine.CLUSTER_SECRET.encode(), body, _hashlib.sha256).hexdigest()
    assert _verify_pull_signature(ts, nonce, sig) is True


def test_pull_signature_rejects_unaddressed_host():
    # A signature over an IP that is not this machine must fail closed even
    # with the correct secret: the request was aimed somewhere else.
    ts = str(int(time.time()))
    nonce = "other-host-nonce"
    import hmac as _hmac
    import hashlib as _hashlib
    body = f"PULL:203.0.113.7:{ts}:{nonce}".encode()
    sig = _hmac.new(sync_engine.CLUSTER_SECRET.encode(), body, _hashlib.sha256).hexdigest()
    assert _verify_pull_signature(ts, nonce, sig) is False


def test_pull_signature_rejects_wrong_secret():
    ts = str(int(time.time()))
    nonce = "unique-nonce-1"
    import hmac as _hmac
    import hashlib as _hashlib
    body = f"PULL:127.0.0.1:{ts}:{nonce}".encode()
    sig = _hmac.new(b"not-the-secret", body, _hashlib.sha256).hexdigest()
    assert _verify_pull_signature(ts, nonce, sig) is False


def test_pull_signature_rejects_replay():
    import hmac as _hmac
    import hashlib as _hashlib
    ts = str(int(time.time()))
    nonce = "replay-test-nonce"
    body = f"PULL:127.0.0.1:{ts}:{nonce}".encode()
    sig = _hmac.new(sync_engine.CLUSTER_SECRET.encode(), body, _hashlib.sha256).hexdigest()
    assert _verify_pull_signature(ts, nonce, sig) is True
    # Same signature a second time must fail: replay protection.
    assert _verify_pull_signature(ts, nonce, sig) is False


def test_broadcast_replay_rejected():
    # A captured broadcast replayed later must not register the peer twice.
    payload = build_discovery_payload("192.168.1.77", now=time.time())
    first = parse_discovery_payload(payload, "192.168.1.99", now=time.time())
    second = parse_discovery_payload(payload, "192.168.1.99", now=time.time())
    assert first == ("192.168.1.77", sync_engine.COMPUTER_NAME)
    assert second is None


def test_discovery_carries_and_verifies_name():
    # The friendly computer name rides inside the signed body: readable, but
    # a tampered name breaks the signature like any other field.
    sync_engine.COMPUTER_NAME = "Front Desk"
    payload = build_discovery_payload("192.168.1.42")
    assert b"Front Desk" in payload
    result = parse_discovery_payload(payload, "192.168.1.99", now=time.time())
    assert result == ("192.168.1.42", "Front Desk")
    forged = payload.replace(b"Front Desk", b"Spooky Box")
    assert parse_discovery_payload(forged, "192.168.1.99", now=time.time()) is None
    sync_engine.COMPUTER_NAME = "PASADA"


def test_computer_name_never_defaults_to_hostname():
    # The broadcast label is the signed-in ACCOUNT's name (or the neutral
    # "PASADA" placeholder), never the machine's hostname.
    assert sync_engine.COMPUTER_NAME != platform.node()
    assert sync_engine.COMPUTER_NAME in ("PASADA", "BEN JAMES DUAG")


def test_pull_signature_rejects_stale():
    import hmac as _hmac
    import hashlib as _hashlib
    ts = str(int(time.time()) - PULL_MAX_AGE_SECONDS - 60)
    nonce = "stale-nonce"
    body = f"PULL:127.0.0.1:{ts}:{nonce}".encode()
    sig = _hmac.new(sync_engine.CLUSTER_SECRET.encode(), body, _hashlib.sha256).hexdigest()
    assert _verify_pull_signature(ts, nonce, sig) is False


def test_pull_signature_rejects_garbage():
    assert _verify_pull_signature("1", "n", "sig") is False
    assert _verify_pull_signature("not-a-number", "n", "sig") is False
    assert _verify_pull_signature("", "", "") is False
