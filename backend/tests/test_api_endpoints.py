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
from database import Base, User

TEST_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_api.db"))
SQLALCHEMY_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"

# FIX: Removed StaticPool. SQLAlchemy will now correctly handle threaded writes to the physical file.
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
def setup_and_teardown_db():
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass
        
    Base.metadata.create_all(bind=engine)
    
    # Seed initial test user directly to bypass any HTTP overhead
    db = TestingSessionLocal()
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    test_user = User(
        first_name="TEST",
        last_name="ADMIN",
        username="TEST ADMIN",
        password_hash=pwd_context.hash("password123"),
        role="Admin"
    )
    db.add(test_user)
    db.commit()
    db.close()
    
    yield  
    
    engine.dispose()
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass

def get_auth_token():
    response = client.post("/token", json={"username": "TEST ADMIN", "password": "password123"})
    return response.json()["access_token"]

# --- 1. SYSTEM & HEALTH TESTS ---
def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "online"}

def test_system_network_status():
    response = client.get("/system/network")
    assert response.status_code == 200
    assert "local_ip" in response.json()

# --- 2. AUTHENTICATION & USER TESTS ---
def test_login_success():
    response = client.post("/token", json={"username": "TEST ADMIN", "password": "password123"})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["role"] == "Admin"

def test_login_invalid_credentials():
    response = client.post("/token", json={"username": "TEST ADMIN", "password": "wrongpassword"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Incorrect credentials"

def test_unlocked_signup():
    response = client.post("/signup", json={
        "first_name": "CLERK",
        "last_name": "USER",
        "username": "CLERK USER",
        "password": "clerkpassword123",
        "role": "Clerk"
    })
    assert response.status_code == 200
    assert response.json() == {"message": "Account created"}

# --- 3. FRANCHISE OPERATOR CRUD TESTS ---
def test_create_operator_and_auto_sbn():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    payload = {
        "sbn_no": "",
        "operator_name": "JUAN DELA CRUZ",
        "address": "MARAGONDON, CAVITE",
        "motor_no": "MTR-10001",
        "chassis_no": "CHS-20002",
        "make": "HONDA",
        "plate_no": "123-ABC",
        "route": "BATODA",
        "driving_route": "POBLACION",
        "issue_date": "",
        "valid_until": ""
    }
    
    response = client.post("/franchise/", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "success"

def test_change_motor_auto_date_fallback():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Create initial operator
    create_res = client.post("/franchise/", json={
        "sbn_no": "BAT-001",
        "operator_name": "PEDRO PENDUKO",
        "address": "NAIC, CAVITE",
        "motor_no": "OLD-MOTOR",
        "chassis_no": "OLD-CHASSIS",
        "make": "KAWASAKI",
        "plate_no": "555-XYZ",
        "route": "BATODA"
    }, headers=headers)
    assert create_res.status_code == 200
    
    # Get created record ID
    get_res = client.get("/franchise/route/BATODA", headers=headers)
    records = get_res.json()
    record_id = records[0]["id"]
    
    # 2. Edit Motor Spec with blank manual dates
    update_payload = {
        "sbn_no": "BAT-001",
        "operator_name": "PEDRO PENDUKO",
        "address": "NAIC, CAVITE",
        "motor_no": "NEW-MOTOR-999", 
        "chassis_no": "OLD-CHASSIS",
        "make": "KAWASAKI",
        "plate_no": "555-XYZ",
        "route": "BATODA",
        "issue_date": "", 
        "valid_until": "" 
    }
    
    update_res = client.put(f"/franchise/{record_id}", json=update_payload, headers=headers)
    assert update_res.status_code == 200
    
    verify_res = client.get("/franchise/route/BATODA", headers=headers)
    updated_rec = verify_res.json()[0]
    assert updated_rec["motor_no"] == "NEW-MOTOR-999"
    assert updated_rec["issue_date"] is not None

def test_delete_single_operator():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    client.post("/franchise/", json={
        "sbn_no": "BAT-002", "operator_name": "MARIA CLARA",
        "address": "CAVITE", "motor_no": "M1", "chassis_no": "C1",
        "make": "YAMAHA", "plate_no": "111-AAA", "route": "BATODA"
    }, headers=headers)
    
    del_res = client.delete("/api/operators/BAT-002", headers=headers)
    assert del_res.status_code == 200
    
    get_res = client.get("/franchise/route/BATODA", headers=headers)
    assert len(get_res.json()) == 0

# --- 4. GLOBAL STATS & ADMIN TESTS ---
def test_global_stats():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    response = client.get("/stats/global", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "total_system_capacity" in data
    assert "route_breakdown" in data

def test_refresh_db_healing():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    response = client.post("/admin/refresh-db", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "success"