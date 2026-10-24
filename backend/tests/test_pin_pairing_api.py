# PIN PAIRING API TESTS: the endpoints the Connections card calls. The
# interesting cases beyond the unit suite: only Admin may arm/join, the arm
# response carries the digits exactly once, a clerk is 403, a bad PIN shape
# is 400 rather than a crash, and clearing after arming flips status armed
# from True to False.
import os
import sys

import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app, get_db  # noqa: E402
from tests.test_two_key_admin import client, _token  # noqa: E402  (pytest fixtures)


def test_clerk_cannot_arm_or_join(client):
    clerk = _token(client, "CLERK WORKER", "clerkone1")
    res = client.post("/system/pairing-pin/arm", headers=clerk, json={})
    assert res.status_code == 403, res.text
    res = client.post("/system/pairing-pin/join", headers=clerk, json={"pin": "123456"})
    assert res.status_code == 403, res.text
    res = client.get("/system/pairing-pin/status", headers=clerk)
    assert res.status_code == 403, res.text


def test_arm_pin_response_once_and_status_round(client):
    admin = _token(client, "ADMIN ONE", "adminone1")
    res = client.post("/system/pairing-pin/arm", headers=admin, json={"pin": "718253"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["pin"] == "718253"
    assert body["expires_in_seconds"] > 0
    # status must never echo the digits:
    status = client.get("/system/pairing-pin/status", headers=admin)
    assert status.status_code == 200
    assert status.json()["armed"] is True
    assert "718253" not in status.text
    cleared = client.post("/system/pairing-pin/clear", headers=admin)
    assert cleared.status_code == 200
    assert client.get("/system/pairing-pin/status", headers=admin).json()["armed"] is False


def test_arm_rejects_bad_pin_shapes(client):
    admin = _token(client, "ADMIN ONE", "adminone1")
    for bad in ("12", "abc123", "12345678"):
        res = client.post("/system/pairing-pin/arm", headers=admin, json={"pin": bad})
        assert res.status_code == 400, res.text


def test_arm_can_generate_when_pin_omitted(client):
    admin = _token(client, "ADMIN ONE", "adminone1")
    res = client.post("/system/pairing-pin/arm", headers=admin, json={})
    assert res.status_code == 200, res.text
    pin = res.json()["pin"]
    assert isinstance(pin, str) and pin.isdigit() and len(pin) == 6


def test_join_rejects_junk_host_ip(client):
    """host_ip goes into a wire payload — anything that is not a sane IPv4
    literal must be refused before the sync engine ever sends to it."""
    admin = _token(client, "ADMIN ONE", "adminone1")
    for bad in ("not an ip", "999.999.999.999", "http://evil", "; rm -rf /"):
        res = client.post("/system/pairing-pin/join", headers=admin,
                          json={"pin": "123456", "host_ip": bad}, timeout=30)
        assert res.status_code == 400, res.text
        assert "host_ip" in res.text
