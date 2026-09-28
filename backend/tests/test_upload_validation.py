import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import io
import openpyxl
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

from main import app, get_db
from database import Base, User

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_upload.db"))
engine = create_engine(f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False, "timeout": 30})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


client = TestClient(app)


def setup_module(module):
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    db = TestingSessionLocal()
    pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
    db.add(User(first_name="U", last_name="P", username="UPLOAD TEST",
                password_hash=pwd.hash("password123"), role="Admin"))
    db.commit()
    db.close()


def teardown_module(module):
    app.dependency_overrides.pop(get_db, None)
    engine.dispose()
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)


def get_token():
    res = client.post("/token", json={"username": "UPLOAD TEST", "password": "password123"})
    return res.json()["access_token"]


def _xlsx_bytes(headers, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


# ISO 25010 Functional Suitability: uploaded Excel imports must fail loudly
# with a per-file reason when the layout is wrong, never as a silent success.
def test_upload_bulk_missing_header_fails_with_reason():
    token = get_token()
    headers = {"Authorization": f"Bearer {token}"}

    # A spreadsheet with no NAME/SBN header row in the first 20 rows.
    buf = _xlsx_bytes(["RANDOM", "STUFF"], [[1, 2], [3, 4]])
    res = client.post(
        "/upload/bulk/BATODA",
        files={"files": ("wrong_layout.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["imported"] == 0
    assert len(body["errors"]) == 1
    assert "No header row found" in body["errors"][0]
    assert "NAME and SBN" in body["errors"][0]


def test_upload_bulk_valid_layout_imports():
    token = get_token()
    headers = {"Authorization": f"Bearer {token}"}

    buf = _xlsx_bytes(
        ["SBN", "NAME", "ADDRESS", "MOTOR NO.", "CHASSIS NO.", "MAKE", "PLATE NO.", "RENEWAL DATE"],
        [["BAT-900", "JUAN DRILL", "NAIC, CAVITE", "M-900", "C-900", "HONDA", "900-AAA", "2026-01-15"]],
    )
    res = client.post(
        "/upload/bulk/BATODA",
        files={"files": ("good_layout.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["imported"] >= 1
    assert body["errors"] == []

    verify = client.get("/franchise/route/BATODA", headers=headers).json()
    assert any(r["sbn_no"].startswith("BAT-900") and r["operator_name"] == "JUAN DRILL" for r in verify)


def test_upload_bulk_requires_auth():
    buf = _xlsx_bytes(["SBN", "NAME"], [["X-1", "Y"]])
    res = client.post(
        "/upload/bulk/BATODA",
        files={"files": ("no_auth.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code in (401, 403)
