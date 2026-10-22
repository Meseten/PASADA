# LIVE FLOW for the restore affordances (record History dialog, Activity Logs
# delete rows, Admin "Restore now"):
#
#   delete a record -> GET /tickets/for-record/{id} says is_deleted=true
#   Clerk files the ticket (accepting a base SBN entry)
#       -> for-record says restore_requested=true (no second ticket: 409)
#       -> per-record History gets a RESTORE_REQUEST entry
#   Admin approves
#       -> record is back (is_deleted=false), LAN-sync rides the updated_at
#          bump, and the record's History gets a RESTORE_APPROVED entry
#   Admin runs a restore DIRECTLY (/api/restore-records/ticket + reason)
#       -> RESTORE_DIRECT per-record entries; 400 without a reason
#   Approving a ticket whose records were already restored directly
#       -> result_note says so instead of "Restored 0 record(s)"

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

from main import app, get_db, clear_api_caches
from database import Base, User, FranchiseRecord, ApprovalTicket, AuditLog

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_restore_flow.db"))
engine = create_engine(
    f"sqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    db.add(User(first_name="ADMIN", last_name="ONE", username="ADMIN ONE",
                password_hash=pwd_context.hash("adminone1"), role="Admin"))
    db.add(User(first_name="CLERK", last_name="WORKER", username="CLERK WORKER",
                password_hash=pwd_context.hash("clerkone1"), role="Clerk"))
    db.add(User(first_name="VIEW", last_name="ONLY", username="VIEW ONLY",
                password_hash=pwd_context.hash("viewone01"), role="Viewer"))
    db.commit()
    db.close()

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    if previous_override is not None:
        app.dependency_overrides[get_db] = previous_override
    else:
        app.dependency_overrides.pop(get_db, None)
    # The lightning RAM caches are keyed by route, not by database: without
    # this flush the second test would see the first test's route list.
    clear_api_caches()
    engine.dispose()
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass


def _token(client, username, password):
    res = client.post("/token", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _add_record(client, headers, sbn):
    res = client.post("/franchise/", headers=headers, json={
        "operator_name": f"OP {sbn}", "route": "FLOWTODA", "address": "NATIVE TEST ADDRESS",
        "motor_no": f"MC-{sbn}", "chassis_no": f"CH-{sbn}", "make": "HONDA", "plate_no": f"PLT-{sbn}"})
    assert res.status_code == 200, res.text
    return res.json()


def _record_id(client, admin, sbn):
    recs = client.get("/franchise/route/FLOWTODA", headers=admin).json()
    row = next(r for r in recs if r["sbn_no"].startswith(sbn))
    return row["id"]


def _for_record(client, headers, rec_id):
    res = client.get(f"/tickets/for-record/{rec_id}", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _record_actions(rec_id):
    db = TestingSessionLocal()
    try:
        return [a.action for a in db.query(AuditLog).filter(
            AuditLog.target_id == rec_id).all()]
    finally:
        db.close()


def test_full_restore_cycle_status_ticket_approve(client):
    clerk = _token(client, "CLERK WORKER", "clerkone1")
    admin = _token(client, "ADMIN ONE", "adminone1")
    _add_record(client, admin, "FLW-001")
    rec_id = _record_id(client, admin, "FLOW-001")

    # Live record: not deleted, nothing pending.
    st = _for_record(client, clerk, rec_id)
    assert st["exists"] and not st["is_deleted"] and not st["restore_requested"]
    assert st["current_role"] == "Clerk"

    # Delete it (the Undo/History/Logs affordances all start here).
    res = client.delete(f"/api/operators/{rec_id}", headers=clerk)
    assert res.status_code == 200, res.text
    st = _for_record(client, clerk, rec_id)
    assert st["is_deleted"] and not st["restore_requested"]

    # A read-only Viewer is refused the whole restore path (write-through
    # effect: an approved ticket changes the registry)…
    viewer = _token(client, "VIEW ONLY", "viewone01")
    res = client.post("/api/restore-records/ticket", headers=viewer,
                      json={"record_ids": [rec_id]})
    assert res.status_code == 403 and "read-only" in res.json()["detail"], res.text

    # …and a Clerk files a ticket using just the SBN the logs page shows.
    res = client.post("/api/restore-records/ticket", headers=clerk,
                      json={"record_ids": ["FLOW-001"], "reason": "wrong entry"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "ticket_filed"

    # The affordances now show "pending", and a second ticket bounces (409).
    st = _for_record(client, clerk, rec_id)
    assert st["is_deleted"] and st["restore_requested"]
    res = client.post("/api/restore-records/ticket", headers=clerk,
                      json={"record_ids": [rec_id]})
    assert res.status_code == 409, res.text

    # The request itself is in the per-record trail.
    assert "RESTORE_REQUEST" in _record_actions(rec_id)

    # Admin approves: the record is really back and the trail says by whom.
    queue = client.get("/admin/tickets", headers=admin).json()
    ticket = next(t for t in queue if t["status"] == "pending" and t["ticket_type"] == "record_restore")
    res = client.post(f"/admin/tickets/{ticket['id']}/approve", headers=admin,
                      json={"note": ""})
    assert res.status_code == 200, res.text
    assert res.json()["result_note"] == "Restored 1 record(s)."

    st = _for_record(client, clerk, rec_id)
    assert st["is_deleted"] is False and st["restore_requested"] is False
    assert "RESTORE_APPROVED" in _record_actions(rec_id)
    db = TestingSessionLocal()
    try:
        rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == rec_id).one()
        assert rec.is_deleted is False  # really back in the registry
    finally:
        db.close()


def test_admin_direct_restore_and_already_restored_note(client):
    clerk = _token(client, "CLERK WORKER", "clerkone1")
    admin = _token(client, "ADMIN ONE", "adminone1")
    _add_record(client, admin, "FLOW-002")
    # The backend auto-numbers the SBN (FLOW-001-26 here); take whichever
    # record the route now has.
    all_rows = client.get("/franchise/route/FLOWTODA", headers=admin).json()
    assert all_rows, "the added record must appear on its route"
    rec_id = all_rows[0]["id"]
    res = client.delete(f"/api/operators/{rec_id}", headers=admin)
    assert res.status_code == 200, res.text

    # Admin direct execution REQUIRES the written reason (single-key rule).
    res = client.post("/api/restore-records/ticket", headers=admin,
                      json={"record_ids": [rec_id]})
    assert res.status_code == 400, res.text

    res = client.post("/api/restore-records/ticket", headers=admin,
                      json={"record_ids": [rec_id], "override_reason": "entered by mistake"})
    assert res.status_code == 200 and res.json()["status"] == "success", res.text
    assert "RESTORE_DIRECT" in _record_actions(rec_id)

    # A Clerk ticket filed against a record ALREADY restored stops honestly.
    res = client.post("/api/restore-records/ticket", headers=clerk,
                      json={"record_ids": [rec_id]})
    assert res.status_code == 400 and "already be restored" in res.json()["detail"], res.text

    # Approving a stale ticket (records already back via a direct restore)
    # reports the truth instead of "Restored 0 record(s)."
    ticket = ApprovalTicket(
        created_by="CLERK WORKER", ticket_type="record_restore",
        payload_json='{"record_ids": ["%s"]}' % rec_id, reason="stale")
    db = TestingSessionLocal()
    try:
        db.add(ticket)
        db.commit()
        tid = ticket.id
    finally:
        db.close()
    res = client.post(f"/admin/tickets/{tid}/approve", headers=admin, json={"note": ""})
    assert res.status_code == 200, res.text
    assert "already back in the registry" in res.json()["result_note"], res.text
