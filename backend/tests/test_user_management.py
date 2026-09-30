import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

import main
from main import app, get_db
from database import Base, User

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
