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
    # May nakalagay na bilang ng natitirang attempts bago mag-lock
    assert "Incorrect credentials" in response.json()["detail"]

def test_login_rate_limit_and_lockout():
    """5 sunod-sunod na maling password = naka-lock ang account sa 15 minuto.
    Habang naka-lock, 429 ang sagot kahit TAMANG password pa ang ibigay.
    """
    from main import _login_attempts, _login_lock, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_SECONDS

    assert LOGIN_MAX_ATTEMPTS == 5
    assert LOGIN_LOCKOUT_SECONDS == 15 * 60

    victim = "TEST ADMIN"
    # Linisin ang shared counter bago magsimula (gagamitin din ito ng ibang tests)
    with _login_lock:
        _login_attempts.pop(victim, None)

    # 1. Bago umabot sa limit: 400 pa rin ang maling password, may remaining count
    for i in range(LOGIN_MAX_ATTEMPTS - 1):
        r = client.post("/token", json={"username": victim, "password": "wrongpass"})
        assert r.status_code == 400, f"Attempt {i + 1} should still be 400"
        assert str(LOGIN_MAX_ATTEMPTS - (i + 1)) in r.json()["detail"]

    # 2. Ika-5 maling attempt: nag-lock na (429)
    r = client.post("/token", json={"username": victim, "password": "wrongpass"})
    assert r.status_code == 429
    assert "locked" in r.json()["detail"].lower()

    # 3. Kahit TAMANG password, 429 pa rin habang may lock — hindi dapat kayang
    #    lampasan ng brute-force ang lock sa pamamagitan ng paghula ng password.
    r = client.post("/token", json={"username": victim, "password": "password123"})
    assert r.status_code == 429

    # 4. May audit log na nagtatala ng lock event
    db = TestingSessionLocal()
    lock_logs = db.query(AuditLog).filter(AuditLog.action == "LOGIN_LOCKED").all()
    db.close()
    assert len(lock_logs) >= 1
    assert lock_logs[-1].clerk_name == victim

    # Iwanan sa malinis na state ang shared counter para sa susunod na tests
    with _login_lock:
        _login_attempts.pop(victim, None)

def test_login_success_resets_failure_counter():
    """Ang maling attempt na sinusundan ng TAMANG login ay hindi dapat umipon.
    Dapat makaka-login pa rin ang user pagkatapos ng ilang (mali tapos tama)."""
    from main import _login_attempts, _login_lock

    victim = "TEST ADMIN"
    with _login_lock:
        _login_attempts.pop(victim, None)

    # Mali, tapos tama, paulit-ulit — hindi dapat umabot sa lock
    for _ in range(7):
        client.post("/token", json={"username": victim, "password": "wrongpass"})
        r = client.post("/token", json={"username": victim, "password": "password123"})
        assert r.status_code == 200

    # Walang natirang failure count
    with _login_lock:
        assert victim not in _login_attempts

    with _login_lock:
        _login_attempts.pop(victim, None)

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
    # NOTE: hindi na tito naka-assume na empty ang route kasi may ibang test
    # sa module na nag-iwan ng record (BAT-001). Basta siguraduhin lang natin
    # na wala na yung BAT-002 pagkatapos ng delete.
    remaining_sbns = [r["sbn_no"] for r in get_res.json()]
    assert all(not s.startswith("BAT-002") for s in remaining_sbns)

def test_delete_by_base_sbn_with_year_suffix():
    """Dati 404 kapag hinanap mo yung BAT-002 pero naka-store as BAT-002-26.
    Dapat mahahanap pa rin yung year-suffixed version.
    """
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    client.post("/franchise/", json={
        "sbn_no": "BAT-005", "operator_name": "JUAN TAMA",
        "address": "BANCAAN", "motor_no": "M5", "chassis_no": "C5",
        "make": "HONDA", "plate_no": "555-AAA", "route": "BATODA"
    }, headers=headers)
    
    # i-delete using yung base SBN lang (walang year suffix)
    del_res = client.delete("/api/operators/BAT-005", headers=headers)
    assert del_res.status_code == 200
    
    remaining = client.get("/franchise/route/BATODA", headers=headers).json()
    assert all(not r["sbn_no"].startswith("BAT-005") for r in remaining)

def test_edit_name_is_not_change_motor():
    """Yung client complaint: pag nag-edit lang ng pangalan (o plate/route),
    hindi dapat ma-count as change motor at hindi dapat magbago yung Date Issued.
    """
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    create_res = client.post("/franchise/", json={
        "sbn_no": "CM-001", "operator_name": "PEDRO ORIGINAL",
        "address": "PAL.CENTRAL", "motor_no": "CM-MTR-1", "chassis_no": "CM-CHS-1",
        "make": "HONDA", "plate_no": "CM-111", "route": "CNTODA",
        "issue_date": "2026-03-15", "valid_until": "2026-12-31"
    }, headers=headers)
    assert create_res.status_code == 200
    
    records = client.get("/franchise/route/CNTODA", headers=headers).json()
    target = next(r for r in records if r["sbn_no"].startswith("CM-001"))
    original_issue = target["issue_date"]
    
    # edit name lang, walang galaw sa motor specs
    edit_res = client.put(f"/franchise/{target['id']}", json={
        "sbn_no": target["sbn_no"], "operator_name": "PEDRO BINAGO ANG PANGALAN",
        "address": "PALANGUE CENTRAL", "motor_no": "CM-MTR-1", "chassis_no": "CM-CHS-1",
        "make": "HONDA", "plate_no": "CM-111", "route": "CNTODA",
        "issue_date": "", "valid_until": ""
    }, headers=headers)
    assert edit_res.status_code == 200
    
    # dapat hindi na-touch yung date issued
    assert edit_res.json()["issue_date"] == original_issue
    
    # at walang CHANGE_MOTOR na nailagay sa logs para sa record na to
    logs_res = client.get(f"/logs/record/{target['id']}", headers=headers)
    actions = [log["action"] for log in logs_res.json()]
    assert "CHANGE_MOTOR" not in actions

def test_real_change_motor_updates_date():
    """Pag motor spec talaga ang pinagbago, saka lang dapat mag-inject ng bagong date.
    """
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    client.post("/franchise/", json={
        "sbn_no": "CM-002", "operator_name": "MARIA MOTOR",
        "address": "TIM.BALSAHAN", "motor_no": "CM-MTR-2", "chassis_no": "CM-CHS-2",
        "make": "YAMAHA", "plate_no": "CM-222", "route": "CNTODA",
        "issue_date": "2025-03-15", "valid_until": "2025-12-31"
    }, headers=headers)
    
    records = client.get("/franchise/route/CNTODA", headers=headers).json()
    target = next(r for r in records if r["sbn_no"].startswith("CM-002"))
    
    # palitan yung motor number - dapat mag-inject ng date today
    edit_res = client.put(f"/franchise/{target['id']}", json={
        "sbn_no": target["sbn_no"], "operator_name": "MARIA MOTOR",
        "address": "TIMALAN BALSAHAN", "motor_no": "CM-MTR-NEW", "chassis_no": "CM-CHS-2",
        "make": "YAMAHA", "plate_no": "CM-222", "route": "CNTODA",
        "issue_date": "", "valid_until": ""
    }, headers=headers)
    assert edit_res.status_code == 200
    
    returned_issue = edit_res.json()["issue_date"]
    assert returned_issue is not None
    # dapat today na yung date, hindi na yung 2025
    assert returned_issue.startswith(str(datetime.now().year))
    
    # may CHANGE_MOTOR na log entry na dapat
    logs_res = client.get(f"/logs/record/{target['id']}", headers=headers)
    actions = [log["action"] for log in logs_res.json()]
    assert "CHANGE_MOTOR" in actions

def test_suffix_drift_edit_is_not_renewal():
    """Yung huling client complaint: kahit anong edit (pangalan lang hal.),
    nagiging RENEWAL daw at nagbabago ang date. Nangyayari yun kapag iba ang
    stored SBN suffix sa display (hal. backdated record: stored 'RD-001-26'
    pero dahil 2025 na ang issue date, 'RD-001-25' ang nakikita ng user sa
    listahan/modal). Dapat walang RENEWAL, walang CHANGE_MOTOR, at manatili
    yung original na dates kapag ganito ang scenario.
    """
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}

    create_res = client.post("/franchise/", json={
        "sbn_no": "RD-001", "operator_name": "RENZO DRIFT",
        "address": "BANCAAN", "motor_no": "RD-M1", "chassis_no": "RD-C1",
        "make": "HONDA", "plate_no": "RD-111", "route": "BATODA",
        "issue_date": "2026-03-15", "valid_until": "2026-12-31"
    }, headers=headers)
    assert create_res.status_code == 200
    stored_sbn = create_res.json()["sbn_no"]
    assert stored_sbn == "RD-001-26"

    # I-backdate natin direkt sa DB (gaya ng nangyayari sa restore/backdate
    # na flow) para magkaiba ang stored suffix sa display suffix.
    db = TestingSessionLocal()
    rec = db.query(FranchiseRecord).filter(FranchiseRecord.sbn_no == "RD-001-26").first()
    assert rec is not None
    rec.issue_date = datetime(2025, 3, 15)
    rec.valid_until = datetime(2025, 12, 31)
    db.commit()
    db.close()

    records = client.get("/franchise/route/BATODA", headers=headers).json()
    target = next(r for r in records if r["sbn_no"].startswith("RD-001"))
    # display dapat 'RD-001-25' ngayon (issue-year based), iba sa stored 'RD-001-26'
    assert target["sbn_no"] == "RD-001-25"

    # edit NAME lang, sabit sa payload yung display SBN — eksakto gaya ng
    # ginagawa ng modal (sbn_no at original_sbn_no na pareho ang laman)
    edit_res = client.put(f"/franchise/{target['id']}", json={
        "sbn_no": "RD-001-25", "original_sbn_no": "RD-001-25",
        "operator_name": "RENZO DRIFT JR",
        "address": "BANCAAN", "motor_no": "RD-M1", "chassis_no": "RD-C1",
        "make": "HONDA", "plate_no": "RD-111", "route": "BATODA",
        "issue_date": "", "valid_until": ""
    }, headers=headers)
    assert edit_res.status_code == 200

    # dates dapat preserved, hindi napalitan ng date-today
    body = edit_res.json()
    assert body["issue_date"].startswith("2025-03-15")
    assert body["valid_until"].startswith("2025-12-31")

    logs_res = client.get(f"/logs/record/{target['id']}", headers=headers)
    actions = [log["action"] for log in logs_res.json()]
    assert "RENEWAL" not in actions
    assert "CHANGE_MOTOR" not in actions
    assert "EDIT_RECORD" in actions

def test_genuine_sbn_edit_still_triggers_renewal():
    """Kabalikan ng test sa taas: kung TALAGANG binago ng user ang SBN sa modal
    (hal. BA-001-25 -> BA-0010-26), dapat mag-fire pa rin ang renewal branch at
    ma-inject yung date today. Hindi dapat nasira ng suffix-drift fix yung totoong
    renewal flow.
    """
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}

    client.post("/franchise/", json={
        "sbn_no": "RD-002", "operator_name": "RODANTE GENUINE",
        "address": "BANCAAN", "motor_no": "RD-M2", "chassis_no": "RD-C2",
        "make": "HONDA", "plate_no": "RD-222", "route": "BATODA",
        "issue_date": "2025-03-15", "valid_until": "2025-12-31"
    }, headers=headers)

    records = client.get("/franchise/route/BATODA", headers=headers).json()
    target = next(r for r in records if r["sbn_no"].startswith("RD-002"))

    # binago talaga ang SBN sa modal (renewal), walang manual dates
    edit_res = client.put(f"/franchise/{target['id']}", json={
        "sbn_no": "RD-003-26", "original_sbn_no": target["sbn_no"],
        "operator_name": "RODANTE GENUINE",
        "address": "BANCAAN", "motor_no": "RD-M2", "chassis_no": "RD-C2",
        "make": "HONDA", "plate_no": "RD-222", "route": "BATODA",
        "issue_date": "", "valid_until": ""
    }, headers=headers)
    assert edit_res.status_code == 200

    body = edit_res.json()
    assert body["issue_date"] is not None
    assert body["issue_date"].startswith(str(datetime.now().year))

    logs_res = client.get(f"/logs/record/{body.get('id', target['id'])}", headers=headers)
    actions = [log["action"] for log in logs_res.json()]
    assert "RENEWAL" in actions

def test_address_abbreviation_expansion():
    """Yung PAL.CENTRAL / TIM.BALSAHAN na pa-shortcut na address, dapat
    nafa-expand automatically sa full barangay name.
    """
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    create_res = client.post("/franchise/", json={
        "sbn_no": "ADR-001", "operator_name": "ADDRESS TEST",
        "address": "PAL.CENTRAL", "motor_no": "AD-M1", "chassis_no": "AD-C1",
        "make": "HONDA", "plate_no": "AD-111", "route": "PAL1TODA"
    }, headers=headers)
    assert create_res.status_code == 200
    
    records = client.get("/franchise/route/PAL1TODA", headers=headers).json()
    target = next(r for r in records if r["sbn_no"].startswith("ADR-001"))
    assert target["address"] == "PALANGUE CENTRAL"
    
    # pati yung may suffix na, dapat hindi madoble
    create_res2 = client.post("/franchise/", json={
        "sbn_no": "ADR-002", "operator_name": "ADDRESS TEST 2",
        "address": "TIM.BALSAHAN, NAIC, CAVITE", "motor_no": "AD-M2", "chassis_no": "AD-C2",
        "make": "HONDA", "plate_no": "AD-222", "route": "PAL1TODA"
    }, headers=headers)
    assert create_res2.status_code == 200
    
    records2 = client.get("/franchise/route/PAL1TODA", headers=headers).json()
    target2 = next(r for r in records2 if r["sbn_no"].startswith("ADR-002"))
    assert target2["address"] == "TIMALAN BALSAHAN, NAIC, CAVITE"

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