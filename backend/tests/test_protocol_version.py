import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import time
import sync_engine
from sync_engine import build_discovery_payload, parse_discovery_payload, DISCOVERY_PROTOCOL_VERSION


def test_discovery_payload_carries_version_field():
    payload = build_discovery_payload("192.168.1.10")
    parts = payload.decode('utf-8').split(":")
    assert parts[0] == "PASADA_NODE"
    assert parts[1] == str(DISCOVERY_PROTOCOL_VERSION)


def test_discovery_roundtrip_accepts_matching_version():
    payload = build_discovery_payload("192.168.1.10")
    result = parse_discovery_payload(payload, "192.168.1.99", now=time.time())
    assert result is not None
    assert result[0] == "192.168.1.10"


def test_discovery_rejects_other_version_quietly():
    # A v2 broadcaster talking to a v1 receiver: not an error, just a
    # different dialect. Must be dropped without exception and without
    # adding a peer.
    payload = build_discovery_payload("192.168.1.10")
    parts = payload.decode('utf-8').split(":")
    parts[1] = "999"  # a future version
    future = ":".join(parts).encode('utf-8')
    assert parse_discovery_payload(future, "192.168.1.99", now=time.time()) is None


def test_discovery_legacy_6_field_payload_rejected():
    # The pre-versioning format (no version field) must not half-parse: an
    # old machine's broadcast is a different dialect, not garbage to guess at.
    legacy = b"PASADA_NODE:192.168.1.10:1730000000:abcd1234:FRONT DESK:deadbeef"
    assert parse_discovery_payload(legacy, "192.168.1.99", now=1730000000) is None
