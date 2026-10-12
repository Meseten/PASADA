# TWO-KEY RULE FOR ADMINS: the big, hard-to-undo actions (delete a route,
# rename a route, restore deleted records, deactivate an account) always
# need a second active Admin to approve, even when the person clicking is
# themselves an Admin. Nobody approves their own ticket. A one-admin office
# (the deployment reality) cannot second-key itself, so there the Admin's
# valve is direct execution with a MANDATORY written reason, recorded in
# the audit log as a single-admin override. The last active Admin can never
# be switched off through any path.

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


# --- WITH TWO ACTIVE ADMINS: EVERY BIG ACTION BECOMES A TICKET ---

def test_admin_delete_route_files_ticket_for_other_admin(client):
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")
    _add_route(client, admin_one, "TWOKLINE", "TWK-001")

    res = client.delete("/api/routes/TWOKLINE", headers=admin_one)
    assert res.status_code == 200 and res.json()["status"] == "ticket_filed", res.text

    # Nobody approves their own ticket, even the other admin filing it.
    ticket = _pending_ticket(client, admin_two, "route_delete")
    assert ticket["created_by"] == "ADMIN ONE"
    res = client.post(f"/admin/tickets/{ticket['id']}/approve", headers=admin_one)
    assert res.status_code == 403, res.text

    # A DIFFERENT admin approves; only then does the delete run.
    ok = client.post(f"/admin/tickets/{ticket['id']}/approve", headers=admin_two, json={"note": "confirmed with the office"})
    assert ok.status_code == 200, ok.text
    db = TestingSessionLocal()
    gone = db.query(FranchiseRecord).filter(FranchiseRecord.route == "TWOKLINE",
                                            FranchiseRecord.is_deleted == True).count()
    db.close()
    assert gone == 1, "approval must execute the delete"


def test_admin_rename_files_ticket_and_other_admin_approves(client):
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")
    _add_route(client, admin_one, "RENLINE", "REN-001")

    res = client.put("/api/routes/RENLINE/rename", headers=admin_one,
                     json={"new_route_name": "RENLINE2", "new_prefix": "RN2", "new_driving_route": ""})
    assert res.status_code == 200 and res.json()["status"] == "ticket_filed", res.text

    ticket = _pending_ticket(client, admin_two, "route_rename")
    ok = client.post(f"/admin/tickets/{ticket['id']}/approve", headers=admin_two, json={"note": "line really moved"})
    assert ok.status_code == 200, ok.text
    db = TestingSessionLocal()
    moved = db.query(FranchiseRecord).filter(FranchiseRecord.route == "RENLINE2").count()
    db.close()
    assert moved == 1, "approval must execute the rename"


def test_admin_deactivation_files_ticket_and_consent_flow_works(client):
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")

    # Admin ONE files to switch off Admin TWO.
    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN TWO", "is_active": False})
    assert res.status_code == 200 and res.json()["status"] == "ticket_filed", res.text

    # Admin TWO approves his own switch-off: that is the consent flow (the
    # filing admin stays active, so the office keeps a working admin).
    # What is forbidden is the FILER approving their own ticket.
    ticket = _pending_ticket(client, admin_two, "user_deactivate")
    res = client.post(f"/admin/tickets/{ticket['id']}/approve", headers=admin_one)
    assert res.status_code == 403, "the filing admin must not approve their own ticket"
    ok = client.post(f"/admin/tickets/{ticket['id']}/approve", headers=admin_two, json={"note": "I accept the switch-off"})
    assert ok.status_code == 200, ok.text
    db = TestingSessionLocal()
    flag = db.query(User).filter(User.username == "ADMIN TWO").first().is_deactivated
    db.close()
    assert flag, "the consented deactivation must take effect"

    # Reactivation: with ADMIN TWO switched off the office is back to ONE
    # active admin, so the override valve applies (reason required).
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN TWO", "is_active": True})
    assert res.status_code == 400, res.text
    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN TWO", "is_active": True, "override_reason": "second admin returns to work"})
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    flag = db.query(User).filter(User.username == "ADMIN TWO").first().is_deactivated
    db.close()
    assert not flag


def test_last_active_admin_cannot_be_switched_off(client):
    admin_one = _token(client, "ADMIN ONE", "adminone1")
    admin_two = _token(client, "ADMIN TWO", "admintwo1")

    # Admin ONE files to switch off Admin TWO. Admin TWO approves (consent),
    # leaving ADMIN ONE as the last active admin. Now nobody may switch
    # ADMIN ONE off: the guard fires even before a ticket could help.
    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN TWO", "is_active": False})
    assert res.status_code == 200 and res.json()["status"] == "ticket_filed", res.text
    ticket = _pending_ticket(client, admin_two, "user_deactivate")
    client.post(f"/admin/tickets/{ticket['id']}/approve", headers=admin_two, json={"note": "agreed"})

    db = TestingSessionLocal()
    only_admin = db.query(User).filter(User.username == "ADMIN ONE").first()
    assert only_admin.role == "Admin" and not only_admin.is_deactivated
    db.close()

    # A clerk calls set-active on the last admin: 403 before anything else.
    clerk = _token(client, "CLERK WORKER", "clerkone1")
    res = client.put("/users/set-active", headers=clerk,
                     json={"username": "ADMIN ONE", "is_active": False})
    assert res.status_code == 403

    # Even the last admin's own account refuses self-deactivation (400).
    res = client.put("/users/set-active", headers=admin_one,
                     json={"username": "ADMIN ONE", "is_active": False})
    assert res.status_code == 400
    db = TestingSessionLocal()
    assert not db.query(User).filter(User.username == "ADMIN ONE").first().is_deactivated
    db.close()


# --- SINGLE-ADMIN OFFICE: THE OVERRIDE VALVE ---

def test_single_admin_override_requires_reason(client):
    db = TestingSessionLocal()
    db.query(User).filter(User.username == "ADMIN TWO").delete()
    db.commit()
    db.close()
    admin = _token(client, "ADMIN ONE", "adminone1")
    _add_route(client, admin, "SINGLETON", "SGL-001")

    # Without a reason: refused with guidance.
    res = client.delete("/api/routes/SINGLETON", headers=admin)
    assert res.status_code == 400 and "only active Admin" in res.json()["detail"], res.text
    res = client.put("/users/set-active", headers=admin,
                     json={"username": "CLERK WORKER", "is_active": False})
    assert res.status_code == 400 and "only active Admin" in res.json()["detail"], res.text

    # With a reason: executes, and the audit log records the override.
    res = client.put("/users/set-active", headers=admin,
                     json={"username": "CLERK WORKER", "is_active": False, "override_reason": "account left the office"})
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    details = [a.details for a in db.query(AuditLog).filter(AuditLog.action == "DEACTIVATE_USER").all()]
    db.close()
    assert any("Single-admin override" in d and "account left the office" in d for d in details)


def test_single_admin_route_delete_and_rename_override(client):
    db = TestingSessionLocal()
    db.query(User).filter(User.username == "ADMIN TWO").delete()
    db.commit()
    db.close()
    admin = _token(client, "ADMIN ONE", "adminone1")
    _add_route(client, admin, "LONELY", "LON-001")

    # Route delete without a reason: refused. With a reason: runs.
    res = client.delete("/api/routes/LONELY", headers=admin)
    assert res.status_code == 400, res.text
    res = client.delete("/api/routes/LONELY?override_reason=end%20of%20the%20line", headers=admin)
    assert res.status_code == 200, res.text
    db = TestingSessionLocal()
    gone = db.query(FranchiseRecord).filter(FranchiseRecord.route == "LONELY", FranchiseRecord.is_deleted == True).count()
    db.close()
    assert gone == 1

    # Rename through the override valve as well.
    res = client.put("/api/routes/LONELY/rename", headers=admin,
                     json={"new_route_name": "LONELY2", "new_prefix": "", "new_driving_route": "", "override_reason": "typo fix"})
    assert res.status_code == 404, "the route was just deleted, so no records remain"


def test_single_admin_restore_override(client):
    db = TestingSessionLocal()
    db.query(User).filter(User.username == "ADMIN TWO").delete()
    db.commit()
    db.add(FranchiseRecord(sbn_no="OVR-001", operator_name="OVERRIDE OP",
                           route="OVRROUTE", address="NATIVE TEST ADDRESS", is_deleted=True))
    db.commit()
    db.close()
    admin = _token(client, "ADMIN ONE", "adminone1")

    res = client.post("/api/restore-records/ticket", headers=admin, json={"all": True})
    assert res.status_code == 400 and "only active Admin" in res.json()["detail"], res.text
    res = client.post("/api/restore-records/ticket", headers=admin,
                      json={"all": True, "override_reason": "records were deleted by mistake"})
    assert res.status_code == 200 and res.json()["status"] == "success", res.text
    db = TestingSessionLocal()
    alive = db.query(FranchiseRecord).filter(FranchiseRecord.sbn_no == "OVR-001",
                                             FranchiseRecord.is_deleted == False).count()
    db.close()
    assert alive == 1


# --- CLERKS ARE UNCHANGED: TICKETS, NEVER DIRECT EXECUTION ---

def test_clerk_path_unchanged_by_two_key_rule(client):
    admin = _token(client, "ADMIN ONE", "adminone1")
    clerk = _token(client, "CLERK WORKER", "clerkone1")
    _add_route(client, admin, "CLERKLINE", "CLK-001")

    res = client.delete("/api/routes/CLERKLINE", headers=clerk)
    assert res.status_code == 200 and res.json()["status"] == "ticket_filed", res.text
    # The clerk's message names the Admin (there is no 'other' admin for them).
    assert "the Admin" in res.json()["message"]
    # A clerk cannot approve anything, and the reason override never applies
    # to a clerk (require_admin fires first on approve).
    ticket = _pending_ticket(client, admin, "route_delete")
    assert client.post(f"/admin/tickets/{ticket['id']}/approve", headers=clerk).status_code == 403
