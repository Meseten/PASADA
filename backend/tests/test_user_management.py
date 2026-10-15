import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

import main
from main import app, get_db
from database import AuditLog, Base, User

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_user_mgmt.db"))
engine = create_engine(
    f"sqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


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

    # Save-and-restore: another module may own the override at import time.
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


def _token(client, username="ADMIN BOSS", password="password123"):
    res = client.post("/token", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture(autouse=True)
def _clean_login_state():
    # LOGIN STATE ISOLATION: failed-login counters (in-memory _login_attempts
    # and the persisted login_lockouts rows) leak across tests within this
    # module — a deliberate lockout in one test made later tests' first sign-in
    # answer '4 attempts left'. Clear both before every test.
    from main import _login_attempts
    _login_attempts.clear()
    db = TestingSessionLocal()
    try:
        db.execute(text("DELETE FROM login_lockouts"))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
    yield
    _login_attempts.clear()


def test_signup_open_flags_closed_office(client):
    # The login page uses this to hide the Register link once an account exists.
    res = client.get("/signup/open")
    assert res.status_code == 200
    assert res.json() == {"open": False}


def test_admin_can_create_user_and_it_logs_in(client):
    headers = _token(client)
    res = client.post("/users", headers=headers, json={
        "first_name": "NICO", "last_name": "DUAG",
        "username": "NICO DUAG", "password": "nicopass123", "role": "Clerk",
    })
    assert res.status_code == 200, res.text
    # New clerk signs in with the password the admin chose.
    login = client.post("/token", json={"username": "NICO DUAG", "password": "nicopass123"})
    assert login.status_code == 200


def test_clerk_cannot_create_users(client):
    client.post("/users", headers=_token(client), json={
        "first_name": "TEMP", "last_name": "CLERK",
        "username": "TEMP CLERK", "password": "clerkpass123", "role": "Clerk",
    })
    clerk_headers = _token(client, "TEMP CLERK", "clerkpass123")
    res = client.post("/users", headers=clerk_headers, json={
        "first_name": "SNEAKY", "last_name": "USER",
        "username": "SNEAKY USER", "password": "sneakypass1", "role": "Admin",
    })
    assert res.status_code == 403


def test_admin_reset_clears_lockout_and_enables_login(client):
    headers = _token(client)
    client.post("/users", headers=headers, json={
        "first_name": "LOCK", "last_name": "ME",
        "username": "LOCK ME", "password": "originalpass1", "role": "Clerk",
    })
    # Burn the lockout: five wrong passwords.
    for _ in range(main.LOGIN_MAX_ATTEMPTS):
        client.post("/token", json={"username": "LOCK ME", "password": "wrong"})
    blocked = client.post("/token", json={"username": "LOCK ME", "password": "originalpass1"})
    assert blocked.status_code == 429
    # Admin reset gives a new password AND clears the stale lock.
    res = client.put("/users/reset-password", headers=headers,
                     json={"username": "LOCK ME", "new_password": "freshpass123"})
    assert res.status_code == 200, res.text
    login = client.post("/token", json={"username": "LOCK ME", "password": "freshpass123"})
    assert login.status_code == 200


def test_users_list_reports_missing_passwords(client):
    # Accounts synced before password roaming carry SYNCED_NO_PASSWORD; the
    # admin list must flag them so the office knows whose password to reset.
    db = TestingSessionLocal()
    db.add(User(first_name="STUB", last_name="USER", username="STUB USER",
                password_hash="SYNCED_NO_PASSWORD", role="Clerk"))
    db.commit()
    db.close()
    res = client.get("/users", headers=_token(client))
    assert res.status_code == 200
    stub = [u for u in res.json() if u["username"] == "STUB USER"][0]
    assert stub["has_password"] is False
    real = [u for u in res.json() if u["username"] == "ADMIN BOSS"][0]
    assert real["has_password"] is True


def test_password_hash_survives_sync_roundtrip(client):
    # PASSWORD ROAMING: sync_pull must ship the real bcrypt hash (the office
    # cluster is HMAC-trusted), so an account created on one computer can log
    # in on every other computer. Security-answer hashes stay local.
    from unittest.mock import patch, MagicMock

    db = TestingSessionLocal()
    db.query(User).filter(User.username == "ROAMING CLERK").delete()
    db.add(User(first_name="ROAMING", last_name="CLERK", username="ROAMING CLERK",
                password_hash=pwd_context.hash("roampass123"), role="Clerk"))
    db.commit()
    u = db.query(User).filter(User.username == "ROAMING CLERK").first()
    real_hash = u.password_hash
    db.close()
    assert real_hash and real_hash != "SYNCED_NO_PASSWORD"

    request = MagicMock()
    request.headers = {
        "x-cluster-timestamp": "0",
        "x-cluster-nonce": "test-nonce-roaming",
        "x-cluster-signature": "",
    }
    with patch("main._verify_pull_signature", return_value=True):
        body = main.sync_pull(since="2000-01-01T00:00:00", request=request,
                              db=TestingSessionLocal())
    matched = [u for u in body["users"] if u["username"] == "ROAMING CLERK"]
    assert matched, "synced payload must include the account"
    assert matched[0]["password_hash"] == real_hash, "bcrypt hash must roam with the account"
    assert "security_a1_hash" not in matched[0], "answer hashes must stay local"


# --- DEACTIVATE / REACTIVATE (admin user management) ---
# Deactivation is the missing middle ground between "account works" and
# "account never existed": the person's records and audit history stay, but
# sign-in is refused everywhere and even an already-signed-in session is
# dropped on its next request.

def test_admin_can_deactivate_and_reactivate_clerk(client):
    headers = _token(client)
    res = client.post("/users", headers=headers, json={
        "first_name": "DEACT", "last_name": "ME",
        "username": "DEACT ME", "password": "deactpass123",
        "password_confirm": "deactpass123", "role": "Clerk",
    })
    assert res.status_code == 200, res.text
    login = client.post("/token", json={"username": "DEACT ME", "password": "deactpass123"})
    assert login.status_code == 200, login.text
    live_token = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # Deactivate: the list flags the account. ADMIN BOSS is the only admin
    # at this point in the module, so the single-admin override applies and
    # the action demands a written reason for the audit log.
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "DEACT ME", "is_active": False})
    assert res.status_code == 400, res.text
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "DEACT ME", "is_active": False, "override_reason": "owner requested, only admin on duty"})
    assert res.status_code == 200, res.text
    users = client.get("/users", headers=headers).json()
    deact = [u for u in users if u["username"] == "DEACT ME"][0]
    assert deact["is_deactivated"] is True
    # Sign-in is refused even with the right password.
    res = client.post("/token", json={"username": "DEACT ME", "password": "deactpass123"})
    assert res.status_code == 401 and "deactivated" in res.json()["detail"].lower()
    # The already-signed-in session dies on the next request.
    res = client.get("/users", headers=live_token)
    assert res.status_code == 401
    # The flag roams through sync so other computers refuse the account too.
    from unittest.mock import patch, MagicMock
    request = MagicMock()
    request.headers = {
        "x-cluster-timestamp": "0",
        "x-cluster-nonce": "test-nonce-deact",
        "x-cluster-signature": "",
    }
    with patch("main._verify_pull_signature", return_value=True):
        body = main.sync_pull(since="2000-01-01T00:00:00", request=request,
                              db=TestingSessionLocal())
    roam = [u for u in body["users"] if u["username"] == "DEACT ME"][0]
    assert roam["is_deactivated"] is True

    # Reactivation restores sign-in, and both actions hit the audit log.
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "DEACT ME", "is_active": True, "override_reason": "owner back on duty"})
    assert res.status_code == 200, res.text
    assert client.post("/token", json={"username": "DEACT ME", "password": "deactpass123"}).status_code == 200
    db = TestingSessionLocal()
    actions = [a.action for a in db.query(AuditLog).filter(
        AuditLog.details.like("%DEACT ME%")).all()]
    db.close()
    assert "DEACTIVATE_USER" in actions and "REACTIVATE_USER" in actions


def test_deactivate_guards(client):
    headers = _token(client)
    # Nobody can deactivate the account they are signed in with. This rule is
    # also what guarantees an office can never lose its last active Admin.
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "ADMIN BOSS", "is_active": False})
    assert res.status_code == 400
    # A clerk cannot deactivate anyone.
    clerk = _token(client, "TEMP CLERK", "clerkpass123")
    res = client.put("/users/set-active", headers=clerk,
                     json={"username": "DEACT ME", "is_active": False})
    assert res.status_code == 403
    # Unknown account answers 404.
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "GHOST USER", "is_active": False})
    assert res.status_code == 404


def test_deactivated_admin_loses_access_immediately(client):
    headers = _token(client)
    res = client.post("/users", headers=headers, json={
        "first_name": "SECOND", "last_name": "ADMIN",
        "username": "SECOND ADMIN", "password": "secondpass1",
        "password_confirm": "secondpass1", "role": "Admin",
    })
    assert res.status_code == 200, res.text
    second = _token(client, "SECOND ADMIN", "secondpass1")
    # The second admin can act while active.
    assert client.get("/users", headers=second).status_code == 200
    # SINGLE-KEY RULE (2026-10-14): the deactivation now runs directly with
    # a mandatory written reason; no second-Admin approval ticket.
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "SECOND ADMIN", "is_active": False, "override_reason": "second account is leaving"})
    assert res.status_code == 200, res.text
    # The second admin's signed-in session is dead and sign-in is refused.
    assert client.get("/users", headers=second).status_code == 401
    res = client.post("/token", json={"username": "SECOND ADMIN", "password": "secondpass1"})
    assert res.status_code == 401
    # Reactivation follows the same single-key rule: direct, reason required.
    res = client.put("/users/set-active", headers=headers,
                     json={"username": "SECOND ADMIN", "is_active": True, "override_reason": "second admin returns to work"})
    assert res.status_code == 200, res.text
    assert client.post("/token", json={"username": "SECOND ADMIN", "password": "secondpass1"}).status_code == 200


def test_sync_merge_follows_deactivation_and_role(client):
    # The merge runs on every sync cycle; role and deactivation changes made
    # on the owning machine must reach every copy of the account.
    import sync_engine
    db = TestingSessionLocal()
    db.query(User).filter(User.username == "MERGE TARGET").delete()
    db.add(User(first_name="MERGE", last_name="TARGET", username="MERGE TARGET",
                password_hash=pwd_context.hash("mergepass123"), role="Clerk"))
    db.commit()
    db.close()
    incoming = [
        {"username": "MERGE TARGET", "first_name": "MERGE", "last_name": "TARGET",
         "role": "Admin", "password_hash": pwd_context.hash("newmergepass1"),
         "is_deactivated": True},
        {"username": "MERGE NEW", "first_name": "MERGE", "last_name": "NEW",
         "role": "Clerk", "password_hash": "SYNCED_NO_PASSWORD", "is_deactivated": True},
    ]
    db = TestingSessionLocal()
    sync_engine._merge_incoming_users(db, incoming)
    db.commit()
    target = db.query(User).filter(User.username == "MERGE TARGET").first()
    fresh = db.query(User).filter(User.username == "MERGE NEW").first()
    db.close()
    assert target.role == "Admin" and bool(target.is_deactivated)
    assert fresh is not None and bool(fresh.is_deactivated)
    # A merged-in deactivated account cannot sign in even with the right password.
    res = client.post("/token", json={"username": "MERGE TARGET", "password": "newmergepass1"})
    assert res.status_code == 401
    res = client.post("/token", json={"username": "MERGE NEW", "password": "whatever123"})
    assert res.status_code == 401

# --- FIRST-RUN ADMIN SETUP: password confirmation + bootstrap ---
# On a truly fresh install there are zero accounts: signup is open, the account
# it creates is a Clerk, and that account later promotes itself through admin
# bootstrap by re-entering its password. A typo in that first password would
# lock the whole installation out (no recovery exists before an admin does),
# so the endpoint enforces the double-entry the signup screen performs.
FRESH_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_first_run.db"))
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


@pytest.fixture(scope="module")
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


def test_first_run_signup_rejects_password_mismatch(fresh_client):
    res = fresh_client.post("/signup", json={
        "first_name": "FRESH", "last_name": "START",
        "username": "FRESH START", "password": "first_run_pass_1",
        "password_confirm": "first_run_pass_2", "role": "Clerk",
    })
    assert res.status_code == 422, res.text
    assert "match" in res.json()["detail"].lower()
    db = FreshSessionLocal()
    ghost = db.query(User).filter(User.username == "FRESH START").first()
    db.close()
    assert ghost is None, "mismatched signup must not create the account"


def test_first_run_signup_then_bootstrap_to_admin(fresh_client):
    # 1. First-run signup with matching confirmation creates the Clerk.
    res = fresh_client.post("/signup", json={
        "first_name": "FRESH", "last_name": "START",
        "username": "FRESH START", "password": "first_run_pass_1",
        "password_confirm": "first_run_pass_1", "role": "Clerk",
    })
    assert res.status_code == 200, res.text
    # 2. The new account signs in.
    res = fresh_client.post("/token", json={"username": "FRESH START", "password": "first_run_pass_1"})
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    # 3. The office has no admin yet.
    res = fresh_client.get("/admin/needed", headers=headers)
    assert res.status_code == 200 and res.json()["needed"] is True
    # 4. Wrong confirmation password cannot bootstrap.
    res = fresh_client.post("/admin/bootstrap", headers=headers, json={"password": "wrong_password"})
    assert res.status_code in (400, 401, 403), res.text
    # 5. The correct password promotes the account to Admin.
    res = fresh_client.post("/admin/bootstrap", headers=headers, json={"password": "first_run_pass_1"})
    assert res.status_code == 200, res.text
    db = FreshSessionLocal()
    user = db.query(User).filter(User.username == "FRESH START").first()
    role = user.role
    db.close()
    assert role == "Admin"


# --- DEPLOYED OFFICE WITH NO ADMIN: recovery restores admin access ---
# An office whose accounts arrived through LAN sync can end up with several
# working accounts and ZERO Admin accounts (the one admin resigned or the
# account was replaced). Signup is closed, bootstrap needs a signed-in user,
# and synced accounts cannot set security questions until they sign in, so
# the recovery reset is the last resort: while no Admin exists anywhere, a
# correct three-answer reset also promotes that account to Admin. The valve
# closes permanently once any Admin exists.
SYNCED_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_synced_office.db"))
synced_engine = create_engine(
    f"sqlite:///{SYNCED_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
SyncedSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=synced_engine)


def synced_override_get_db():
    db = SyncedSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def synced_client():
    if os.path.exists(SYNCED_DB_PATH):
        try:
            os.remove(SYNCED_DB_PATH)
        except OSError:
            pass
    Base.metadata.create_all(bind=synced_engine)
    db = SyncedSessionLocal()
    # Exactly what a deployed office looks like after a sync: real accounts,
    # real passwords, no Admin row.
    db.add(User(first_name="JUAN", last_name="DELA CRUZ", username="JUAN DELA CRUZ",
                password_hash=pwd_context.hash("juanpass123"), role="Clerk"))
    db.add(User(first_name="MARIA", last_name="SANTOS", username="MARIA SANTOS",
                password_hash="SYNCED_NO_PASSWORD", role="Clerk"))
    db.commit()
    db.close()

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = synced_override_get_db
    with TestClient(app) as c:
        yield c
    if previous_override is not None:
        app.dependency_overrides[get_db] = previous_override
    else:
        app.dependency_overrides.pop(get_db, None)
    synced_engine.dispose()
    if os.path.exists(SYNCED_DB_PATH):
        try:
            os.remove(SYNCED_DB_PATH)
        except OSError:
            pass


def test_synced_office_reports_admin_needed(synced_client):
    # The signed-in clerk is told the office lacks an Admin, which is what
    # drives the sidebar setup link and the /admin bootstrap panel.
    res = synced_client.post("/token", json={"username": "JUAN DELA CRUZ", "password": "juanpass123"})
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    res = synced_client.get("/admin/needed", headers=headers)
    assert res.status_code == 200 and res.json()["needed"] is True


def test_recovery_reset_without_admin_promotes_account(synced_client):
    db = SyncedSessionLocal()
    juan = db.query(User).filter(User.username == "JUAN DELA CRUZ").first()
    # Questions were set on this machine back when the office still had its
    # admin; only the answer hashes live here (never synced).
    juan.security_q1 = "What is your mother's surname?"
    juan.security_q2 = "What street did you grow up on?"
    juan.security_q3 = "What was your first pet's name?"
    juan.security_a1_hash = pwd_context.hash("reyes")
    juan.security_a2_hash = pwd_context.hash("rizal street")
    juan.security_a3_hash = pwd_context.hash("bantay")
    db.commit()
    db.close()

    # Step 1: the questions come back for the right username.
    res = synced_client.get("/recovery/questions", params={"username": "JUAN DELA CRUZ"})
    assert res.status_code == 200, res.text
    assert res.json()["q1"] == "What is your mother's surname?"

    # Wrong answers fail without touching the password or the role.
    res = synced_client.post("/recovery/reset", json={
        "username": "JUAN DELA CRUZ", "a1": "wrong", "a2": "wrong", "a3": "wrong",
        "new_password": "newpass12345",
    })
    assert res.status_code == 400, res.text
    db = SyncedSessionLocal()
    juan = db.query(User).filter(User.username == "JUAN DELA CRUZ").first()
    assert juan.role == "Clerk"
    db.close()

    # The office has no Admin to clear a login lockout, so the recovery
    # reset must clear it too: burn the lockout, then reset via answers.
    for _ in range(main.LOGIN_MAX_ATTEMPTS):
        synced_client.post("/token", json={"username": "JUAN DELA CRUZ", "password": "totally-wrong"})
    locked = synced_client.post("/token", json={"username": "JUAN DELA CRUZ", "password": "newpass12345"})
    assert locked.status_code == 429, locked.text

    # Correct answers: password reset AND the account becomes the office Admin.
    res = synced_client.post("/recovery/reset", json={
        "username": "JUAN DELA CRUZ",
        "a1": "REYES",                       # case-insensitive on purpose
        "a2": "  rizal   street ",           # whitespace-tolerant on purpose
        "a3": "bantay",
        "new_password": "newpass12345",
    })
    assert res.status_code == 200, res.text
    assert "admin" in res.json()["message"].lower()
    # The new password signs in immediately: the lockout did not survive.
    res = synced_client.post("/token", json={"username": "JUAN DELA CRUZ", "password": "newpass12345"})
    assert res.status_code == 200, res.text
    db = SyncedSessionLocal()
    juan = db.query(User).filter(User.username == "JUAN DELA CRUZ").first()
    assert juan.role == "Admin"
    restored = db.query(AuditLog).filter(AuditLog.action == "ADMIN_RESTORED").count()
    db.close()
    assert restored == 1, "the last-resort promotion must land in the audit log"

    # Bootstrap is permanently closed now that an Admin exists.
    headers = {"Authorization": f"Bearer {synced_client.post('/token', json={'username': 'JUAN DELA CRUZ', 'password': 'newpass12345'}).json()['access_token']}"}
    res = synced_client.post("/admin/bootstrap", headers=headers, json={"password": "newpass12345"})
    assert res.status_code == 403, res.text


def test_recovery_reset_with_admin_does_not_promote(synced_client):
    # Another account sets up recovery (possible only because JUAN can now
    # create one, or by signing in and using Settings) and answers correctly:
    # the password resets but the role must stay Clerk.
    res = synced_client.post("/token", json={"username": "JUAN DELA CRUZ", "password": "newpass12345"})
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    res = synced_client.post("/users", headers=headers, json={
        "first_name": "ANA", "last_name": "LIM", "username": "ANA LIM",
        "password": "anapass123", "password_confirm": "anapass123", "role": "Clerk",
    })
    assert res.status_code == 200, res.text
    db = SyncedSessionLocal()
    ana = db.query(User).filter(User.username == "ANA LIM").first()
    ana.security_q1 = "Question one?"
    ana.security_q2 = "Question two?"
    ana.security_q3 = "Question three?"
    ana.security_a1_hash = pwd_context.hash("answer one")
    ana.security_a2_hash = pwd_context.hash("answer two")
    ana.security_a3_hash = pwd_context.hash("answer three")
    db.commit()
    db.close()

    res = synced_client.post("/recovery/reset", json={
        "username": "ANA LIM",
        "a1": "answer one", "a2": "answer two", "a3": "answer three",
        "new_password": "resetpass123",
    })
    assert res.status_code == 200, res.text
    assert "admin" not in res.json()["message"].lower()
    db = SyncedSessionLocal()
    ana = db.query(User).filter(User.username == "ANA LIM").first()
    assert ana.role == "Clerk"
    db.close()


# --- DEACTIVATE / REACTIVATE (admin user management) ---
# Deactivation is the missing middle ground between "account works" and
# "account never existed": the person's records and audit history stay, but
# sign-in is refused everywhere and even an already-signed-in session is


# --- VIEWER ROLE (read-only accounts for the second office PC) ---
# A Viewer can look at everything but must not be able to change a single
# record. The API is the boundary; the hidden buttons in the UI are courtesy.
# ORDER-INDEPENDENT on purpose: these four tests run against their OWN
# function-scoped database (viewer_client) because the earlier module tests
# mutate shared state (lockouts, deactivations, recovery fixtures), and a
# module-scoped DB made fresh-user logins flaky depending on test order.
VIEWER_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_viewer_block.db"))
viewer_engine = create_engine(
    f"sqlite:///{VIEWER_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
ViewerSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=viewer_engine)


def viewer_override_get_db():
    db = ViewerSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def viewer_client():
    if os.path.exists(VIEWER_DB_PATH):
        try:
            os.remove(VIEWER_DB_PATH)
        except OSError:
            pass
    Base.metadata.create_all(bind=viewer_engine)
    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = viewer_override_get_db
    with TestClient(app) as c:
        yield c
    if previous_override is not None:
        app.dependency_overrides[get_db] = previous_override
    else:
        app.dependency_overrides.pop(get_db, None)
    viewer_engine.dispose()
    if os.path.exists(VIEWER_DB_PATH):
        try:
            os.remove(VIEWER_DB_PATH)
        except OSError:
            pass


def _make_viewer_fixtures(viewer_client):
    import uuid
    suffix = uuid.uuid4().hex[:6].upper()
    admin_user, viewer_user = f"VADM {suffix}", f"VIEW {suffix}"
    db = ViewerSessionLocal()
    db.add(User(first_name="VADM", last_name=suffix,
                username=admin_user,
                password_hash=pwd_context.hash("vadminpass1"), role="Admin"))
    db.add(User(first_name="VIEW", last_name=suffix,
                username=viewer_user,
                password_hash=pwd_context.hash("viewpass123"), role="Viewer"))
    db.commit()
    db.close()
    return _token(viewer_client, admin_user, "vadminpass1"), _token(viewer_client, viewer_user, "viewpass123")

def test_viewer_role_whitelist_rejects_unknown_role(viewer_client):
    admin_headers, _ = _make_viewer_fixtures(viewer_client)
    res = viewer_client.post("/users", headers=admin_headers, json={
        "first_name": "HACK", "last_name": "ERMAN",
        "username": "HACK ERMAN", "password": "hackpass123", "role": "SuperAdmin",
    })
    assert res.status_code == 400

def test_viewer_cannot_create_edit_or_delete_records(viewer_client):
    _, viewer_headers = _make_viewer_fixtures(viewer_client)
    # Create
    res = viewer_client.post("/franchise/", headers=viewer_headers, json={
        "route": "TESTODA", "operator_name": "SHOULD NOT EXIST",
        "address": "Test Address", "sbn_no": "", "motor_no": "M-1", "chassis_no": "C-1",
    })
    assert res.status_code == 403, f"create: {res.status_code} {res.text}"
    # Edit (record may not exist; 403 must fire before any record lookup result)
    res = viewer_client.put("/franchise/some-id-not-real", headers=viewer_headers, json={
        "route": "TESTODA", "operator_name": "X", "address": "Y",
        "sbn_no": "T-1", "motor_no": "M-1", "chassis_no": "C-1",
    })
    assert res.status_code == 403, f"edit: {res.status_code} {res.text}"
    # Delete
    res = viewer_client.delete("/api/operators/whatever", headers=viewer_headers)
    assert res.status_code == 403, f"delete: {res.status_code} {res.text}"
    # Bulk delete
    res = viewer_client.post("/api/operators/bulk-delete", headers=viewer_headers, json={"sbn_list": ["T-1"]})
    assert res.status_code == 403, f"bulk delete: {res.status_code} {res.text}"

def test_viewer_can_still_read_and_print(viewer_client):
    _, viewer_headers = _make_viewer_fixtures(viewer_client)
    # Read paths stay open: the route listing the records pages use, plus
    # dashboard stats. (GET /franchise/ is not a route in this app; the
    # per-route list is the real read path.)
    res = viewer_client.get("/franchise/route/TESTODA", headers=viewer_headers)
    assert res.status_code == 200, res.text
    res = viewer_client.get("/stats/global", headers=viewer_headers)
    assert res.status_code == 200, res.text

def test_clerk_can_still_create_records(viewer_client):
    import uuid
    suffix = uuid.uuid4().hex[:6].upper()
    clerk_user = f"CLERK {suffix}"
    db = ViewerSessionLocal()
    db.add(User(first_name="CLERK", last_name=suffix,
                username=clerk_user,
                password_hash=pwd_context.hash("clerkpass123"), role="Clerk"))
    db.commit()
    db.close()
    clerk_headers = _token(viewer_client, clerk_user, "clerkpass123")
    res = viewer_client.post("/franchise/", headers=clerk_headers, json={
        "route": "TESTODA", "operator_name": "CLERK MADE ME",
        "address": "Test Address", "sbn_no": "", "motor_no": "M-2", "chassis_no": "C-2",
    })
    assert res.status_code == 200, res.text
