import sys
import os
import traceback
import re
from datetime import datetime
import zipfile
import threading

user_folder = os.path.expanduser('~')
crash_log_path = os.path.join(user_folder, "PASADA_CRASH_LOG.txt")

def force_log(msg):
    try:
        with open(crash_log_path, "a", encoding="utf-8") as f:
            f.write(f"{msg}\n")
    except:
        pass

def exception_hook(exc_type, exc_value, exc_traceback):
    err_msg = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    force_log(f"\n[{datetime.now()}] !!! OS-LEVEL FATAL CRASH !!!\n{err_msg}")
    sys.exit(1)

sys.excepthook = exception_hook

force_log(f"\n[{datetime.now()}] --- BOOTING PASADA BACKEND ---")
force_log(f"Running from: {sys.executable}")

import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()

try:
    force_log("Loading Pandas, FastAPI, and ML libraries...")
    import subprocess
    import time
    import calendar
    import platform
    from datetime import timedelta
    from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
    from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
    from sqlalchemy.orm import Session, sessionmaker
    from sqlalchemy import func, extract, create_engine
    
    from database import SessionLocal, User, FranchiseRecord, AuditLog, SystemSettings, RouteData, get_pht_now, BASE_DIR
    from ml_engine import run_kmeans_clustering
    from doc_generator import generate_certificate
    from extractor import extract_docx_data
    from sync_engine import start_lan_sync, get_local_ip, PEERS
    from passlib.context import CryptContext
    from pydantic import BaseModel
    import uvicorn
    from fastapi.middleware.cors import CORSMiddleware
    import pandas as pd
    import io
    import shutil
    from typing import List, Optional
    from fastapi.responses import FileResponse, Response
    import starlette.formparsers
    from openpyxl.styles import PatternFill, Font, Alignment
    # FIX: Safely import get_column_letter to prevent MergedCell crashes
    from openpyxl.utils import get_column_letter
    
    force_log("All libraries loaded successfully!")

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

    def automated_backup():
        while True:
            now = datetime.now()
            if now.hour == 16 and now.minute == 45:
                backup_dir = os.path.join(BASE_DIR, "backups")
                if not os.path.exists(backup_dir):
                    os.makedirs(backup_dir)
                
                db_path = os.path.join(BASE_DIR, 'pasada_production.db')
                if os.path.exists(db_path):
                    zip_name = os.path.join(backup_dir, f"PASADA_Backup_{now.strftime('%Y-%m-%d')}.zip")
                    try:
                        with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
                            zipf.write(db_path, os.path.basename(db_path))
                        force_log(f"Automated backup secured: {zip_name}")
                    except Exception as e:
                        force_log(f"Backup failed: {e}")
                time.sleep(60)
            else:
                time.sleep(30)

    threading.Thread(target=automated_backup, daemon=True).start()
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
        enable_esignature: Optional[bool] = False 

    class PasswordUpdate(BaseModel):
        new_password: str

    class UsernameUpdate(BaseModel):
        new_username: str

    class RouteDataUpdate(BaseModel):
        population: int
        road_length_km: float

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
        invalid_markers = ["NAN", "NONE", "N/A", "NO PLATE", "TBA", "FOR REG", "NEW", "UNREGISTERED", "CHASSIS", "MOTOR", "UNKNOWN"]
        if not p or any(marker in p for marker in invalid_markers):
            return ""
        if p == c or p == m:
            return ""
        return p

    def clean_dedup_key(text):
        return re.sub(r'\s+', '', str(text).upper())

    def get_fuzzy_col(df_row, df_columns, target):
        for col in df_columns:
            if target in str(col).upper():
                val = df_row.get(col, "")
                return str(val).strip() if pd.notna(val) else ""
        return ""

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
        if len(payload.new_password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        current_user.password_hash = pwd_context.hash(payload.new_password)
        db.commit()
        log_action(db, f"{current_user.first_name} {current_user.last_name}", "UPDATE_SECURITY", "0", "SYSTEM", "Updated account password")
        return {"status": "success"}

    @app.put("/users/username")
    def update_username(payload: UsernameUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        if db.query(User).filter(User.username == payload.new_username.upper()).first():
            raise HTTPException(status_code=400, detail="Username already exists")
        
        old_username = current_user.username
        current_user.username = payload.new_username.upper()
        db.commit()
        
        log_action(db, current_user.first_name + " " + current_user.last_name, "UPDATE_USERNAME", "0", "SYSTEM", f"Changed username from {old_username} to {payload.new_username.upper()}")
        return {"status": "success"}

    @app.get("/settings")
    def get_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return init_settings(db)

    @app.put("/settings")
    def update_settings(settings: SettingsUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        sys_settings = init_settings(db)
        sys_settings.committee_chair = settings.committee_chair
        db.commit()
        log_action(db, f"{current_user.first_name} {current_user.last_name}", "UPDATE_SETTINGS", "0", "SYSTEM", "Updated Global Committee Settings")
        return {"status": "success"}

    @app.post("/route_data/{route_name}")
    def update_route_data(route_name: str, payload: RouteDataUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        route_info = db.query(RouteData).filter(RouteData.route_name == route_name.upper()).first()
        if not route_info:
            route_info = RouteData(route_name=route_name.upper(), population=payload.population, road_length_km=payload.road_length_km)
            db.add(route_info)
        else:
            route_info.population = payload.population
            route_info.road_length_km = payload.road_length_km
        db.commit()
        log_action(db, f"{current_user.first_name} {current_user.last_name}", "UPDATE_ROUTE_DATA", "0", route_name.upper(), f"Updated X2 and X3 factors.")
        return {"status": "success", "message": f"Updated demographic data for {route_name.upper()}"}

    @app.get("/system/network")
    def get_network_status():
        return {"local_ip": get_local_ip(), "connected_peers": list(PEERS)}

    @app.get("/api/sync/pull")
    def sync_pull(since: str, db: Session = Depends(get_db)):
        target_time = datetime.fromisoformat(since)
        records = db.query(FranchiseRecord).filter(FranchiseRecord.updated_at > target_time).all()
        users = db.query(User).all()
        return {
            "records": records,
            "users": users
        }

    @app.post("/franchise/")
    def create_franchise(record: FranchiseCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        saturation_data = run_kmeans_clustering(db, record.route.upper())
        if saturation_data:
            status_text = saturation_data[0]['forecast_period']
            if "RED CLUSTER" in status_text:
                raise HTTPException(
                    status_code=403, 
                    detail=f"Action Denied: {record.route.upper()} has reached algorithmic capacity (Over-saturated). Please freeze new applications."
                )

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

    @app.post("/upload/database")
    async def upload_database_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
        temp_db_path = os.path.join(BASE_DIR, "temp_import.db")
        with open(temp_db_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        try:
            temp_engine = create_engine(f"sqlite:///{temp_db_path}")
            TempSession = sessionmaker(bind=temp_engine)
            temp_db = TempSession()
            imported_records = temp_db.query(FranchiseRecord).all()
            db = SessionLocal()
            existing_chassis = {r.chassis_no for r in db.query(FranchiseRecord.chassis_no).all()}
            new_count = 0
            for r in imported_records:
                if r.chassis_no not in existing_chassis:
                    new_record = FranchiseRecord(
                        id=r.id, sbn_no=r.sbn_no, operator_name=r.operator_name,
                        address=r.address, motor_no=r.motor_no, chassis_no=r.chassis_no,
                        make=r.make, plate_no=r.plate_no, route=r.route,
                        driving_route=r.driving_route, issue_date=r.issue_date,
                        valid_until=r.valid_until, is_active=r.is_active,
                        processed_by=f"{current_user.first_name} {current_user.last_name}", 
                        updated_at=r.updated_at
                    )
                    db.add(new_record)
                    existing_chassis.add(r.chassis_no)
                    new_count += 1
            db.commit()
            temp_db.close()
            os.remove(temp_db_path)
            log_action(db, f"{current_user.first_name} {current_user.last_name}", "DATABASE_MIGRATION", "0", "ALL", f"Merged {new_count} records from .db file.")
            return {"imported": new_count}
        except Exception as e:
            if os.path.exists(temp_db_path): os.remove(temp_db_path)
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/upload/bulk/{route_name}")
    async def upload_bulk_files(route_name: str, files: List[UploadFile] = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        full_name = f"{current_user.first_name} {current_user.last_name}"
        imported_count = 0
        current_time = get_pht_now()

        for file in files:
            contents = await file.read()
            try:
                if file.filename.endswith(".xlsx") or file.filename.endswith(".csv"):
                    if file.filename.endswith(".xlsx"):
                        df = pd.read_excel(io.BytesIO(contents), header=None, engine='openpyxl')
                    else:
                        df = pd.read_csv(io.BytesIO(contents), header=None)
                    
                    header_idx = -1
                    for i, row in df.iterrows():
                        row_vals = [str(x).upper().strip() for x in row.values if pd.notna(x)]
                        if any("NAME" in val for val in row_vals) and any("SBN" in val for val in row_vals):
                            header_idx = i
                            break
                            
                    if header_idx == -1: continue 
                    
                    df.columns = [str(c).strip().upper() for c in df.iloc[header_idx]]
                    df = df.iloc[header_idx+1:].reset_index(drop=True)

                    for _, row in df.iterrows():
                        name = get_fuzzy_col(row, df.columns, "NAME")
                        if not name: continue

                        chassis = get_fuzzy_col(row, df.columns, "CHASSIS")
                        motor = get_fuzzy_col(row, df.columns, "MOTOR")
                        plate = get_fuzzy_col(row, df.columns, "PLATE")
                        address = get_fuzzy_col(row, df.columns, "ADDRESS")
                        
                        raw_date = get_fuzzy_col(row, df.columns, "RENEWAL") or get_fuzzy_col(row, df.columns, "DATE")
                        try:
                            parsed_date = pd.to_datetime(raw_date).to_pydatetime()
                        except:
                            parsed_date = datetime(current_time.year, 1, 1)

                        raw_sbn = get_fuzzy_col(row, df.columns, "SBN")
                        if not raw_sbn:
                            sbn = f"{route_name[:3]}-000-{str(current_time.year)[-2:]}"
                        else:
                            sbn_parts = raw_sbn.split('-')
                            if len(sbn_parts) == 2: sbn = f"{raw_sbn}-{str(parsed_date.year)[-2:]}"
                            else: sbn = raw_sbn

                        clean_plate = sanitize_plate(plate, chassis, motor)

                        existing_record = db.query(FranchiseRecord).filter(
                            func.replace(func.upper(FranchiseRecord.operator_name), ' ', '') == clean_dedup_key(name),
                            func.replace(func.upper(FranchiseRecord.chassis_no), ' ', '') == clean_dedup_key(chassis)
                        ).first()

                        if existing_record:
                            if not existing_record.sbn_no or existing_record.sbn_no == "": existing_record.sbn_no = sbn.upper()
                            if not existing_record.address or existing_record.address == "": existing_record.address = address.upper()
                            if not existing_record.plate_no or existing_record.plate_no == "": existing_record.plate_no = clean_plate.upper()
                            if parsed_date > existing_record.issue_date:
                                existing_record.issue_date = parsed_date
                                existing_record.valid_until = datetime(parsed_date.year, 12, 31)
                                existing_record.is_active = determine_status(parsed_date)
                            imported_count += 1
                        else:
                            record = FranchiseRecord(
                                sbn_no=sbn.upper(), operator_name=name.upper(),
                                address=address.upper(), motor_no=motor.upper(),
                                plate_no=clean_plate.upper(), chassis_no=chassis.upper(),
                                make="", route=route_name.upper(), driving_route="POBLACION", 
                                issue_date=parsed_date, valid_until=datetime(parsed_date.year, 12, 31),
                                processed_by=full_name, is_active=determine_status(parsed_date)
                            )
                            db.add(record)
                            imported_count += 1

                elif file.filename.endswith(".docx"):
                    extracted = extract_docx_data(contents, route_name.upper(), current_time.year)
                    
                    existing_record = db.query(FranchiseRecord).filter(
                        func.replace(func.upper(FranchiseRecord.operator_name), ' ', '') == clean_dedup_key(extracted['operator_name']),
                        func.replace(func.upper(FranchiseRecord.chassis_no), ' ', '') == clean_dedup_key(extracted['chassis_no'])
                    ).first()

                    clean_plate = sanitize_plate(extracted['plate_no'], extracted['chassis_no'], extracted['motor_no'])
                    issue_date = extracted['issue_date'] or datetime(current_time.year, 1, 1)

                    if existing_record:
                        if extracted['make'] and (not existing_record.make or existing_record.make == ""):
                            existing_record.make = extracted['make'].upper()
                        if extracted['address'] and not existing_record.address: existing_record.address = extracted['address'].upper()
                        if clean_plate and not existing_record.plate_no: existing_record.plate_no = clean_plate.upper()
                        imported_count += 1
                    else:
                        record = FranchiseRecord(
                            sbn_no=extracted['sbn_no'], operator_name=extracted['operator_name'],
                            address=extracted['address'], motor_no=extracted['motor_no'],
                            plate_no=clean_plate, chassis_no=extracted['chassis_no'],
                            make=extracted['make'], route=route_name.upper(),
                            driving_route=extracted['driving_route'], issue_date=issue_date,
                            valid_until=datetime(issue_date.year, 12, 31),
                            processed_by=full_name, is_active=determine_status(issue_date)
                        )
                        db.add(record)
                        imported_count += 1
            except Exception as e:
                force_log(f"Import Error: {e}")
                continue

        db.commit()
        log_action(db, "SYSTEM_MIGRATION", "IMPORT", "0", route_name.upper(), f"Imported/Updated {imported_count} records.")
        return {"imported": imported_count}

    @app.post("/franchise/download/word/{record_id}")
    def download_word_doc(record_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
        }, {"committee_chair": settings.committee_chair}, return_format="docx")
        
        if os.path.exists(doc_path):
            log_action(db, f"{current_user.first_name} {current_user.last_name}", "DOWNLOAD_DOCX", record.id, record.route, f"Downloaded raw MTOP Word Document")
            return FileResponse(path=doc_path, filename=os.path.basename(doc_path), media_type=media_type)
            
        raise HTTPException(status_code=500)

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
        }, {"committee_chair": settings.committee_chair}, return_format="pdf")
        
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
        return run_kmeans_clustering(db, route)

    @app.get("/export/masterlist/{route_name}")
    def export_toda_masterlist(route_name: str, status_filter: str = "ALL", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        records_query = db.query(FranchiseRecord).filter(FranchiseRecord.route == route_name.upper()).all()
        
        current_year = get_pht_now().year
        filtered_records = []
        
        for r in records_query:
            issue_year = r.issue_date.year if r.issue_date else 0
            
            if not r.is_active or issue_year <= current_year - 2:
                computed_status = "REVOKED"
            elif issue_year == current_year - 1:
                computed_status = "FLAGGED"
            else:
                computed_status = "ACTIVE"
                
            if status_filter == "ALL" or status_filter == computed_status:
                filtered_records.append(r)

        if not filtered_records:
            raise HTTPException(status_code=404, detail="No records found matching this filter")
            
        csv_data = []
        for r in filtered_records:
            csv_data.append({
                "SBN NO.": r.sbn_no or "",
                "DATE OF RENEWAL": r.issue_date.strftime('%Y-%m-%d') if r.issue_date else "",
                "NAME": r.operator_name or "",
                "MAKE": r.make or "", 
                "MOTOR NO.": r.motor_no or "",
                "CHASSIS NO.": r.chassis_no or "",
                "PLATE NO.": r.plate_no or "",
                "STATUS": "",
            })
            
        df = pd.DataFrame(csv_data)
        output = io.BytesIO()
        
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name="Masterlist", startrow=1)
            ws = writer.sheets['Masterlist']
            
            total_row_count = len(filtered_records) + 2

            ws.merge_cells('A1:B1')
            ws['A1'] = f'=COUNTIF(H3:H{total_row_count}, "ACTIVE")'
            ws['A1'].font = Font(bold=True, size=16)
            ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
            
            for col_num in range(1, 9):
                cell = ws.cell(row=2, column=col_num)
                cell.font = Font(bold=True, size=11)
                cell.alignment = Alignment(horizontal='center', vertical='center')
            
            red_fill = PatternFill(start_color="FFCCCC", end_color="FFCCCC", fill_type="solid")
            yellow_fill = PatternFill(start_color="FFFFCC", end_color="FFFFCC", fill_type="solid")
            
            ws['J2'] = "LEGEND & TALLY"
            ws['J2'].font = Font(bold=True, size=11)
            ws['J2'].alignment = Alignment(horizontal='center', vertical='center')
            ws.merge_cells('J2:K2')
            
            ws['J3'] = "ACTIVE"
            ws['J3'].font = Font(bold=True, size=11)
            ws['K3'] = f'=COUNTIF(H3:H{total_row_count}, "ACTIVE")'
            ws['K3'].font = Font(bold=True, size=11)
            ws['K3'].alignment = Alignment(horizontal='center', vertical='center')

            ws['J4'] = "FLAGGED"
            ws['J4'].font = Font(bold=True, size=11)
            ws['J4'].fill = yellow_fill
            ws['K4'] = f'=COUNTIF(H3:H{total_row_count}, "FLAGGED")'
            ws['K4'].font = Font(bold=True, size=11)
            ws['K4'].fill = yellow_fill
            ws['K4'].alignment = Alignment(horizontal='center', vertical='center')

            ws['J5'] = "VACANT / REVOKED"
            ws['J5'].font = Font(bold=True, size=11)
            ws['J5'].fill = red_fill
            ws['K5'] = f'=COUNTIF(H3:H{total_row_count}, "VACANT / REVOKED")'
            ws['K5'].font = Font(bold=True, size=11)
            ws['K5'].fill = red_fill
            ws['K5'].alignment = Alignment(horizontal='center', vertical='center')

            for row_num, r in enumerate(filtered_records, start=3):
                issue_year = r.issue_date.year if r.issue_date else 0
                
                fill_color = None
                if not r.is_active or issue_year <= current_year - 2:
                    fill_color = red_fill
                    status_text = "VACANT / REVOKED"
                elif issue_year == current_year - 1:
                    fill_color = yellow_fill
                    status_text = "FLAGGED"
                else:
                    fill_color = None 
                    status_text = "ACTIVE"
                
                ws.cell(row=row_num, column=8, value=status_text)
                
                for col_num in range(1, 9):
                    cell = ws.cell(row=row_num, column=col_num)
                    if fill_color:
                        cell.fill = fill_color
                    cell.alignment = Alignment(horizontal='left', vertical='center')
            
            # FIX: Safely calculate max column widths using get_column_letter to avoid MergedCell crash
            for col_idx in range(1, ws.max_column + 1):
                col_letter = get_column_letter(col_idx)
                if col_letter in ['J', 'K']:
                    ws.column_dimensions[col_letter].width = 20
                    continue
                
                max_length = 0
                for row_idx in range(1, ws.max_row + 1):
                    cell_value = ws.cell(row=row_idx, column=col_idx).value
                    if cell_value:
                        length = len(str(cell_value))
                        if length > max_length:
                            max_length = length
                ws.column_dimensions[col_letter].width = max_length + 2

        output.seek(0)
        
        filter_tag = f"_{status_filter}" if status_filter != "ALL" else ""
        log_action(db, f"{current_user.first_name} {current_user.last_name}", "EXPORT_MASTERLIST", "0", route_name.upper(), f"Exported {status_filter} Masterlist for {route_name.upper()}")
        
        headers = {
            'Content-Disposition': f'attachment; filename="{route_name.upper()}_2026{filter_tag}.xlsx"'
        }
        return Response(content=output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)
    
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

        days_map = {'0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat'}
        daily_trend_dict = {d: 0 for d in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
        
        day_records = db.query(func.strftime('%w', FranchiseRecord.issue_date), func.count(FranchiseRecord.id)).group_by(func.strftime('%w', FranchiseRecord.issue_date)).all()
        for day_idx, count in day_records:
            if day_idx and day_idx in days_map:
                daily_trend_dict[days_map[day_idx]] = count
                
        daily_trend = [{"name": k, "val": v} for k, v in daily_trend_dict.items()]
            
        weekly_trend = []
        for i in range(4, -1, -1):
            target_date = current_time - timedelta(days=current_time.weekday() + (i * 7))
            start_str = target_date.strftime('%Y-%m-%d')
            end_str = (target_date + timedelta(days=6)).strftime('%Y-%m-%d')
            count = db.query(func.count(FranchiseRecord.id)).filter(
                func.strftime('%Y-%m-%d', FranchiseRecord.issue_date) >= start_str,
                func.strftime('%Y-%m-%d', FranchiseRecord.issue_date) <= end_str
            ).scalar()
            weekly_trend.append({"name": target_date.strftime('%b %d'), "val": count})

        monthly_trend = []
        for i in range(5, -1, -1):
            target_month = current_month - i
            target_year = current_year
            if target_month <= 0:
                target_month += 12
                target_year -= 1
            month_name = calendar.month_abbr[target_month]
            count = db.query(func.count(FranchiseRecord.id)).filter(extract('year', FranchiseRecord.issue_date) == target_year, extract('month', FranchiseRecord.issue_date) == target_month).scalar()
            monthly_trend.append({"name": month_name, "val": count})

        return {
            "total_system_capacity": total_system_capacity,
            "vacant_slots": vacant_slots,
            "daily_apps": daily_apps, "weekly_apps": weekly_apps, "monthly_apps": monthly_apps, "yearly_apps": yearly_apps,
            "flagged_pending": flagged_pending, "revoked": vacant_slots, 
            "route_breakdown": route_data,
            "daily_trend": daily_trend,
            "weekly_trend": weekly_trend,
            "monthly_trend": monthly_trend
        }

except Exception as e:
    force_log(f"\n[{datetime.now()}] !!! BOOT FATAL ERROR !!!\n{traceback.format_exc()}")
    sys.exit(1)

if __name__ == "__main__":
    multiprocessing.freeze_support()
    
    sys.stdout = open(crash_log_path, "a", encoding="utf-8", buffering=1)
    sys.stderr = sys.stdout

    try:
        force_log("Scanning for zombie processes on Port 43888...")
        if os.name == 'nt':
            result = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, shell=True)
            for line in result.stdout.splitlines():
                if ':43888 ' in line and 'LISTENING' in line:
                    parts = line.split()
                    pid = parts[-1]
                    force_log(f"CRITICAL: Found ghost process (PID: {pid}). Nuking it...")
                    subprocess.run(['taskkill', '/F', '/T', '/PID', pid], capture_output=True, shell=True)
                    time.sleep(2)  
                    break
        force_log("Port 43888 is clear. Starting Uvicorn server...")
        
        uvicorn.run(app, host="0.0.0.0", port=43888, log_config=None)
        
    except Exception as e:
        force_log(f"\n[{datetime.now()}] !!! SERVER EXECUTION FATAL ERROR !!!\n{traceback.format_exc()}")
        sys.exit(1)