# SUITE-WIDE SYNC SANDBOX (must exist before any test module is imported,
# because pytest imports conftest.py first).
#
# WHY: these integration tests run on machines that Sit on a REAL office LAN.
# The production listener threads spawned by TestClient/uvicorn lifespans
# accept any discovery/nudge datagram signed with the cluster secret — and an
# actual office computer on the same LAN (broadcasting from, e.g.,
# 192.168.1.18) then lands in sync_engine.PEERS as a bare IP. Tests that pin
# their own port-bearing peers (test_two_database_sync) then crash on
# rsplitted "ip:port" entries and MISS pulls that have nothing to do with
# the code under test. Pinning the engine's whole broadcast/listening stack
# to a dedicated loopback port cuts every test run off from the real LAN.
#
# setdefault: an explicit runner-provided override (live_pairing_test spawns
# its machines with their own peer settings) still wins.

import os

os.environ.setdefault("PASADA_SYNC_PORT", "54399")
os.environ.setdefault("PASADA_SYNC_BIND", "127.0.0.1:54399")
os.environ.setdefault("PASADA_SYNC_TARGETS", "127.0.0.1:54399")
os.environ.setdefault("PASADA_SYNC_LOCAL_IP", "127.0.0.1")
