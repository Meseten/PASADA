import sys
import os
import shutil
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
# upload_database_file opens its own SessionLocal (app DB, not the injected
# dependency), so point the whole app at a scratch data dir — never the office
# database on this machine.
os.environ["PASADA_DATA_DIR"] = os.path.join("/tmp", f"pasada-upload-test-{os.getpid()}")
import database
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
    shutil.rmtree(database.NEW_BASE_DIR, ignore_errors=True)


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


def test_upload_database_accepts_backup_zip():
    # Nightly backups are ZIPs whose payload is the .db. An office whose
    # Franchise folder is stale must still be able to import from the ZIP alone.
    import zipfile as _zip
    from database import FranchiseRecord

    src = os.path.join(os.path.dirname(TEST_DB_PATH), "zip_src.db")
    if os.path.exists(src):
        os.remove(src)
    se = create_engine(f"sqlite:///{src}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=se)
    SS = sessionmaker(bind=se)
    s = SS()
    s.add(FranchiseRecord(id="zip-1", sbn_no="ZIP-100", operator_name="ZIP IMPORT ME",
                          address="NAIC, CAVITE", motor_no="M-Z1", chassis_no="C-Z1",
                          make="HONDA", plate_no="", route="BATODA", is_active=True))
    s.commit()
    s.close()
    se.dispose()

    zip_buf = io.BytesIO()
    with _zip.ZipFile(zip_buf, "w", _zip.ZIP_DEFLATED) as zf:
        zf.write(src, "pasada.db")
    os.remove(src)

    headers = {"Authorization": f"Bearer {get_token()}"}
    res = client.post(
        "/upload/database",
        files={"file": ("PASADA_Backup_2026-01-01.zip", zip_buf.getvalue(), "application/zip")},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["imported"] >= 1
    assert body["skipped"] >= 0

    tmp_session = database.SessionLocal()
    assert tmp_session.query(FranchiseRecord).filter(
        FranchiseRecord.id == "zip-1",
        FranchiseRecord.operator_name == "ZIP IMPORT ME",
    ).count() == 1, "merged record must land in the app database"
    tmp_session.close()


def test_upload_database_rejects_zip_without_db():
    import zipfile as _zip
    zip_buf = io.BytesIO()
    with _zip.ZipFile(zip_buf, "w", _zip.ZIP_DEFLATED) as zf:
        zf.writestr("readme.txt", "not a backup")
    headers = {"Authorization": f"Bearer {get_token()}"}
    res = client.post(
        "/upload/database",
        files={"file": ("wrong.zip", zip_buf.getvalue(), "application/zip")},
        headers=headers,
    )
    assert res.status_code == 400
    assert ".db" in res.json()["detail"]
