"""TWO-DATABASE INTEGRATION TEST.

The office story this test pins down: an admin creates an account on
computer A. Computer B has never heard of that account. One full sync cycle
later, a person standing at computer B can type that username and password
into the login box and get in.

Everything in the loop is real: two separate SQLite database FILES (PC A uses
the app's real production database on this machine; PC B uses a temporary file
so its data can never leak into production), the real FastAPI app served over
HTTP by a live uvicorn thread on the loopback interface, real HMAC pull
signatures from the shared cluster secret, and the real sync pull/merge code.

The one hard rule this test enforces: PC A must keep talking to the production
database for the whole setup and sync phase. The dependency override that
points the app at PC B is installed ONLY for the final login assertion, and it
is removed immediately after. Installing it earlier would silently redirect
PC A's own logins into PC B's empty database (the exact failure mode this
file used to hit).

The only thing simulated is discovery (UDP broadcast forwarding is flaky
inside CI sandboxes), so the test registers PC A's address in the PEERS set
exactly as a heard broadcast would.
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import threading
import time
import tempfile

import pytest
import requests
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

import main
import sync_engine
from main import app, get_db
from database import Base, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

API_PORT = 43991  # dedicated port so the test never collides with a dev server


@pytest.fixture(scope="module", autouse=True)
def _seed_real_database():
    """The app binds its engine to the real platformdirs database at import
    time, so the production DB on this machine IS the integration target for
    PC A. Seed the fixture account with a unique marker username, and remove
    it (and every probe user any earlier test run left behind) afterwards."""
    marker = "SYNC TEST ADMIN"
    clerk = "OPIN CLERK"
    db = sync_engine.SessionLocal()
    try:
        db.query(User).filter(User.username.in_(
            [marker, clerk, "PROBE USER", "PROBE2 USER"])).delete(
            synchronize_session=False)
        db.add(User(first_name="ADMIN", last_name="BOSS", username=marker,
                    password_hash=pwd_context.hash("password123"), role="Admin"))
        db.commit()
        # FAIL LOUD if the seed did not land: the whole test is meaningless
        # when the fixture wrote to a different database than the server reads.
        check = db.query(User).filter(User.username == marker).first()
        assert check is not None, "seed write did not persist to the server database"
    finally:
        db.close()
    yield {"admin": marker, "clerk": clerk}
    db = sync_engine.SessionLocal()
    try:
        db.query(User).filter(User.username.in_(
            [marker, clerk, "PROBE USER", "PROBE2 USER"])).delete(
            synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture(scope="module")
def two_office_pcs(_seed_real_database):
    """PC A is served by a real uvicorn thread on loopback, backed by the
    production database engine, with NO dependency override. PC B is a second
    office computer with its own temporary SQLite database FILE and its own
    sessionmaker (never installed as an override until the final step)."""
    tmpdir = tempfile.TemporaryDirectory()
    db_path = os.path.join(tmpdir.name, "pc_b_office.db")
    eng_b = create_engine(f"sqlite:///{db_path}",
                          connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=eng_b)
    sessions_b = sessionmaker(autocommit=False, autoflush=False, bind=eng_b)

    # Serve PC A over real HTTP on the loopback interface. Production's own
    # database engine backs it; no dependency override for PC A.
    import uvicorn
    server_config = uvicorn.Config(app, host="127.0.0.1", port=API_PORT,
                                   log_level="error")
    server = uvicorn.Server(server_config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(50):
        try:
            requests.get(f"http://127.0.0.1:{API_PORT}/health", timeout=1)
            break
        except Exception:
            time.sleep(0.2)

    with TestClient(app) as client_a:
        yield client_a, sessions_b
    server.should_exit = True
    thread.join(timeout=10)
    eng_b.dispose()
    tmpdir.cleanup()


def test_account_created_on_one_pc_logs_in_on_the_other(two_office_pcs,
                                                        _seed_real_database):
    client_a, sessions_b = two_office_pcs
    admin_name = _seed_real_database["admin"]

    # 1. The account works on PC A: it was born here. This call MUST go to the
    #    production database — no override may be active during setup.
    login = client_a.post("/token", json={"username": admin_name,
                                          "password": "password123"})
    assert login.status_code == 200, login.text
    admin_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # 2. The admin creates the clerk account on PC A through the real API.
    created = client_a.post(
        "/users", headers=admin_headers,
        json={"first_name": "OPIN", "last_name": "CLERK",
              "username": "OPIN CLERK", "password": "opinpass123",
              "role": "Clerk"},
    )
    assert created.status_code == 200, created.text

    # 3. PC B has never seen the account. Check B's own database directly —
    #    no override involved, just the second office computer's file.
    db_b = sessions_b()
    try:
        assert db_b.query(User).filter(
            User.username == "OPIN CLERK").first() is None, \
            "PC B must not know the account before sync"
    finally:
        db_b.close()

    # 4. Discovery: PC B learns PC A's address the way a broadcast would.
    #    (The real broadcast sender/listener run live in production; inside
    #    the test sandbox the datagram hop is simulated by writing PEERS.)
    sync_engine.PEERS.add(f"127.0.0.1:{API_PORT}")
    sync_engine.API_PORT = API_PORT

    # 5. One real sync cycle: PC B pulls from PC A over HTTP with a genuine
    #    HMAC signature and imports the users into its own database file.
    #    Still no override: PC A serves its production database here.
    cycle = threading.Thread(target=_run_one_cycle, args=(sessions_b,),
                             daemon=True)
    cycle.start()
    cycle.join(timeout=60)
    assert not cycle.is_alive(), "sync cycle hung"

    # 6. The account landed on PC B carrying its real bcrypt hash (password
    #    roaming), not the SYNCED_NO_PASSWORD stub.
    db_b = sessions_b()
    try:
        row = db_b.query(User).filter(User.username == "OPIN CLERK").first()
        assert row is not None, "clerk did not arrive on PC B"
        assert row.password_hash.startswith("$2"), \
            "password hash did not roam across the sync"
        assert row.role == "Clerk"
    finally:
        db_b.close()

    # 7. NOW, and only now, point the app at PC B and prove a person standing
    #    at that computer can log in. The override lives for this assertion
    #    alone and is removed before anything else touches the app.
    def override_b():
        db = sessions_b()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_b
    try:
        after = client_a.post("/token", json={"username": "OPIN CLERK",
                                              "password": "opinpass123"})
        assert after.status_code == 200, after.text
        body = after.json()
        assert body["full_name"] == "OPIN CLERK"
        assert body["role"] == "Clerk"
    finally:
        app.dependency_overrides.pop(get_db, None)


def _run_one_cycle(sessions_b):
    """Exactly one iteration of sync_engine.sync_with_peers()'s loop body,
    bound to PC B's sessionmaker: pull from every peer over HTTP with a real
    HMAC signature, then merge the incoming users into PC B's database file."""
    db = sessions_b()
    try:
        latest = db.query(sync_engine.FranchiseRecord).order_by(
            sync_engine.FranchiseRecord.updated_at.desc()).first()
        last_sync = latest.updated_at.replace(tzinfo=None).isoformat() if (latest and latest.updated_at) else "2000-01-01T00:00:00"
        for peer in list(sync_engine.PEERS):
            host, port = peer.rsplit(":", 1)
            ts = str(int(time.time()))
            nonce = sync_engine.secrets.token_hex(8)
            body = f"PULL:{host}:{ts}:{nonce}".encode("utf-8")
            signature = sync_engine._hmac_hex(body)
            response = requests.get(
                f"http://{host}:{port}/api/sync/pull?since={last_sync}",
                headers={
                    "X-Cluster-Timestamp": ts,
                    "X-Cluster-Nonce": nonce,
                    "X-Cluster-Signature": signature,
                },
                timeout=10,
            )
            response.raise_for_status()
            incoming = response.json()
            # Same merge code the production sync loop runs.
            sync_engine._merge_incoming_users(db, incoming.get("users", []))
            db.commit()
    finally:
        db.close()
