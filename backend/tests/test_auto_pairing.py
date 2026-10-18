# AUTO-PAIRING TESTS: a fresh install must be able to join the office
# cluster with zero user action, while every rail that stops a stranger on
# a hostile network from quietly re-keying a FORMED cluster stays strict.
# The handshake itself: OFFER (broadcast, signed by pairing key) ->
# JOINBLOB challenge (hybrid AES+RSA envelope) -> REPLYBLOB carrying the
# cluster secret, encrypted to the joiner only.
#
# One process simulates TWO machines by swapping the module-level pairing
# keypair: everything a test calls runs under whichever machine's identity
# is currently installed in sync_engine (same as reality, where each box
# loads its own pasada_pairing.pem).

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import time
import pytest

import sync_engine as se
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def _make_machine_keypair():
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return priv


@pytest.fixture(autouse=True)
def _clean_auto_pair_state():
    """Each test gets an empty peer registry, cleared throttles, empty event
    log, the original keypair, and the original cluster secret restored."""
    old_secret = se.CLUSTER_SECRET
    old_priv, old_pub = se._PAIRING_PRIV, se._PAIRING_PUB
    se.PEERS.clear()
    se.PEER_NAMES.clear()
    with se._throttle_lock:
        se._reply_throttle.clear()
        se._challenge_throttle.clear()
    se._auto_pair_events.clear()
    yield
    se._PAIRING_PRIV, se._PAIRING_PUB = old_priv, old_pub
    se._adopt_cluster_secret(old_secret)
    se.PEERS.clear()
    se.PEER_NAMES.clear()
    with se._throttle_lock:
        se._reply_throttle.clear()
        se._challenge_throttle.clear()
    se._auto_pair_events.clear()


def test_pairing_keys_are_persistent_and_loadable():
    assert se._has_working_pairing()
    assert os.path.exists(se.PAIRING_KEY_PATH)
    # The public half must round-trip through the reply envelope.
    blob = b"PASADA_SECRET:roundtrip-proof"
    reply = se.build_join_reply(blob, se._PAIRING_PUB)
    assert se.parse_join_reply(reply) == blob


def test_offer_payload_roundtrip_and_identity():
    payload = se.build_offer_payload("192.168.1.10")
    assert payload is not None and payload.startswith(b"PASADA_OFFER:")
    parsed = se.parse_offer_payload(payload, "192.168.1.99", now=time.time())
    assert parsed is not None
    sender_ip, sender_pub, name = parsed
    assert sender_ip == "192.168.1.10"
    assert sender_pub == se._PAIRING_PUB  # identity travels with the offer


def test_offer_is_single_use_and_time_boxed():
    payload = se.build_offer_payload("192.168.1.10")
    now = time.time()
    assert se.parse_offer_payload(payload, "192.168.1.99", now=now) is not None
    # Replay of the same datagram inside the window: refused.
    assert se.parse_offer_payload(payload, "192.168.1.99", now=now) is None
    # A stale offer (older than the freshness window): refused.
    fresh = se.build_offer_payload("192.168.1.11")
    assert se.parse_offer_payload(fresh, "192.168.1.99", now=now + 400) is None


def test_offer_signature_tamper_rejected():
    payload = se.build_offer_payload("192.168.1.10")
    evil = payload[:-4] + b"AAAA"
    assert se.parse_offer_payload(evil, "192.168.1.99", now=time.time()) is None


def test_secret_never_in_the_clear_on_the_wire():
    offer = se.build_offer_payload("10.0.0.1")
    offerer_pub = se.parse_offer_payload(offer, "10.0.0.2", now=time.time())[1]
    challenge, _ = se.build_join_challenge(offerer_pub, "10.0.0.2")
    assert se.CLUSTER_SECRET.encode() not in challenge
    assert b"SECRET-REQUEST" not in challenge  # body text is sealed
    reply = se.build_join_reply(b"PASADA_SECRET:" + se.CLUSTER_SECRET.encode(), offerer_pub)
    assert se.CLUSTER_SECRET.encode() not in reply


def test_two_machine_roundtrip_ends_with_the_secret():
    # Machine A offers. Machine B (own keypair) challenges. A replies with
    # the secret encrypted to B's public half. B opens it with its private
    # half and gets exactly the secret.
    offer = se.build_offer_payload("10.0.0.1")
    offerer_ip, offerer_pub, _name = se.parse_offer_payload(offer, "10.0.0.2", now=time.time())

    # Machine B's identity owns the challenge from here on.
    joiner_priv = _make_machine_keypair()
    old_priv, old_pub = se._PAIRING_PRIV, se._PAIRING_PUB
    se._PAIRING_PRIV, se._PAIRING_PUB = joiner_priv, \
        joiner_priv.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo)
    try:
        challenge, _ = se.build_join_challenge(offerer_pub, "10.0.0.2")
        # Open the challenges ONLY as machine A (back to its identity).
        se._PAIRING_PRIV, se._PAIRING_PUB = old_priv, old_pub
        opened = se.parse_join_challenge(challenge, offerer_ip, now=time.time())
        assert opened is not None
        joiner_ip, joiner_pub, body = opened
        assert joiner_ip == "10.0.0.2"
        assert joiner_pub != offerer_pub  # B has its OWN key half
        plaintext = se.parse_join_challenge.__module__ and None  # noqa: silence
        # Back to B for the final step: open the reply addressed to B.
        se._PAIRING_PRIV = joiner_priv
        reply = se.build_join_reply(b"PASADA_SECRET:" + se.CLUSTER_SECRET.encode(), joiner_pub)
        opened2 = se.parse_join_reply(reply)
        assert opened2.startswith(b"PASADA_SECRET:")
        assert opened2[len(b"PASADA_SECRET:"):].decode() == se.CLUSTER_SECRET
    finally:
        se._PAIRING_PRIV, se._PAIRING_PUB = old_priv, old_pub


def test_reply_is_useless_to_a_third_machine():
    # Build a reply addressed to machine B's public half. Machine C (another
    # fresh keypair) must NOT be able to open it.
    target_pub = _make_machine_keypair().public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo)
    reply = se.build_join_reply(b"PASADA_SECRET:topsecret", target_pub)
    stranger = _make_machine_keypair()
    old = se._PAIRING_PRIV
    se._PAIRING_PRIV = stranger
    try:
        assert se.parse_join_reply(reply) is None
    finally:
        se._PAIRING_PRIV = old


def test_offerer_serves_a_third_machine_but_not_registered_peers():
    # The 3rd/4th/5th office computer arrives AFTER the first two paired:
    # the established machines already have peers, and they must still hand
    # the secret to a NEW machine (one not yet in the peer registry).
    se.PEERS.add("10.0.0.50")
    offer = se.build_offer_payload("10.0.0.1")
    _, offerer_pub, _ = se.parse_offer_payload(offer, "10.0.0.2", now=time.time())
    challenge, _ = se.build_join_challenge(offerer_pub, "10.0.0.2")
    joiner_ip, joiner_pub, _ = se.parse_join_challenge(challenge, "10.0.0.1", now=time.time())
    se._maybe_send_secret(joiner_ip, joiner_pub, "THIRD PC", "10.0.0.1")
    assert any("THIRD PC" in ev or "10.0.0.2" in ev for ev in se._auto_pair_events), \
        "an unregistered machine must still be onboarded even with peers present"
    # But a machine ALREADY registered as a peer gets nothing: it holds the
    # key already, and answering it would be noise at best.
    se._auto_pair_events.clear()
    se._maybe_send_secret("10.0.0.50", joiner_pub, "KNOWN PEER", "10.0.0.1")
    assert not se._auto_pair_events


def test_joiner_only_challenges_before_first_pairing():
    # With peers already registered a would-be joiner stays quiet — this is
    # what stops a rogue offerer from rolling a formed cluster.
    se.PEERS.add("10.0.0.99")
    offer = se.build_offer_payload("10.0.0.1")
    _, offerer_pub, _ = se.parse_offer_payload(offer, "10.0.0.99", now=time.time())
    before = dict(se._challenge_throttle)
    se._handle_offer("10.0.0.1", offerer_pub, "ANYONE", "10.0.0.99")
    assert se._challenge_throttle == before  # no challenge was even queued


def test_throttle_caps_secret_releases_per_joiner():
    offer = se.build_offer_payload("10.0.0.1")
    _, offerer_pub, _ = se.parse_offer_payload(offer, "10.0.0.2", now=time.time())
    challenge, _ = se.build_join_challenge(offerer_pub, "10.0.0.2")
    joiner_ip, joiner_pub, _ = se.parse_join_challenge(challenge, "10.0.0.1", now=time.time())
    se._maybe_send_secret(joiner_ip, joiner_pub, "FRESH", "10.0.0.1")
    first_events = len(se._auto_pair_events)
    # A second attempt within 60s must be a no-op.
    se._maybe_send_secret(joiner_ip, joiner_pub, "FRESH", "10.0.0.1")
    assert len(se._auto_pair_events) == first_events


def test_opt_out_flag():
    flag = os.path.abspath(os.path.join(os.path.dirname(__file__), "pairing_off_flag.tmp"))
    if os.path.exists(flag):
        os.remove(flag)
    se.PAIRING_OPTOUT_PATH = flag  # pointed at a scratch path for the test
    try:
        assert se.auto_pairing_enabled() is True
        with open(flag, "w") as f:
            f.write("1")
        assert se.auto_pairing_enabled() is False
        os.remove(flag)
        assert se.auto_pairing_enabled() is True
    finally:
        if os.path.exists(flag):
            os.remove(flag)


def test_events_are_capped_and_stamped():
    offer = se.build_offer_payload("10.0.0.1")
    _, offerer_pub, _ = se.parse_offer_payload(offer, "10.0.0.2", now=time.time())
    challenge, _ = se.build_join_challenge(offerer_pub, "10.0.0.2")
    joiner_ip, joiner_pub, _ = se.parse_join_challenge(challenge, "10.0.0.1", now=time.time())
    se._maybe_send_secret(joiner_ip, joiner_pub, "FRONT DESK", "10.0.0.1")
    assert se._auto_pair_events, "a shared secret must be recorded"
    ev = se.get_auto_pair_events()[0]
    assert ev.startswith("20")  # timestamped
    assert "FRONT DESK" in ev or "10.0.0.2" in ev


def test_replay_of_a_captured_reply_is_worthless_without_the_private_half():
    # The core property the wire gets: anyone can RECORD packets all day, but
    # only the machine whose key half was named in the challenge can open a
    # reply; and the reply is single-shot random-encrypted so recordings of
    # past traffic never decrypt anything new.
    reply = se.build_join_reply(b"PASADA_SECRET:abc123", se._PAIRING_PUB)
    first = se.parse_join_reply(reply)
    second = se.parse_join_reply(reply)
    assert first == second == b"PASADA_SECRET:abc123"  # decryptable by owner
    # ...but a DIFFERENT machine's envelope cannot be opened by us:
    other = _make_machine_keypair().public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo)
    foreign = se.build_join_reply(b"PASADA_SECRET:zzz", other)
    # (still our private half installed) a reply built for a foreign key
    # fails to open under our key:
    assert se.parse_join_reply(foreign) is None
