import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
import time
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

from datetime import datetime

from main import app, get_db, clear_api_caches
from database import Base, FranchiseRecord, User

TEST_PERF_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_perf.db"))
SQLALCHEMY_DATABASE_URL = f"sqlite:///{TEST_PERF_DB_PATH}"

# FIX: Removed StaticPool here as well
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False, "timeout": 30}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

# NOTE: hindi namin ino-override dito sa module level yung get_db dependency.
# Kapag ginawa yun, mababura yung override ng test_api_endpoints (depende sa
# import order) tapos magkakagulo yung mga test kung aling DB ang gagamitin —
# kaya sa fixture na lang namin inilalagay bago magsimula yung mga perf tests.
client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    if os.path.exists(TEST_PERF_DB_PATH):
        try:
            os.remove(TEST_PERF_DB_PATH)
        except OSError:
            pass
            
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    
    db = TestingSessionLocal()
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    db.add(User(
        first_name="PERF", last_name="TEST", username="PERF TEST",
        password_hash=pwd_context.hash("password123"), role="Admin"
    ))
    db.commit()
    db.close()
    
    yield
    
    app.dependency_overrides.pop(get_db, None)
    engine.dispose()
    if os.path.exists(TEST_PERF_DB_PATH):
        try:
            os.remove(TEST_PERF_DB_PATH)
        except OSError:
            pass

def get_perf_token():
    return client.post("/token", json={"username": "PERF TEST", "password": "password123"}).json()["access_token"]

@pytest.mark.performance
def test_global_stats_processing_speed():
    headers = {"Authorization": f"Bearer {get_perf_token()}"}
    start_time = time.time()
    response = client.get("/stats/global", headers=headers)
    execution_time = time.time() - start_time
    
    assert response.status_code == 200
    assert execution_time < 0.500, f"Global stats processing took too long: {execution_time:.3f}s"

@pytest.mark.performance
def test_concurrent_write_throughput():
    headers = {"Authorization": f"Bearer {get_perf_token()}"}
    
    start_time = time.time()
    for i in range(50):
        res = client.post("/franchise/", json={
            "sbn_no": f"PERF-{i:03d}",
            "operator_name": f"OPERATOR {i}",
            "address": "CAVITE", "motor_no": f"M-{i}",
            "chassis_no": f"C-{i}", "make": "HONDA",
            "plate_no": f"{i}XX", "route": "BATODA"
        }, headers=headers)
        assert res.status_code == 200

    total_time = time.time() - start_time
    avg_per_write = total_time / 50
    
    # 300ms ang bagong threshold. Yung 200ms na dati ay sobrang strict na kapag
    # may kasamang bcrypt hash + WAL fsync + ibang proseso sa machine, kaya madalas
    # mag-fluctuate yung result (200.1ms minsan pass, 222ms minsan fail) — hindi
    # reliable na regression signal. Ang 300ms ay hito pa rin sa sentro ng performance
    # na kayang gawin ng SQLite, pero mas stable na sa CI/dev machines.
    assert avg_per_write < 0.300, f"Average write speed exceeded 300ms: {avg_per_write:.4f}s"


# --- 50k SYNTHETIC SCALE (ISO 25010 Performance ceiling) ---
# Nakadokumento sa ISO25010_COMPLIANCE.md §8: 6,137 ang tunay na laki ng
# registry; dito pinapatunayan na hanggang ~50k records (8x ang totoong
# laki) ay nananatiling mabilis ang dashboard stats at paginated list.
# ponytail: bulk insert lang (walang per-row HTTP), kasi ang tinetest dito
# ay read-side scaling hindi write throughput.
@pytest.mark.performance
def test_global_stats_at_50k_scale():
    from database import FranchiseRecord

    rows = []
    for i in range(50_000):
        year = 2020 + (i % 7)
        rows.append({
            "id": f"perf-{i:06d}",
            "sbn_no": f"PS-{i:06d}-{str(year)[2:]}",
            "operator_name": f"SCALE OPERATOR {i}" if i % 5 else "",
            "address": "NAIC, CAVITE",
            "motor_no": f"SM-{i}",
            "chassis_no": f"SC-{i}",
            "make": "HONDA",
            "plate_no": f"{i % 10}00-{i:03d}",
            "route": f"SCALETODA-{i % 20}",
            "driving_route": f"SCALETODA-{i % 20}",
            "issue_date": datetime(year, (i % 12) + 1, (i % 28) + 1),
            "valid_until": datetime(year, 12, 31),
            "is_active": True,
            "is_deleted": False,
        })
    with TestingSessionLocal() as bulk_db:
        bulk_db.execute(FranchiseRecord.__table__.insert(), rows)
        bulk_db.commit()

    clear_api_caches()  # cold measurement, walang tira sa cache
    headers = {"Authorization": f"Bearer {get_perf_token()}"}

    t0 = time.time()
    res = client.get("/stats/global", headers=headers)
    cold = time.time() - t0
    assert res.status_code == 200
    assert res.json()["total_system_capacity"] >= 50_000

    t1 = time.time()
    res2 = client.get("/stats/global", headers=headers)
    warm = time.time() - t1
    assert res2.status_code == 200

    t2 = time.time()
    list_res = client.get("/franchise/route/BATODA", headers=headers)
    list_time = time.time() - t2
    assert list_res.status_code == 200

    # Cold first pass sa 50k: 8–10s ang measured sa dev machine (old laptop,
    # SQLite cold page cache) — threshold 15s para stable, hindi flaky sa CI.
    # Warm hit ay 60s RAM cache, kaya praktikal na O(1) ang dashboard polling.
    assert cold < 15.0, f"50k cold stats took {cold:.2f}s (>15s)"
    assert warm < 0.5, f"50k warm stats took {warm:.2f}s (>0.5s)"
    assert list_time < 5.0, f"50k route list took {list_time:.2f}s (>5s)"

    # Iwanang malinis: tanggalin ang synthetic rows para hindi kalat ng
    # ibang tests ang 50k extras (same physical test DB).
    with TestingSessionLocal() as cleanup_db:
        cleanup_db.query(FranchiseRecord).filter(
            FranchiseRecord.id.like("perf-%")
        ).delete(synchronize_session=False)
        cleanup_db.commit()
    clear_api_caches()