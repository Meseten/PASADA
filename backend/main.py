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
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment
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

    # Improved robust dictionary extraction for importing
    def get_fuzzy_col_dict(row_dict, target):
        for col, val in row_dict.items():
            if target in str(col).upper():
                if val is None or str(val).lower() in ["nan", "none", "nat"]:
                    return ""
                return str(val).strip()
        return ""

    # RULE 1 & 2: STRICT BASE SBN EXTRACTION (Strips -YY or -YYYY year suffixes cleanly)
    def get_base_sbn(sbn):
        sbn = str(sbn).strip().upper()
        match = re.match(r'^(.*?\d+)[\-\_](\d{2}|\d{4})$', sbn)
        if match:
            return match.group(1)
        return sbn

    # RULE 3: STRICT SBN INTEGER EXTRACTION FOR NUMERICAL SORTING (Lowest to Highest)
    def extract_sbn_integer(sbn):
        sbn = str(sbn).strip().upper()
        match = re.search(r'\d+', sbn)
        if match:
            return int(match.group())
        return None 
        
    def get_sbn_sort_key(record):
        val = extract_sbn_integer(record.sbn_no)
        return val if val is not None else 999999

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
        record.sbn_no = get_base_sbn(record.sbn_no)
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
        new_sbn = get_base_sbn(record.sbn_no)
        is_renewal = False
        record.plate_no = sanitize_plate(record.plate_no, record.chassis_no, record.motor_no)
        record.sbn_no = new_sbn

        for key, value in record.dict().items():
            setattr(db_record, key, value)
        
        if old_sbn != new_sbn:
            new_year = get_pht_now().year
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
                        id=r.id, sbn_no=get_base_sbn(r.sbn_no), operator_name=r.operator_name,
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
        
        # Pre-fetch existing route records to deduplicate strictly by Base SBN in memory
        existing_route_records = db.query(FranchiseRecord).filter(FranchiseRecord.route == route_name.upper()).all()

        for file in files:
            contents = await file.read()
            try:
                # RULE 1: PERFECT ROW-BY-ROW EXTRACTION USING OPENPYXL
                if file.filename.endswith(".xlsx"):
                    wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
                    sheet = wb.active
                    
                    header_idx = -1
                    headers = []
                    for r_idx in range(1, min(20, sheet.max_row + 1)):
                        row_vals = [str(sheet.cell(row=r_idx, column=c).value).strip().upper() for c in range(1, sheet.max_column + 1) if sheet.cell(row=r_idx, column=c).value is not None]
                        if any("NAME" in val for val in row_vals) and any("SBN" in val for val in row_vals):
                            header_idx = r_idx
                            headers = [str(sheet.cell(row=r_idx, column=c).value).strip().upper() if sheet.cell(row=r_idx, column=c).value is not None else f"COL_{c}" for c in range(1, sheet.max_column + 1)]
                            break
                            
                    if header_idx == -1: continue 

                    # Iterating down to max_row to guarantee zero missing vacant lines
                    for r_idx in range(header_idx + 1, sheet.max_row + 1):
                        row_dict = {}
                        for c_idx in range(1, sheet.max_column + 1):
                            val = sheet.cell(row=r_idx, column=c_idx).value
                            row_dict[headers[c_idx - 1]] = val
                            
                        raw_sbn = get_fuzzy_col_dict(row_dict, "SBN")
                        if not raw_sbn: continue 
                            
                        name = get_fuzzy_col_dict(row_dict, "NAME")
                        chassis = get_fuzzy_col_dict(row_dict, "CHASSIS")
                        motor = get_fuzzy_col_dict(row_dict, "MOTOR")
                        plate = get_fuzzy_col_dict(row_dict, "PLATE")
                        address = get_fuzzy_col_dict(row_dict, "ADDRESS")
                        make = get_fuzzy_col_dict(row_dict, "MAKE")

                        raw_date = None
                        for col, val in row_dict.items():
                            if "RENEWAL" in str(col).upper() or "DATE" in str(col).upper():
                                raw_date = val
                                break

                        try:
                            if isinstance(raw_date, datetime):
                                parsed_date = raw_date
                            else:
                                parsed_date = pd.to_datetime(str(raw_date)).to_pydatetime()
                        except:
                            parsed_date = datetime(current_time.year, 1, 1)

                        # RULE 1 & 2: Deduplicate strictly by clean Base SBN (no name matching)
                        incoming_base_sbn = get_base_sbn(raw_sbn)
                        clean_plate = sanitize_plate(plate, chassis, motor)
                        
                        existing_record = None
                        for pr in existing_route_records:
                            if get_base_sbn(pr.sbn_no) == incoming_base_sbn:
                                existing_record = pr
                                break

                        if existing_record:
                            # Year Precedence Rule: Overwrite ONLY if incoming year >= existing record's year
                            if parsed_date.year >= existing_record.issue_date.year:
                                existing_record.sbn_no = incoming_base_sbn
                                existing_record.operator_name = name.upper()
                                existing_record.address = address.upper()
                                existing_record.make = make.upper()
                                existing_record.plate_no = clean_plate.upper()
                                existing_record.chassis_no = chassis.upper()
                                existing_record.motor_no = motor.upper()
                                existing_record.issue_date = parsed_date
                                existing_record.valid_until = datetime(parsed_date.year, 12, 31)
                                existing_record.is_active = determine_status(parsed_date)
                                imported_count += 1
                        else:
                            record = FranchiseRecord(
                                sbn_no=incoming_base_sbn, operator_name=name.upper(),
                                address=address.upper(), motor_no=motor.upper(),
                                plate_no=clean_plate.upper(), chassis_no=chassis.upper(),
                                make=make.upper(), route=route_name.upper(), driving_route="POBLACION", 
                                issue_date=parsed_date, valid_until=datetime(parsed_date.year, 12, 31),
                                processed_by=full_name, is_active=determine_status(parsed_date)
                            )
                            db.add(record)
                            existing_route_records.append(record)
                            imported_count += 1

                elif file.filename.endswith(".csv"):
                    df = pd.read_csv(io.BytesIO(contents), header=None)
                    df.fillna("", inplace=True)
                    
                    header_idx = -1
                    for i, row in df.iterrows():
                        row_vals = [str(x).upper().strip() for x in row.values if str(x).strip()]
                        if any("NAME" in val for val in row_vals) and any("SBN" in val for val in row_vals):
                            header_idx = i
                            break
                            
                    if header_idx == -1: continue 
                    
                    df.columns = [str(c).strip().upper() for c in df.iloc[header_idx]]
                    df = df.iloc[header_idx+1:].reset_index(drop=True)

                    for _, row in df.iterrows():
                        row_dict = row.to_dict()
                        raw_sbn = get_fuzzy_col_dict(row_dict, "SBN")
                        if not raw_sbn: continue
                        
                        name = get_fuzzy_col_dict(row_dict, "NAME")
                        chassis = get_fuzzy_col_dict(row_dict, "CHASSIS")
                        motor = get_fuzzy_col_dict(row_dict, "MOTOR")
                        plate = get_fuzzy_col_dict(row_dict, "PLATE")
                        address = get_fuzzy_col_dict(row_dict, "ADDRESS")
                        make = get_fuzzy_col_dict(row_dict, "MAKE")

                        raw_date = None
                        for col, val in row_dict.items():
                            if "RENEWAL" in str(col).upper() or "DATE" in str(col).upper():
                                raw_date = val
                                break

                        try:
                            parsed_date = pd.to_datetime(str(raw_date)).to_pydatetime()
                        except:
                            parsed_date = datetime(current_time.year, 1, 1)

                        incoming_base_sbn = get_base_sbn(raw_sbn)
                        clean_plate = sanitize_plate(plate, chassis, motor)
                        
                        existing_record = None
                        for pr in existing_route_records:
                            if get_base_sbn(pr.sbn_no) == incoming_base_sbn:
                                existing_record = pr
                                break

                        if existing_record:
                            if parsed_date.year >= existing_record.issue_date.year:
                                existing_record.sbn_no = incoming_base_sbn
                                existing_record.operator_name = name.upper()
                                existing_record.address = address.upper()
                                existing_record.make = make.upper()
                                existing_record.plate_no = clean_plate.upper()
                                existing_record.chassis_no = chassis.upper()
                                existing_record.motor_no = motor.upper()
                                existing_record.issue_date = parsed_date
                                existing_record.valid_until = datetime(parsed_date.year, 12, 31)
                                existing_record.is_active = determine_status(parsed_date)
                                imported_count += 1
                        else:
                            record = FranchiseRecord(
                                sbn_no=incoming_base_sbn, operator_name=name.upper(),
                                address=address.upper(), motor_no=motor.upper(),
                                plate_no=clean_plate.upper(), chassis_no=chassis.upper(),
                                make=make.upper(), route=route_name.upper(), driving_route="POBLACION", 
                                issue_date=parsed_date, valid_until=datetime(parsed_date.year, 12, 31),
                                processed_by=full_name, is_active=determine_status(parsed_date)
                            )
                            db.add(record)
                            existing_route_records.append(record)
                            imported_count += 1

                elif file.filename.endswith(".docx"):
                    extracted = extract_docx_data(contents, route_name.upper(), current_time.year)
                    issue_date = extracted['issue_date'] or datetime(current_time.year, 1, 1)
                    clean_plate = sanitize_plate(extracted['plate_no'], extracted['chassis_no'], extracted['motor_no'])
                    incoming_base_sbn = get_base_sbn(extracted['sbn_no'])
                    
                    existing_record = None
                    for pr in existing_route_records:
                        if get_base_sbn(pr.sbn_no) == incoming_base_sbn:
                            existing_record = pr
                            break

                    if existing_record:
                        if issue_date.year >= existing_record.issue_date.year:
                            existing_record.sbn_no = incoming_base_sbn
                            existing_record.operator_name = extracted['operator_name'].upper()
                            if extracted['make']: existing_record.make = extracted['make'].upper()
                            if extracted['address']: existing_record.address = extracted['address'].upper()
                            if clean_plate: existing_record.plate_no = clean_plate.upper()
                            if extracted['chassis_no']: existing_record.chassis_no = extracted['chassis_no'].upper()
                            if extracted['motor_no']: existing_record.motor_no = extracted['motor_no'].upper()
                            existing_record.issue_date = issue_date
                            existing_record.valid_until = datetime(issue_date.year, 12, 31)
                            existing_record.is_active = determine_status(issue_date)
                            imported_count += 1
                    else:
                        record = FranchiseRecord(
                            sbn_no=incoming_base_sbn, operator_name=extracted['operator_name'],
                            address=extracted['address'], motor_no=extracted['motor_no'],
                            plate_no=clean_plate, chassis_no=extracted['chassis_no'],
                            make=extracted['make'], route=route_name.upper(),
                            driving_route=extracted['driving_route'], issue_date=issue_date,
                            valid_until=datetime(issue_date.year, 12, 31),
                            processed_by=full_name, is_active=determine_status(issue_date)
                        )
                        db.add(record)
                        existing_route_records.append(record)
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
        records_query = db.query(FranchiseRecord).filter(FranchiseRecord.route == route_name).all()
        # Collapse any legacy SQLite duplicates down by unique Base SBN (keeping latest issue_date)
        unique_records_map = {}
        for r in records_query:
            base_id = get_base_sbn(r.sbn_no)
            r.sbn_no = base_id
            if base_id not in unique_records_map:
                unique_records_map[base_id] = r
            else:
                if (r.issue_date or datetime.min) > (unique_records_map[base_id].issue_date or datetime.min):
                    unique_records_map[base_id] = r
        # RULE 3: Strict Numerical Sorting applied
        return sorted(unique_records_map.values(), key=get_sbn_sort_key)

    @app.get("/franchise/status/inactive")
    def get_inactive_records(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        records = db.query(FranchiseRecord).filter(FranchiseRecord.is_active == False).all()
        for r in records:
            r.sbn_no = get_base_sbn(r.sbn_no)
        # RULE 3: Strict Numerical Sorting applied
        return sorted(records, key=get_sbn_sort_key)

    @app.get("/predict/{route}")
    def get_prediction(route: str, db: Session = Depends(get_db)):
        return run_kmeans_clustering(db, route)

    @app.get("/export/masterlist/{route_name}")
    def export_toda_masterlist(route_name: str, status_filter: str = "ALL", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        records_query = db.query(FranchiseRecord).filter(FranchiseRecord.route == route_name.upper()).all()
        
        # RULE 1: Deduplicate strictly by Base SBN to eliminate legacy year duplicate rows (278/278 rows)
        unique_records_map = {}
        for r in records_query:
            base_id = get_base_sbn(r.sbn_no)
            r.sbn_no = base_id
            if base_id not in unique_records_map:
                unique_records_map[base_id] = r
            else:
                if (r.issue_date or datetime.min) > (unique_records_map[base_id].issue_date or datetime.min):
                    unique_records_map[base_id] = r
                    
        # RULE 3: Ensure Masterlist is perfectly sorted numerically
        records_query = sorted(unique_records_map.values(), key=get_sbn_sort_key)
        current_year = get_pht_now().year
        
        filtered_records = []
        for r in records_query:
            issue_year = r.issue_date.year if r.issue_date else 0
            if not r.is_active or issue_year <= current_year - 2:
                computed_filter_status = "REVOKED"
            elif issue_year == current_year - 1:
                computed_filter_status = "FLAGGED"
            else:
                computed_filter_status = "ACTIVE"
                
            if status_filter == "ALL" or status_filter == computed_filter_status:
                filtered_records.append(r)

        if not filtered_records:
            raise HTTPException(status_code=404, detail="No records found matching this filter")
            
        csv_data = []
        for r in filtered_records:
            # RULE 4: Strict 7 Column format (No STATUS column, MAKE replaces ADDRESS)
            csv_data.append({
                "SBN NO.": r.sbn_no or "",
                "DATE OF RENEWAL": r.issue_date if r.issue_date else None,
                "NAME": r.operator_name or "",
                "MAKE": r.make or "", 
                "MOTOR NO.": r.motor_no or "",
                "CHASSIS NO.": r.chassis_no or "",
                "PLATE NO.": r.plate_no or ""
            })
            
        df = pd.DataFrame(csv_data)
        output = io.BytesIO()
        
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name="Masterlist", startrow=1)
            ws = writer.sheets['Masterlist']
            
            # RULE 4: Set Universal Calibri Font references
            calibri_11 = Font(name="Calibri", size=11)
            calibri_11_bold = Font(name="Calibri", size=11, bold=True)
            calibri_16_bold = Font(name="Calibri", size=16, bold=True)
            
            # RULE 4: Dynamic Highlight Fill Hex Values
            fill_vacant = PatternFill(start_color="FF00B0F0", end_color="FF00B0F0", fill_type="solid")
            fill_y2 = PatternFill(start_color="FFBDD7EE", end_color="FFBDD7EE", fill_type="solid")
            fill_y3_7 = PatternFill(start_color="FF92D050", end_color="FF92D050", fill_type="solid")
            fill_y8 = PatternFill(start_color="FFFFFF00", end_color="FFFFFF00", fill_type="solid")
            
            # Apply universal text size formatting for entire document
            for row in ws.iter_rows():
                for cell in row:
                    cell.font = calibri_11

            total_row_count = len(filtered_records) + 2
            current_year_short = str(current_year)[-2:]

            # RULE 4: Top Counter configuration
            ws.merge_cells('A1:B1')
            ws['A1'] = f'=COUNTIF(B3:B{total_row_count}, ">=01-Jan-{current_year_short}")'
            ws['A1'].font = calibri_16_bold
            ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
            
            # Formatting core headers to bold
            for col_num in range(1, 8):
                cell = ws.cell(row=2, column=col_num)
                cell.font = calibri_11_bold
                cell.alignment = Alignment(horizontal='center', vertical='center')
            
            # RULE 4: Legend Panel generation precisely mapped into Column I, J, K
            ws['I3'] = "VACANT"
            ws['I3'].font = calibri_11_bold
            ws['I3'].fill = fill_vacant
            
            ws['I4'] = f"{current_year - 2}"
            ws['I4'].font = calibri_11_bold
            ws['I4'].fill = fill_y2
            
            ws['I5'] = f"{current_year - 7}-{current_year - 3}"
            ws['I5'].font = calibri_11_bold
            ws['I5'].fill = fill_y3_7
            
            ws['I6'] = f"{current_year - 8}"
            ws['I6'].font = calibri_11_bold
            ws['I6'].fill = fill_y8

            ws['J5'] = "Count:"
            ws['J5'].font = calibri_11_bold
            ws['K5'] = f"{current_year}-01-01"
            ws['K5'].font = calibri_11
            ws['K6'] = f"{current_year}-12-31"
            ws['K6'].font = calibri_11

            # RULE 4: Cell populating loop (Formats matching backgrounds and native short dates)
            for row_num, r_dict in enumerate(csv_data, start=3):
                op_name = str(r_dict["NAME"]).strip()
                issue_date = r_dict["DATE OF RENEWAL"]
                issue_year = issue_date.year if pd.notna(issue_date) else 0
                
                fill_color = None
                
                # Rule execution priority: Vacant Overrides date colors
                if not op_name:
                    fill_color = fill_vacant
                elif issue_year >= current_year - 1:
                    fill_color = None
                elif issue_year == current_year - 2:
                    fill_color = fill_y2
                elif current_year - 7 <= issue_year <= current_year - 3:
                    fill_color = fill_y3_7
                else:
                    fill_color = fill_y8
                
                for col_num in range(1, 8):
                    cell = ws.cell(row=row_num, column=col_num)
                    cell.font = calibri_11
                    
                    if fill_color:
                        cell.fill = fill_color
                    cell.alignment = Alignment(horizontal='left', vertical='center')
                    
                    # RULE 4: Directing Pandas internal Timestamp object to be visually masked natively
                    if col_num == 2 and cell.value:
                        cell.number_format = 'dd-mmm-yy'
            
            # Resizing auto-fit dimensions to safely account for Legend
            for col_idx in range(1, ws.max_column + 1):
                col_letter = get_column_letter(col_idx)
                if col_letter in ['I', 'J', 'K']:
                    ws.column_dimensions[col_letter].width = 16
                    continue
                
                max_length = 0
                for row_idx in range(1, ws.max_row + 1):
                    cell_value = ws.cell(row=row_idx, column=col_idx).value
                    # Cap date column width override
                    if col_idx == 2 and cell_value: 
                        if 12 > max_length: max_length = 12
                    elif cell_value:
                        length = len(str(cell_value))
                        if length > max_length:
                            max_length = length
                ws.column_dimensions[col_letter].width = max_length + 2

        output.seek(0)
        
        filter_tag = f"_{status_filter}" if status_filter != "ALL" else ""
        log_action(db, f"{current_user.first_name} {current_user.last_name}", "EXPORT_MASTERLIST", "0", route_name.upper(), f"Exported {status_filter} Masterlist for {route_name.upper()}")
        
        headers = {
            'Content-Disposition': f'attachment; filename="{route_name.upper()}_{current_year}{filter_tag}.xlsx"'
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