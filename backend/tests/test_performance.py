import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
import time
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

from main import app, get_db
from database import Base, User

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

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    if os.path.exists(TEST_PERF_DB_PATH):
        try:
            os.remove(TEST_PERF_DB_PATH)
        except OSError:
            pass
            
    Base.metadata.create_all(bind=engine)
    
    db = TestingSessionLocal()
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    db.add(User(
        first_name="PERF", last_name="TEST", username="PERF TEST",
        password_hash=pwd_context.hash("password123"), role="Admin"
    ))
    db.commit()
    db.close()
    
    yield
    
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
    
    assert avg_per_write < 0.200, f"Average write speed exceeded 200ms: {avg_per_write:.4f}s"