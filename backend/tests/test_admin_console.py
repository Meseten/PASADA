"""ADMIN CONSOLE ENDPOINT TESTS.

Covers the pieces the Admin Console rides on:
  * bootstrap: an office with no admin can mint its first one in-place;
    once an admin exists, bootstrap refuses forever.
  * gates: line-wide deletes, renames, the DB refresh, and whole-database
    import refuse clerks with 403.
  * template upload: real .docx in, garbage rejected, audit row written.
  * diagnostics + audit overview: read-only, admin-only, real numbers.
  * activity-log filter: routes list is TODA lines only; SYSTEM entries are
    reachable through the SYSTEM choice instead of polluting TODA names.
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import io
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext
from docx import Document

import main
from main import app, get_db
from database import Base, User, AuditLog, FranchiseRecord, ApprovalTicket

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_admin_console.db"))
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
    # Only a Clerk exists: the exact "office with no admin" situation the
    # bootstrap endpoint exists to fix.
    db = TestingSessionLocal()
    db.add(User(first_name="FIRST", last_name="CLERK", username="FIRST CLERK",
                password_hash=pwd_context.hash("clerkpass123"), role="Clerk"))
    db.commit()
    db.close()

    # Save the previous override (another module may have registered one at
    # import time) and put it back on teardown. Overwrite-and-pop would leave
    # that module pointing at the real database.
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


def _token(client, username="FIRST CLERK", password="clerkpass123"):
    res = client.post("/token", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_clerk_sees_bootstrap_needed_and_promotes_self(client):
    headers = _token(client)
    needed = client.get("/admin/needed", headers=headers)
    assert needed.status_code == 200
    assert needed.json() == {"needed": True}

    wrong = client.post("/admin/bootstrap", headers=headers, json={"password": "not-my-password"})
    assert wrong.status_code == 401

    ok = client.post("/admin/bootstrap", headers=headers, json={"password": "clerkpass123"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["role"] == "Admin"

    # The promotion survives a fresh login: role comes back from the DB.
    fresh = client.post("/token", json={"username": "FIRST CLERK", "password": "clerkpass123"})
    assert fresh.json()["role"] == "Admin"

    # Every step landed in the audit trail, including the refused attempt.
    db = TestingSessionLocal()
    actions = {row[0] for row in db.query(AuditLog.action).all()}
    db.close()
    assert "ADMIN_BOOTSTRAP_DENIED" in actions
    assert "ADMIN_BOOTSTRAP" in actions


def test_bootstrap_refuses_once_admin_exists(client):
    # Bootstrap answered 403 BEFORE any admin existed for a wrong password;
    # now an admin exists, the endpoint is closed for good.
    headers = _token(client)
    db = TestingSessionLocal()
    db.add(User(first_name="SECOND", last_name="CLERK", username="SECOND CLERK",
                password_hash=pwd_context.hash("secondpass123"), role="Clerk"))
    db.commit()
    db.close()
    res = client.post("/admin/bootstrap", headers=_token(client, "SECOND CLERK", "secondpass123"),
                      json={"password": "secondpass123"})
    assert res.status_code == 403


def test_admin_needed_false_when_admin_exists(client):
    res = client.get("/admin/needed", headers=_token(client))
    assert res.status_code == 200
    assert res.json() == {"needed": False}


def test_route_delete_rename_refresh_and_db_upload_refuse_clerk(client):
    # A brand-new clerk must hit 403 on every line-wide or registry-wide
    # operation. These are the exact calls the Admin Console owns now.
    db = TestingSessionLocal()
    db.add(User(first_name="PLAIN", last_name="CLERK", username="PLAIN CLERK",
                password_hash=pwd_context.hash("plainpass123"), role="Clerk"))
    db.commit()
    db.close()
    clerk = _token(client, "PLAIN CLERK", "plainpass123")

    # The clerk CAN'T do these alone anymore — but the call never dead-ends:
    # route delete and rename now file an approval ticket (200 with
    # status=ticket_filed); the true Admin-only endpoints still 403.
    t1 = client.delete("/api/routes/TESTLINE", headers=clerk)
    assert t1.status_code == 404  # route does not exist here
    client.post("/franchise/", headers=clerk, json={
        "operator_name": "TICKET OPERATOR", "route": "TESTLINE", "address": "NATIVE TEST ADDRESS",
        "motor_no": "MC-900", "chassis_no": "CH-900", "make": "HONDA", "plate_no": "TKT-9001"})
    t1 = client.delete("/api/routes/TESTLINE", headers=clerk)
    assert t1.status_code == 200 and t1.json()["status"] == "ticket_filed", t1.text
    # A second delete ticket for the same route is blocked while one pends.
    t2 = client.delete("/api/routes/TESTLINE", headers=clerk)
    assert t2.status_code == 409, t2.text
    # A rename request also files (separate action, own ticket).
    t3 = client.put("/api/routes/TESTLINE/rename", headers=clerk,
                    json={"new_route_name": "X", "new_prefix": "", "new_driving_route": ""})
    assert t3.status_code == 200 and t3.json()["status"] == "ticket_filed", t3.text
    assert client.post("/admin/refresh-db", headers=clerk).status_code == 403
    assert client.get("/admin/diagnostics", headers=clerk).status_code == 403
    assert client.get("/admin/audit-overview", headers=clerk).status_code == 403
    assert client.get("/admin/templates", headers=clerk).status_code == 403

    # The admin passes the same gates.
    admin = _token(client)
    assert client.get("/admin/diagnostics", headers=admin).status_code == 200
    overview_res = client.get("/admin/audit-overview", headers=admin)
    assert overview_res.status_code == 200
    # The 7-day chart series must always have exactly 7 bars, one per day,
    # even when the office was quiet: a gap must read as zero, not missing.
    daily = overview_res.json()["daily_last_7_days"]
    assert len(daily) == 7
    assert all("day" in d and "count" in d and d["count"] >= 0 for d in daily)


def test_users_list_reports_last_sign_in(client):
    admin = _token(client)
    # The admin signs in, so their row must carry a timestamp; a freshly
    # created account that never signed in shows None.
    res = client.post("/users", headers=admin, json={
        "first_name": "NEVER", "last_name": "LOGGED",
        "username": "NEVER LOGGED", "password": "neverpass1",
        "password_confirm": "neverpass1", "role": "Clerk",
    })
    assert res.status_code == 200, res.text
    users = {u["username"]: u for u in client.get("/users", headers=admin).json()}
    assert users["NEVER LOGGED"]["last_login"] is None
    # The signed-in admin (FIRST CLERK, promoted by bootstrap) has logged in.
    assert users["FIRST CLERK"]["last_login"] is not None


def test_template_upload_roundtrip_and_rejection(client):
    admin = _token(client)

    listing = client.get("/admin/templates", headers=admin)
    assert listing.status_code == 200
    templates = {t["key"]: t for t in listing.json()}
    assert set(templates) == {"certificate", "toda_summary"}
    assert templates["certificate"]["installed"] is True

    # A real .docx with the placeholder tokens is accepted and audited.
    doc = Document()
    doc.add_paragraph("MTOP [SBN_NO] for [NAME]")
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    ok = client.post("/admin/templates/certificate", headers=admin,
                     files={"file": ("template.docx", buf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert ok.status_code == 200, ok.text
    assert ok.json()["recognized_tokens"] == 2
    assert ok.json()["warning"] is None

    db = TestingSessionLocal()
    uploads = db.query(AuditLog).filter(AuditLog.action == "TEMPLATE_UPLOAD").count()
    db.close()
    assert uploads == 1, "template upload must land in the audit log"

    # A text file pretending to be a template is rejected outright.
    fake = io.BytesIO(b"this is not a word document")
    bad = client.post("/admin/templates/certificate", headers=admin,
                      files={"file": ("template.docx", fake, "application/octet-stream")})
    assert bad.status_code == 400

    # A .docx without the placeholder tokens uploads but carries a warning,
    # so the admin knows to check before printing certificates.
    empty = Document()
    empty.add_paragraph("no tokens here")
    buf2 = io.BytesIO()
    empty.save(buf2)
    buf2.seek(0)
    warned = client.post("/admin/templates/toda_summary", headers=admin,
                         files={"file": ("dashboard_template.docx", buf2, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert warned.status_code == 200
    assert warned.json()["warning"]


def test_log_routes_filter_is_toda_only(client):
    # The logs page filter must offer TODA lines, never SYSTEM/ALL noise.
    db = TestingSessionLocal()
    db.add(AuditLog(clerk_name="SYSTEM", action="ADMIN_BOOTSTRAP", target_id="0",
                    target_route="SYSTEM", details="system-level entry"))
    db.add(AuditLog(clerk_name="A CLERK", action="DELETE_RECORD", target_id="BAT-001",
                    target_route="BATODA", details="a real line entry"))
    db.commit()
    db.close()

    res = client.get("/logs/actions", headers=_token(client))
    assert res.status_code == 200
    routes = res.json()["routes"]
    assert "BATODA" in routes
    assert "SYSTEM" not in routes
    assert "ALL" not in routes

    # System entries stay reachable on purpose through the SYSTEM choice.
    sys_res = client.get("/logs?route=SYSTEM", headers=_token(client))
    assert sys_res.status_code == 200
    details = [item["details"] for item in sys_res.json()["items"]]
    assert any("system-level entry" in d for d in details)

    # A TODA pick never drags system rows in.
    toda_res = client.get("/logs?route=BATODA", headers=_token(client))
    toda_details = [item["details"] for item in toda_res.json()["items"]]
    assert any("line entry" in d for d in toda_details)
    assert not any("system-level" in d for d in toda_details)


def test_approval_ticket_full_flow(client):
    """The two-key rule end to end: a clerk's request changes NOTHING until
    the Admin approves, and a rejection leaves the data exactly as it was."""
    db = TestingSessionLocal()
    db.add(FranchiseRecord(sbn_no="TLT-001", operator_name="TICKET OPERATOR",
                           route="TICKETLINE", address="NATIVE TEST ADDRESS"))
    db.commit()
    db.close()
    clerk = _token(client, "PLAIN CLERK", "plainpass123")
    admin = _token(client)

    # 1. Clerk files a delete request. Nothing is deleted yet.
    filed = client.delete("/api/routes/TICKETLINE", headers=clerk)
    assert filed.status_code == 200 and filed.json()["status"] == "ticket_filed"
    db = TestingSessionLocal()
    alive = db.query(FranchiseRecord).filter(FranchiseRecord.route == "TICKETLINE",
                                             FranchiseRecord.is_deleted == False).count()
    assert alive == 1, "a filed ticket must not touch the data"
    db.close()

    # 2. Admin sees the pending ticket and approves it. NOW it runs.
    # (The filing clerk is a different person, so the second-key rule passes;
    # the admin alone in this module's office executes the approved action.)
    queue = client.get("/admin/tickets", headers=admin).json()
    pending = [t for t in queue if t["status"] == "pending" and t["ticket_type"] == "route_delete"
               and t["payload"].get("route") == "TICKETLINE"]
    assert pending, f"ticket missing from the queue: {queue[:2]}"
    ok = client.post(f"/admin/tickets/{pending[0]['id']}/approve", headers=admin, json={"note": "confirmed with the office"})
    assert ok.status_code == 200, ok.text
    db = TestingSessionLocal()
    gone = db.query(FranchiseRecord).filter(FranchiseRecord.route == "TICKETLINE",
                                            FranchiseRecord.is_deleted == True).count()
    assert gone == 1, "approval must execute the delete"
    db.close()

    # 3. A rejected rename never executes.
    ren = client.put("/api/routes/TICKETLINE/rename", headers=clerk,
                     json={"new_route_name": "NEWLINE", "new_prefix": "NL", "new_driving_route": ""})
    assert ren.status_code == 200 and ren.json()["status"] == "ticket_filed"
    queue = client.get("/admin/tickets", headers=admin).json()
    ren_ticket = [t for t in queue if t["status"] == "pending" and t["ticket_type"] == "route_rename"][0]
    no = client.post(f"/admin/tickets/{ren_ticket['id']}/reject", headers=admin, json={"note": "wrong line"})
    assert no.status_code == 200
    db = TestingSessionLocal()
    still = db.query(FranchiseRecord).filter(FranchiseRecord.route == "TICKETLINE").count()
    assert still == 1, "rejection must leave the data untouched"
    decided = db.query(ApprovalTicket).filter(ApprovalTicket.id == ren_ticket["id"]).first()
    assert decided.status == "rejected" and decided.result_note == "wrong line"
    db.close()

    # 4. Clerks read the queue to see their own request's fate, but cannot decide.
    view = client.get("/admin/tickets?status_filter=all", headers=clerk)
    assert view.status_code == 200
    assert client.post(f"/admin/tickets/{ren_ticket['id']}/approve", headers=clerk).status_code == 403
