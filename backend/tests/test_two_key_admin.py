# SINGLE-KEY RULE FOR HARD-TO-UNDO ACTIONS (decision 2026-10-14, owner):
# PASADA runs as ONE person operating the office PC(s), so the old two-key
# rule (a second active Admin must approve) is gone. The big, hard-to-undo
# actions (delete a route, rename a route, restore deleted records,
# deactivate an account) now run DIRECTLY when an Admin executes them, but
# ALWAYS with a MANDATORY written reason recorded loudly in the audit log.
# A Clerk still files a ticket for the Admin to execute — clerks never
# execute these themselves. The last active Admin can never be switched off
# through any path.

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

from main import app, get_db
from database import Base, User, FranchiseRecord, ApprovalTicket, AuditLog

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_two_key.db"))
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
    db.add(User(first_name="ADMIN", last_name="TWO", username="ADMIN TWO",
                password_hash=pwd_context.hash("admintwo1"), role="Admin"))
    db.add(User(first_name="CLERK", last_name="WORKER", username="CLERK WORKER",
                password_hash=pwd_context.hash("clerkone1"), role="Clerk"))
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


def _add_route(client, admin, route, sbn):
    res = client.post("/franchise/", headers=admin, json={
        "operator_name": f"OP {sbn}", "route": route, "address": "NATIVE TEST ADDRESS",
        "motor_no": f"MC-{sbn}", "chassis_no": f"CH-{sbn}", "make": "HONDA", "plate_no": f"PLT-{sbn}"})
    assert res.status_code == 200, res.text


def _pending_ticket(client, headers, ticket_type):
    queue = client.get("/admin/tickets", headers=headers).json()
    pending = [t for t in queue if t["status"] == "pending" and t["ticket_type"] == ticket_type]
    assert pending, f"no pending {ticket_type} ticket in {queue[:2]}"
    return pending[0]


# --- WITH TWO ADMINS: THE ADMIN STILL EXECUTES DIRECTLY, REASON REQUIRED ---

def test_admin_delete_route_runs_directly_with_reason(client):
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")
    _add_route(client, admin_one, "TWOKLINE", "TWK-001")

    # Even with a second active Admin in the office, the Admin's own delete
    # runs right away — the single-key decision removed the ticket gate.
    # What stays mandatory is the written reason.
    res = client.delete("/api/routes/TWOKLINE", headers=admin_one)
    assert res.status_code == 400 and "Type a short reason" in res.json()["detail"], res.text

    res = client.delete("/api/routes/TWOKLINE?override_reason=confirmed%20with%20the%20office",
                        headers=admin_one)
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    gone = db.query(FranchiseRecord).filter(FranchiseRecord.route == "TWOKLINE",
                                            FranchiseRecord.is_deleted == True).count()
    details = [a.details for a in db.query(AuditLog).filter(AuditLog.action == "DELETE_ROUTE").all()]
    db.close()
    assert gone == 1, "the delete must execute directly"
    # The written reason is recorded loudly in the audit log.
    assert any("confirmed with the office" in d for d in details), details


def test_admin_rename_runs_directly_with_reason(client):
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")
    _add_route(client, admin_one, "RENLINE", "REN-001")

    res = client.put("/api/routes/RENLINE/rename", headers=admin_one,
                     json={"new_route_name": "RENLINE2", "new_prefix": "RN2", "new_driving_route": ""})
    assert res.status_code == 400 and "Type a short reason" in res.json()["detail"], res.text

    res = client.put("/api/routes/RENLINE/rename", headers=admin_one,
                     json={"new_route_name": "RENLINE2", "new_prefix": "RN2",
                           "new_driving_route": "", "override_reason": "line really moved"})
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    moved = db.query(FranchiseRecord).filter(FranchiseRecord.route == "RENLINE2").count()
    db.close()
    assert moved == 1, "the rename must execute directly"


def test_admin_deactivation_runs_directly_with_reason(client):
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")

    # The Admin may switch another account off right away, with a reason.
    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN TWO", "is_active": False})
    assert res.status_code == 400 and "Type a short reason" in res.json()["detail"], res.text

    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN TWO", "is_active": False,
                           "override_reason": "second account is leaving"})
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    flag = db.query(User).filter(User.username == "ADMIN TWO").first().is_deactivated
    details = [a.details for a in db.query(AuditLog).filter(AuditLog.action == "DEACTIVATE_USER").all()]
    db.close()
    assert flag, "the deactivation must take effect immediately"
    assert any("second account is leaving" in d for d in details), details

    # Reactivation works the same way: direct, reason required.
    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN TWO", "is_active": True,
                           "override_reason": "returns to work"})
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    flag = db.query(User).filter(User.username == "ADMIN TWO").first().is_deactivated
    db.close()
    assert not flag


def test_last_active_admin_cannot_be_switched_off(client):
    # The invariant that mattered most under two-key STILL holds: an active
    # Admin cannot switch off their own account, so the office never runs
    # zero active Admins, no matter what.
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")

    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN TWO", "is_active": False,
                           "override_reason": "leaving"})
    assert res.status_code == 200, res.text

    # Only ADMIN ONE remains active. They cannot switch themselves off.
    db = TestingSessionLocal()
    only_admin = db.query(User).filter(User.username == "ADMIN ONE").first()
    assert only_admin.role == "Admin" and not only_admin.is_deactivated
    db.close()

    # A clerk calling set-active on the last admin: 403 before anything else.
    clerk = _token(client, "CLERK WORKER", "clerkone1")
    res = client.put("/users/set-active", headers=clerk,
                     json={"username": "ADMIN ONE", "is_active": False,
                           "override_reason": "anything"})
    assert res.status_code == 403

    # Even the last admin's own account refuses self-deactivation (400).
    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN ONE", "is_active": False,
                           "override_reason": "why not"})
    assert res.status_code == 400
    db = TestingSessionLocal()
    assert not db.query(User).filter(User.username == "ADMIN ONE").first().is_deactivated
    db.close()


# --- CLERKS: TICKETS, NEVER DIRECT EXECUTION ---

def test_clerk_delete_files_ticket_for_admin(client):
    admin = _token(client, "ADMIN ONE", "adminone1")
    clerk = _token(client, "CLERK WORKER", "clerkone1")
    _add_route(client, admin, "CLERKLINE", "CLK-001")

    res = client.delete("/api/routes/CLERKLINE", headers=clerk)
    assert res.status_code == 200 and res.json()["status"] == "ticket_filed", res.text
    assert "the Admin" in res.json()["message"]
    db = TestingSessionLocal()
    alive = db.query(FranchiseRecord).filter(FranchiseRecord.route == "CLERKLINE",
                                             FranchiseRecord.is_deleted == False).count()
    db.close()
    assert alive == 1, "a filed ticket must not touch the data"

    db = TestingSessionLocal()
    details = [a.details for a in db.query(AuditLog).filter(AuditLog.action == "TICKET_FILED").all()]
    db.close()
    assert any("CLERKLINE" in d for d in details), details

    # A clerk cannot approve anything: the gate is Admin-only.
    ticket = _pending_ticket(client, admin, "route_delete")
    assert client.post(f"/admin/tickets/{ticket['id']}/approve", headers=clerk).status_code == 403


def test_clerk_restore_filed_and_admin_executes_with_reason(client):
    admin = _token(client, "ADMIN ONE", "adminone1")
    clerk = _token(client, "CLERK WORKER", "clerkone1")
    db = TestingSessionLocal()
    db.add(FranchiseRecord(sbn_no="OVR-001", operator_name="OVERRIDE OP",
                           route="OVRROUTE", address="NATIVE TEST ADDRESS", is_deleted=True))
    db.commit()
    db.close()

    # The clerk files. Nothing moves.
    res = client.post("/api/restore-records/ticket", headers=clerk, json={"all": True})
    assert res.status_code == 200 and res.json()["status"] == "ticket_filed", res.text
    ticket = _pending_ticket(client, admin, "record_restore")

    # A restore ticket already pending blocks a second one (409).
    res = client.post("/api/restore-records/ticket", headers=clerk, json={"all": True})
    assert res.status_code == 409, res.text

    # The Admin approves. The queued action executes the restore.
    ok = client.post(f"/admin/tickets/{ticket['id']}/approve", headers=admin, json={"note": "ok"})
    assert ok.status_code == 200, ok.text
    db = TestingSessionLocal()
    alive = db.query(FranchiseRecord).filter(FranchiseRecord.sbn_no == "OVR-001",
                                             FranchiseRecord.is_deleted == False).count()
    db.close()
    assert alive == 1, "approval must execute the restore"


def test_admin_restore_direct_requires_reason(client):
    admin = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")  # second admin present
    db = TestingSessionLocal()
    db.add(FranchiseRecord(sbn_no="DR-001", operator_name="DIRECT OP",
                           route="DRROUTE", address="NATIVE TEST ADDRESS", is_deleted=True))
    db.commit()
    db.close()

    res = client.post("/api/restore-records/ticket", headers=admin, json={"all": True})
    assert res.status_code == 400 and "Type a short reason" in res.json()["detail"], res.text
    res = client.post("/api/restore-records/ticket", headers=admin,
                      json={"all": True, "override_reason": "records were deleted by mistake"})
    assert res.status_code == 200 and res.json()["status"] == "success", res.text
    db = TestingSessionLocal()
    alive = db.query(FranchiseRecord).filter(FranchiseRecord.sbn_no == "DR-001",
                                             FranchiseRecord.is_deleted == False).count()
    db.close()
    assert alive == 1


def test_single_admin_office_same_rule_all_actions(client):
    # One-admin office: identical rule to two-admin — direct execution with
    # a mandatory reason for every hard-to-undo action.
    db = TestingSessionLocal()
    db.query(User).filter(User.username == "ADMIN TWO").delete()
    db.commit()
    db.close()
    admin = _token(client, "ADMIN ONE", "adminone1")
    _add_route(client, admin, "LONELY", "LON-001")

    res = client.delete("/api/routes/LONELY", headers=admin)
    assert res.status_code == 400 and "Type a short reason" in res.json()["detail"], res.text
    res = client.delete("/api/routes/LONELY?override_reason=end%20of%20the%20line", headers=admin)
    assert res.status_code == 200, res.text

    res = client.put("/users/set-active", headers=admin,
                     json={"username": "CLERK WORKER", "is_active": False,
                           "override_reason": "account left the office"})
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    details = [a.details for a in db.query(AuditLog).filter(AuditLog.action == "DEACTIVATE_USER").all()]
    db.close()
    assert any("account left the office" in d for d in details), details
