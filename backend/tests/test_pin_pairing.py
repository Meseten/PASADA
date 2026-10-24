# PIN PAIRING TESTS: the manual, office-run path into the cluster. An Admin
# on the HOST computer arms a 6-digit PIN; a JOINER computer (whose scope
# may be off, whose key may be half-formed, or which simply missed every
# broadcast) enters that PIN. The cluster secret crosses the LAN only inside
# an envelope the joiner itself rolls: the joiner picks a fresh salt, the
# host re-encrypts the secret under SHA256(pin+salt), and only the machine
# that typed the PIN can open the reply. The secret never crosses the wire
# in the clear, and the PIN itself is only ever compared as a hash.
#
# Wire protocol (both sides):
#   joiner -> "PASADA_PINJOIN:<ver>:<ip>:<salt_hex>:<ct_hex>:<name_b64>"
#             ct = AESGCM(sha256(pin+salt), nonce=salt) b"PASADA_PINASK"
#   host   -> (3 salvo datagrams)
#             "PASADA_PINREPLY:<ct_hex>"
#             ct = AESGCM(sha256(pin+salt), nonce=salt) b"PASADA_SECRET:"+key
#   joiner adopts via _adopt_cluster_secret (same path as auto-pairing).
import hashlib
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import sync_engine as se  # noqa: E402


def _clean_pin_state():
    se._pin_pairing.clear()
    se._pin_attempts.clear()
    se._pending_pin_join = {}
    se._auto_pair_events.clear()


def _salt() -> str:
    return os.urandom(16).hex()


def _ask(pin: str, salt: str):
    key = hashlib.sha256((pin + salt).encode("utf-8")).digest()
    return AESGCM(key).encrypt(salt.encode("utf-8"), b"PASADA_PINASK", None)


@pytest.fixture(autouse=True)
def _fresh_pin_state():
    _clean_pin_state()
    yield
    _clean_pin_state()


def test_arm_pin_generates_and_stores_a_hash_only():
    pin = se.arm_pairing_pin("482613")
    assert pin == "482613"
    # The digits must not leak onto the wire or into the audit ledger —
    # they live host-side in volatile memory only:
    blob = se.build_pin_join("10.0.0.5", "JR-PC", pin, _salt(), _ask(pin, _salt()))
    assert blob is not None and b"482613" not in blob
    assert not any("482613" in ev for ev in se.get_auto_pair_events())


def test_arm_pin_rejects_bad_values_and_re_arms_cleanly():
    for bad in ("", "12", "abc123", "1234567", "482 613", None):
        with pytest.raises((ValueError, TypeError)):
            se.arm_pairing_pin(bad)
    se.arm_pairing_pin("426917")
    armed_at = se._pin_pairing["armed_at"]
    se.arm_pairing_pin("849203")
    assert len(se._pin_pairing) == 2  # pin + armed_at, re-armed
    assert se._pin_pairing["armed_at"] >= armed_at


def test_correct_pin_join_earns_secret_not_in_clear():
    pin = se.arm_pairing_pin("426917")
    salt = _salt()
    reply = se.respond_to_pin_join(
        "10.0.0.2", "JR-PC", pin, salt, _ask(pin, salt)
    )
    assert reply is not None, "a correct PIN must earn the cluster key"
    assert reply.startswith(b"PASADA_PINREPLY:")
    assert se.CLUSTER_SECRET.encode() not in reply
    assert any("via PIN" in ev for ev in se.get_auto_pair_events())
    assert any("JR-PC" in ev for ev in se.get_auto_pair_events())


def test_wrong_pin_refused_and_joiner_locked_out_after_max_attempts(monkeypatch):
    captured = []
    monkeypatch.setattr(se, "force_log", lambda line: captured.append(line))
    pin = se.arm_pairing_pin("426917")
    # A rogue joiner sealed its envelope with ITS OWN guess ("000000"),
    # not the armed PIN — exactly what happens on the wire. The host runs
    # respond_to_pin_join with the armed pin; the envelope can never open.
    salt = _salt()
    rogue_ct = _ask("000000", salt)
    for _ in range(se.PAIRING_PIN_MAX_ATTEMPTS):
        assert se.respond_to_pin_join(
            "10.0.0.9", "ROGUE-PC", pin, salt, rogue_ct
        ) is None
    for _ in range(5):
        assert se.respond_to_pin_join(
            "10.0.0.9", "ROGUE-PC", pin, _salt(), rogue_ct
        ) is None, "after max attempts the joiner is locked out"
    assert any("wrong PIN from ROGUE-PC" in line for line in captured), captured[-4:]
    # A DIFFERENT machine with the correct pin is unaffected:
    ok_salt = _salt()
    ok = se.respond_to_pin_join("10.0.0.3", "GOOD-PC", pin, ok_salt, _ask(pin, ok_salt))
    assert ok is not None


def test_expired_pin_refused(monkeypatch):
    pin = se.arm_pairing_pin("426917")
    armed_at = se._pin_pairing["armed_at"]
    monkeypatch.setattr(se, "_pin_now", lambda: armed_at + se.PAIRING_PIN_TTL_SECONDS + 1)
    salt = _salt()
    assert se.respond_to_pin_join(
        "10.0.0.3", "LATE-PC", pin, salt, _ask(pin, salt)
    ) is None


def test_cleared_pin_refused():
    pin = se.arm_pairing_pin("426917")
    assert se.clear_pairing_pin() is True
    salt = _salt()
    assert se.respond_to_pin_join(
        "10.0.0.3", "X-PC", pin, salt, _ask(pin, salt)
    ) is None
    assert se.clear_pairing_pin() is False  # already clear


def test_full_roundtrip_and_adoption():
    pin = se.arm_pairing_pin("931864")
    salt = _salt()
    host_reply = se.respond_to_pin_join(
        "10.0.0.2", "HOST-PC", pin, salt, _ask(pin, salt)
    )
    blob = se.build_pin_join("10.0.0.5", "JR-PC", pin, salt, _ask(pin, salt))
    assert blob is not None
    assert blob.startswith(b"PASADA_PINJOIN:")
    assert se.CLUSTER_SECRET.encode() not in blob

    parsed = se.parse_pin_reply(host_reply, pin, salt)
    assert parsed == se.CLUSTER_SECRET

    # One flipped ciphertext byte must not open.
    tampered = host_reply[:-1] + bytes([host_reply[-1] ^ 1])
    assert se.parse_pin_reply(tampered, pin, salt) is None
    # A wrong pin on the joiner side cannot adopt the reply either.
    assert se.parse_pin_reply(host_reply, "111111", salt) is None
    # Parse the join blob back into its parts (host listener's job):
    parts = se.parse_pin_join(blob)
    assert parts is not None
    parsed_ip, parsed_salt, parsed_ct, parsed_name = parts
    assert parsed_ip == "10.0.0.5"
    assert parsed_salt == salt
    assert parsed_name == "JR-PC"
    assert se.respond_to_pin_join(
        "10.0.0.5", parsed_name, pin, parsed_salt, parsed_ct
    ) == host_reply


def test_malformed_join_payloads_refused():
    pin = se.arm_pairing_pin("426917")
    salt = _salt()
    good_ct = _ask(pin, salt)
    # Malformed blobs fail to parse at all:
    for junk in (b"", b"PASADA_PINJOIN:", b"PASADA_PINJOIN:1:ip:salt:ct",
                 b"PASADA_PINJOIN:1:ip:salt:not_hex:name"):
        assert se.parse_pin_join(junk) is None
    # Malformed request arguments inside the host responder refuse:
    assert se.respond_to_pin_join("10.0.0.6", "BAD-PC", pin, "shortsalt", good_ct) is None
    assert se.respond_to_pin_join("10.0.0.6", "BAD-PC", pin, salt, b"junk") is None
    assert se.respond_to_pin_join("10.0.0.6", "BAD-PC", pin, salt, b"") is None
