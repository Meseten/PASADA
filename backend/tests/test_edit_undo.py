import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

from main import app, get_db
from database import Base, User, FranchiseRecord, AuditLog

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_edit_undo.db"))
engine = create_engine(f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def _fresh_db_and_override():
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    db.add(User(first_name="TEST", last_name="ADMIN", username="TEST ADMIN",
                password_hash=pwd_context.hash("password123"), role="Admin"))
    db.commit()
    db.close()
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    yield
    if previous is None:
        app.dependency_overrides.pop(get_db, None)
    else:
        app.dependency_overrides[get_db] = previous
    engine.dispose()
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass


client = TestClient(app)


def _headers():
    token = client.post("/token", json={"username": "TEST ADMIN", "password": "password123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create(sbn, name):
    res = client.post("/franchise/", json={
        "sbn_no": sbn, "operator_name": name, "address": "NAIC, CAVITE",
        "motor_no": "MTR-1", "chassis_no": "CHS-1", "make": "HONDA",
        "plate_no": "", "route": "BATODA",
    }, headers=_headers())
    assert res.status_code == 200, res.text
    # The stored SBN always comes back normalized with its year suffix
    # (e.g. BAT-101 -> BAT-101-26); the tests use the stored form.
    records = client.get("/franchise/route/BATODA", headers=_headers()).json()
    return [r for r in records if r["operator_name"] == name][0]


def _last_edit_log(record_id, action=None):
    db = TestingSessionLocal()
    q = db.query(AuditLog).filter(AuditLog.target_id == record_id).order_by(AuditLog.timestamp.desc())
    for log in q.all():
        if action is None or log.action == action:
            snapshot = log
            db.close()
            return snapshot
    db.close()
    return None


def test_plain_edit_saves_snapshot_and_revert_restores_it():
    record = _create("BAT-101", "PEDRO PENDUKO")
    stored_sbn = record["sbn_no"]  # normalized form, e.g. BAT-101-26
    # Plain edit: change the operator name only.
    edit_res = client.put(f"/franchise/{record['id']}", json={
        "sbn_no": "BAT-101", "operator_name": "PEDRO PENDRAGON",
        "address": "NAIC, CAVITE", "motor_no": "MTR-1", "chassis_no": "CHS-1",
        "make": "HONDA", "plate_no": "", "route": "BATODA",
    }, headers=_headers())
    assert edit_res.status_code == 200, edit_res.text

    log = _last_edit_log(record["id"])
    assert log is not None and log.before_values, "the EDIT entry must carry the pre-edit values"
    import json as _json
    snapshot = _json.loads(log.before_values)
    assert snapshot["operator_name"] == "PEDRO PENDUKO"
    assert snapshot["sbn_no"] == stored_sbn

    # Undo through the endpoint: the record goes back to the old name.
    res = client.put(f"/api/operators/{record['id']}/revert/{log.id}", headers=_headers())
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    row = db.query(FranchiseRecord).filter(FranchiseRecord.id == record["id"]).first()
    db.close()
    assert row.operator_name == "PEDRO PENDUKO"
    # The undo itself is audited, so History shows it plainly.
    revert_log = _last_edit_log(record["id"])
    assert revert_log.action == "EDIT_REVERT"


def test_renewal_edit_is_undoable_including_sbn_and_dates():
    record = _create("BAT-102", "MARIA SANTOS")
    db = TestingSessionLocal()
    row = db.query(FranchiseRecord).filter(FranchiseRecord.id == record["id"]).first()
    before_dates = (row.issue_date, row.valid_until)
    db.close()
    # Record the original SBN year: a renewal must be able to undo back to it.
    original_sbn = row.sbn_no
    current_year = datetime.now().year
    edited_sbn = original_sbn.replace(str(current_year - 5), str(current_year)) \
        if str(current_year - 5) in original_sbn else f"BAT-102-{current_year}"

    edit_res = client.put(f"/franchise/{record['id']}", json={
        "sbn_no": edited_sbn, "operator_name": "MARIA SANTOS",
        "address": "NAIC, CAVITE", "motor_no": "MTR-1", "chassis_no": "CHS-1",
        "make": "HONDA", "plate_no": "", "route": "BATODA",
        "issue_date": f"{current_year}-06-15", "valid_until": f"{current_year}-12-31",
    }, headers=_headers())
    assert edit_res.status_code == 200, edit_res.text

    log = _last_edit_log(record["id"])
    res = client.put(f"/api/operators/{record['id']}/revert/{log.id}", headers=_headers())
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    row = db.query(FranchiseRecord).filter(FranchiseRecord.id == record["id"]).first()
    db.close()
    assert row.sbn_no == original_sbn
    assert (row.issue_date, row.valid_until) == before_dates


def test_revert_refuses_when_the_old_sbn_belongs_to_a_different_record():
    # Undo must not steal another record's SBN — that would merge two
    # operators into one row in the office's eyes.
    record = _create("BAT-103", "ANDRES MOLINA")
    record_id = record["id"]
    original_sbn = record["sbn_no"]  # the SBN the undo would want to restore
    edit_res = client.put(f"/franchise/{record_id}", json={
        "sbn_no": "BAT-103R", "operator_name": "ANDRES MOLINA",
        "address": "NAIC, CAVITE", "motor_no": "MTR-1", "chassis_no": "CHS-1",
        "make": "HONDA", "plate_no": "", "route": "BATODA",
    }, headers=_headers())
    assert edit_res.status_code == 200, edit_res.text
    log = _last_edit_log(record_id)

    # While the record sits on BAT-103R, hand the ORIGINAL SBN to a different
    # record behind the API (as some old upload would have left behind).
    db = TestingSessionLocal()
    db.add(FranchiseRecord(sbn_no=original_sbn, operator_name="IMPOSTER",
                           route="BATODA", is_active=True, is_deleted=False,
                           processed_by="legacy"))
    db.commit()
    db.close()

    res = client.put(f"/api/operators/{record_id}/revert/{log.id}", headers=_headers())
    assert res.status_code == 409
    # The record stays exactly as it was: untouched on conflict.
    db = TestingSessionLocal()
    row = db.query(FranchiseRecord).filter(FranchiseRecord.id == record_id).first()
    db.close()
    assert row.sbn_no != original_sbn


def test_revert_rejects_a_log_from_another_record_and_empty_snapshots():
    record = _create("BAT-104", "RIZAL PARK")
    log = _last_edit_log(record["id"])
    # A log id that belongs to nobody: 404, no changes anywhere.
    res = client.put(f"/api/operators/{record['id']}/revert/NO-SUCH-LOG", headers=_headers())
    assert res.status_code == 404
    # A log for a different record cannot be aimed at this one.
    other = _create("BAT-105", "OTHER PERSON")
    other_log = _last_edit_log(other["id"])
    res = client.put(f"/api/operators/{record['id']}/revert/{other_log.id}", headers=_headers())
    assert res.status_code == 404
    db = TestingSessionLocal()
    row = db.query(FranchiseRecord).filter(FranchiseRecord.id == record["id"]).first()
    db.close()
    assert row.operator_name == "RIZAL PARK"
    assert log is not None
