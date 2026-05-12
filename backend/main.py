import multiprocessing
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from database import SessionLocal, User, FranchiseRecord, AuditLog, SystemSettings, get_pht_now, BASE_DIR
from ml_engine import train_and_predict
from doc_generator import generate_certificate
from extractor import extract_docx_data
from sync_engine import start_lan_sync, get_local_ip, PEERS
from passlib.context import CryptContext
from pydantic import BaseModel
from datetime import datetime, timedelta
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
import os
import pandas as pd
import io
import zipfile
import shutil
from typing import List, Optional
from fastapi.responses import FileResponse
import starlette.formparsers

starlette.formparsers.MultiPartParser.max_files = 10000
starlette.formparsers.MultiPartParser.max_fields = 10000

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"]
)

start_lan_sync()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_settings(db: Session):
    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings()
        db.add(settings)
        db.commit()
    return settings

class FranchiseCreate(BaseModel):
    sbn_no: str
    operator_name: str
    address: str
    motor_no: str
    chassis_no: str
    make: str
    plate_no: str
    route: str
    driving_route: str = ""

class UserCreate(BaseModel):
    first_name: str
    last_name: str
    username: str
    password: str
    role: str

class SettingsUpdate(BaseModel):
    committee_chair: str
    enable_esignature: bool

class PasswordUpdate(BaseModel):
    old_password: str
    new_password: str

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == token).first()
    if not user: raise HTTPException(status_code=401)
    return user

def log_action(db: Session, clerk_name: str, action: str, target_id: str, target_route: str, details: str):
    new_log = AuditLog(clerk_name=clerk_name, action=action, target_id=str(target_id), target_route=target_route, details=details)
    db.add(new_log)
    db.commit()

def determine_status(issue_date):
    if not issue_date: return True
    current_year = get_pht_now().year
    return False if issue_date.year <= current_year - 2 else True

def sanitize_plate(plate: str, chassis: str, motor: str) -> str:
    p, c, m = str(plate).strip().upper(), str(chassis).strip().upper(), str(motor).strip().upper()
    invalid_markers = ["NAN", "NONE", "N/A", "NO PLATE", "TBA", "FOR REG", "NEW", "UNREGISTERED", "CHASSIS", "MOTOR"]
    if not p or any(marker in p for marker in invalid_markers):
        return ""
    if p == c or p == m:
        return ""
    return p

@app.post("/signup")
def signup(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username taken")
    new_user = User(first_name=user.first_name, last_name=user.last_name, username=user.username, password_hash=pwd_context.hash(user.password), role=user.role)
    db.add(new_user)
    db.commit()
    log_action(db, f"{user.first_name} {user.last_name}", "USER_REGISTRATION", "0", "SYSTEM", "Registered new account")
    return {"message": "Account created"}

@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not pwd_context.verify(form_data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect credentials")
    full_name = f"{user.first_name} {user.last_name}"
    log_action(db, full_name, "LOGIN", "0", "SYSTEM", "Successful authentication")
    return {"access_token": user.username, "token_type": "bearer", "full_name": full_name, "role": user.role}

@app.put("/users/password")
def update_password(payload: PasswordUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not pwd_context.verify(payload.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid current password")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    
    current_user.password_hash = pwd_context.hash(payload.new_password)
    db.commit()
    log_action(db, f"{current_user.first_name} {current_user.last_name}", "UPDATE_SECURITY", "0", "SYSTEM", "Updated account password")
    return {"status": "success"}

@app.get("/settings")
def get_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return init_settings(db)

@app.put("/settings")
def update_settings(settings: SettingsUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sys_settings = init_settings(db)
    sys_settings.committee_chair = settings.committee_chair
    sys_settings.enable_esignature = settings.enable_esignature
    db.commit()
    log_action(db, f"{current_user.first_name} {current_user.last_name}", "UPDATE_SETTINGS", "0", "SYSTEM", "Updated Global Committee Settings")
    return {"status": "success"}

@app.post("/settings/signature")
async def upload_signature(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sig_path = os.path.join(BASE_DIR, "signature.png")
    with open(sig_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    log_action(db, f"{current_user.first_name} {current_user.last_name}", "UPDATE_SIGNATURE", "0", "SYSTEM", "Uploaded new E-Signature")
    return {"status": "success"}

@app.get("/system/network")
def get_network_status():
    return {"local_ip": get_local_ip(), "connected_peers": list(PEERS)}

@app.get("/api/sync/pull")
def sync_pull(since: str, db: Session = Depends(get_db)):
    target_time = datetime.fromisoformat(since)
    records = db.query(FranchiseRecord).filter(FranchiseRecord.updated_at > target_time).all()
    return records

@app.get("/export/mass")
def mass_export(route: str = "ALL", year: str = "ALL", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(FranchiseRecord)
    if route != "ALL": query = query.filter(FranchiseRecord.route == route.upper())
    if year != "ALL": query = query.filter(extract('year', FranchiseRecord.issue_date) == int(year))
    
    records = query.all()
    if not records: raise HTTPException(status_code=404, detail="No records found")

    export_dir = os.path.join(BASE_DIR, f"Export_{get_pht_now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(export_dir, exist_ok=True)
    
    csv_data = []
    settings = init_settings(db)
    
    for r in records:
        csv_data.append({
            "SBN_NO": r.sbn_no, "OPERATOR_NAME": r.operator_name, "ADDRESS": r.address,
            "PLATE_NO": r.plate_no, "MOTOR_NO": r.motor_no, "CHASSIS_NO": r.chassis_no,
            "MAKE": r.make, "ROUTE": r.route, "ISSUE_DATE": r.issue_date.strftime('%Y-%m-%d') if r.issue_date else ""
        })
        try:
            generate_certificate({
                "sbn_no": r.sbn_no, "operator_name": r.operator_name, "address": r.address,
                "motor_no": r.motor_no, "chassis_no": r.chassis_no, "make": r.make,
                "plate_no": r.plate_no, "route": r.route, "driving_route": r.driving_route,
                "issue_date": r.issue_date, "valid_until": r.valid_until
            }, {"committee_chair": settings.committee_chair, "enable_esignature": settings.enable_esignature}, output_dir=export_dir)
        except Exception:
            continue

    pd.DataFrame(csv_data).to_csv(os.path.join(export_dir, "Registry_Index.csv"), index=False)
    
    zip_path = os.path.join(BASE_DIR, f"PASADA_Export_{route}_{year}.zip")
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(export_dir):
            for file in files:
                zipf.write(os.path.join(root, file), file)
                
    shutil.rmtree(export_dir)
    log_action(db, f"{current_user.first_name} {current_user.last_name}", "MASS_EXPORT", "0", route, f"Exported {len(records)} records")
    return FileResponse(path=zip_path, filename=os.path.basename(zip_path), media_type="application/zip")

@app.post("/franchise/")
def create_franchise(record: FranchiseCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    full_name = f"{current_user.first_name} {current_user.last_name}"
    current_time = get_pht_now()
    sbn_parts = record.sbn_no.split('-')
    if len(sbn_parts) == 3:
        record.sbn_no = f"{sbn_parts[0]}-{sbn_parts[1]}-{str(current_time.year)[-2:]}"

    record.plate_no = sanitize_plate(record.plate_no, record.chassis_no, record.motor_no)

    new_record = FranchiseRecord(
        **record.dict(), processed_by=full_name, issue_date=current_time,
        valid_until=datetime(current_time.year, 12, 31), is_active=True
    )
    db.add(new_record)
    db.commit()
    db.refresh(new_record)
    log_action(db, full_name, "CREATE_RECORD", new_record.id, new_record.route, f"Processed Initial MTOP for {record.operator_name}")
    return {"status": "success"}

@app.put("/franchise/{record_id}")
def update_franchise(record_id: str, record: FranchiseCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_record = db.query(FranchiseRecord).filter(FranchiseRecord.id == record_id).first()
    if not db_record: raise HTTPException(status_code=404)
    
    old_sbn = db_record.sbn_no
    new_sbn = record.sbn_no
    is_renewal = False

    record.plate_no = sanitize_plate(record.plate_no, record.chassis_no, record.motor_no)

    for key, value in record.dict().items():
        setattr(db_record, key, value)
    
    if old_sbn != new_sbn:
        sbn_parts = new_sbn.split('-')
        if len(sbn_parts) >= 3 and sbn_parts[-1].isdigit():
            new_year = 2000 + int(sbn_parts[-1])
            db_record.issue_date = get_pht_now()
            db_record.valid_until = datetime(new_year, 12, 31)
            db_record.is_active = True
            is_renewal = True

    db.commit()
    full_name = f"{current_user.first_name} {current_user.last_name}"
    if is_renewal:
        log_action(db, full_name, "RENEWAL", db_record.id, db_record.route, f"Renewed SBN to {new_sbn}. Extended to Dec 31, {new_year}")
    else:
        log_action(db, full_name, "EDIT_RECORD", db_record.id, db_record.route, f"Updated details for {db_record.operator_name}")
    return {"status": "success"}

@app.post("/upload/bulk/{route_name}")
async def upload_bulk_files(route_name: str, files: List[UploadFile] = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    full_name = f"{current_user.first_name} {current_user.last_name}"
    imported_count = 0
    current_time = get_pht_now()

    existing_records = db.query(FranchiseRecord.operator_name, FranchiseRecord.chassis_no).filter(FranchiseRecord.route == route_name.upper()).all()
    existing_set = {f"{str(r[0]).strip().upper()}_{str(r[1]).strip().upper()}" for r in existing_records}

    for file in files:
        contents = await file.read()
        try:
            if file.filename.endswith(".xlsx") or file.filename.endswith(".csv"):
                pass 
            elif file.filename.endswith(".docx"):
                extracted = extract_docx_data(contents, route_name.upper(), current_time.year)
                dedup_key = f"{extracted['operator_name']}_{extracted['chassis_no']}"
                if dedup_key in existing_set:
                    continue

                clean_plate = sanitize_plate(extracted['plate_no'], extracted['chassis_no'], extracted['motor_no'])
                issue_date = extracted['issue_date'] or datetime(current_time.year, 1, 1)

                record = FranchiseRecord(
                    sbn_no=extracted['sbn_no'],
                    operator_name=extracted['operator_name'],
                    address=extracted['address'],
                    motor_no=extracted['motor_no'],
                    plate_no=clean_plate,
                    chassis_no=extracted['chassis_no'],
                    make=extracted['make'],
                    route=route_name.upper(),
                    driving_route=extracted['driving_route'],
                    issue_date=issue_date,
                    valid_until=datetime(issue_date.year, 12, 31),
                    processed_by=full_name,
                    is_active=determine_status(issue_date)
                )
                db.add(record)
                existing_set.add(dedup_key)
                imported_count += 1
        except Exception:
            continue

    db.commit()
    log_action(db, "SYSTEM_MIGRATION", "IMPORT", "0", route_name.upper(), f"Imported {imported_count} unique historical records.")
    return {"imported": imported_count}

@app.post("/franchise/generate/{record_id}")
def generate_doc(record_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    record = db.query(FranchiseRecord).filter(FranchiseRecord.id == record_id).first()
    if not record: raise HTTPException(status_code=404)
    
    settings = init_settings(db)
    
    doc_path, media_type = generate_certificate({
        "sbn_no": record.sbn_no, "operator_name": record.operator_name,
        "address": record.address, "motor_no": record.motor_no,
        "chassis_no": record.chassis_no, "make": record.make,
        "plate_no": record.plate_no, "route": record.route,
        "driving_route": record.driving_route,
        "issue_date": record.issue_date, "valid_until": record.valid_until
    }, {"committee_chair": settings.committee_chair, "enable_esignature": settings.enable_esignature})
    
    if os.path.exists(doc_path):
        log_action(db, f"{current_user.first_name} {current_user.last_name}", "PRINT_MTOP", record.id, record.route, f"Generated MTOP Document")
        return FileResponse(path=doc_path, filename=os.path.basename(doc_path), media_type=media_type)
    raise HTTPException(status_code=500)

@app.get("/logs/record/{record_id}")
def get_record_history(record_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(AuditLog).filter(AuditLog.target_id == record_id).order_by(AuditLog.timestamp.desc()).all()

@app.get("/logs")
def get_audit_logs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(200).all()

@app.get("/franchise/route/{route_name}")
def get_route_records(route_name: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(FranchiseRecord).filter(FranchiseRecord.route == route_name).all()

@app.get("/franchise/status/inactive")
def get_inactive_records(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(FranchiseRecord).filter(FranchiseRecord.is_active == False).all()

@app.get("/predict/{route}")
def get_prediction(route: str, db: Session = Depends(get_db)):
    return train_and_predict(db, route)

@app.get("/stats/global")
def get_global_stats(db: Session = Depends(get_db)):
    current_time = get_pht_now()
    current_year = current_time.year
    current_month = current_time.month
    today_str = current_time.strftime('%Y-%m-%d')
    start_of_week = (current_time - timedelta(days=current_time.weekday())).strftime('%Y-%m-%d')
    
    total_system_capacity = db.query(func.count(FranchiseRecord.id)).scalar()
    vacant_slots = db.query(func.count(FranchiseRecord.id)).filter(FranchiseRecord.is_active == False).scalar()
    
    daily_apps = db.query(func.count(FranchiseRecord.id)).filter(func.strftime('%Y-%m-%d', FranchiseRecord.issue_date) == today_str).scalar()
    weekly_apps = db.query(func.count(FranchiseRecord.id)).filter(func.strftime('%Y-%m-%d', FranchiseRecord.issue_date) >= start_of_week).scalar()
    monthly_apps = db.query(func.count(FranchiseRecord.id)).filter(extract('year', FranchiseRecord.issue_date) == current_year, extract('month', FranchiseRecord.issue_date) == current_month).scalar()
    yearly_apps = db.query(func.count(FranchiseRecord.id)).filter(extract('year', FranchiseRecord.issue_date) == current_year).scalar()
    flagged_pending = db.query(func.count(FranchiseRecord.id)).filter(extract('year', FranchiseRecord.issue_date) == current_year - 1).scalar()

    routes = db.query(FranchiseRecord.route, func.count(FranchiseRecord.id)).filter(FranchiseRecord.is_active == True).group_by(FranchiseRecord.route).all()
    route_data = [{"route": r[0], "count": r[1]} for r in routes]

    daily_trend = []
    for i in range(6, -1, -1):
        target_date = (current_time - timedelta(days=i)).strftime('%Y-%m-%d')
        count = db.query(func.count(FranchiseRecord.id)).filter(func.strftime('%Y-%m-%d', FranchiseRecord.issue_date) == target_date).scalar()
        daily_trend.append({"name": target_date[-5:], "val": count})
        
    monthly_trend = []
    for i in range(5, -1, -1):
        target_month = current_month - i
        target_year = current_year
        if target_month <= 0:
            target_month += 12
            target_year -= 1
        count = db.query(func.count(FranchiseRecord.id)).filter(extract('year', FranchiseRecord.issue_date) == target_year, extract('month', FranchiseRecord.issue_date) == target_month).scalar()
        monthly_trend.append({"name": str(target_month), "val": count})

    return {
        "total_system_capacity": total_system_capacity,
        "vacant_slots": vacant_slots,
        "daily_apps": daily_apps, "weekly_apps": weekly_apps, "monthly_apps": monthly_apps, "yearly_apps": yearly_apps,
        "flagged_pending": flagged_pending, "revoked": vacant_slots, 
        "route_breakdown": route_data,
        "daily_trend": daily_trend,
        "monthly_trend": monthly_trend
    }

if __name__ == "__main__":
    multiprocessing.freeze_support()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")