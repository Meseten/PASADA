# 25010 Characteristic: Functional Suitability, Maintainability, Performance Efficiency

import sys
import os
import subprocess

# --- WINDOWS OS CRASH FIX ---
# Prevents OSError: [Errno 22] Invalid argument when Pyinstaller runs windowless
if sys.platform == "win32":
    if sys.stdin is None:
        sys.stdin = open(os.devnull, "r")
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")

import traceback
import re
import asyncio
import requests
import secrets
from datetime import datetime, timedelta, timezone
import zipfile
import threading
import multiprocessing
import io
import shutil
import calendar
import uuid
import platform
import time
import hmac
import hashlib
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form, Header, Request
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, JSONResponse
import json
from fastapi.encoders import jsonable_encoder
import starlette.formparsers
import uvicorn

from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import func, extract, create_engine, inspect, or_, text
from sqlalchemy.exc import IntegrityError

from jose import JWTError, jwt
from passlib.context import CryptContext
import passlib.handlers.bcrypt
import pandas as pd
import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter

# --- CORE SETTINGS & LOGGING ---
from database import BASE_DIR, SessionLocal, User, FranchiseRecord, AuditLog, SystemSettings, RouteData, ApprovalTicket, get_pht_now
from ml_engine import run_kmeans_clustering, invalidate_ml_cache
from route_seed_data import ALIASES as _ROUTE_ALIASES
import route_seed_data
from doc_generator import generate_certificate, generate_toda_summary
from extractor import extract_docx_data
import sync_engine
from sync_engine import (start_lan_sync, get_local_ip, PEERS, get_last_sync_check,
                         cluster_secret_fingerprint, rotate_cluster_secret, import_cluster_secret,
                         arm_pairing_pin, clear_pairing_pin, pin_pairing_status,
                         request_pin_join, pin_join_was_successful)
from pydantic import BaseModel, Field

# BOOT TELEMETRY: captured after the heavy imports (fastapi, sqlalchemy,
# pandas, pyinstaller's onefile defrost) but before anything network-related
# starts. The bind-time log below reads this so a slow first boot can be
# told apart from a slow bind from the crash log alone.
BOOT_T0 = time.time()
try:
    import psutil as _psutil
    # True process start (includes the onefile unpack, which happens before
    # any Python line runs) — this is the number that matches what the user
    # experienced from the moment they double-clicked the app.
    PROC_T0 = _psutil.Process().create_time()
except Exception:
    PROC_T0 = BOOT_T0

crash_log_path = os.path.join(BASE_DIR, "PASADA_CRASH_LOG.txt")

def force_log(msg):
    try:
        with open(crash_log_path, "a", encoding="utf-8") as f:
            f.write(f"{msg}\n")
    except OSError:
        pass

def exception_hook(exc_type, exc_value, exc_traceback):
    err_msg = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    force_log(f"\n[{datetime.now()}] !!! OS-LEVEL FATAL CRASH !!!\n{err_msg}")
    sys.exit(1)

sys.excepthook = exception_hook

force_log(f"\n[{datetime.now()}] --- BOOTING PASADA BACKEND ---")
force_log(f"Running from: {sys.executable}")

if __name__ == "__main__":
    multiprocessing.freeze_support()

force_log("All libraries loaded successfully!")

# --- APP INITIALIZATION ---
starlette.formparsers.MultiPartParser.max_files = 10000
starlette.formparsers.MultiPartParser.max_fields = 10000

def automated_background_tasks():
    while True:
        try:
            now = get_pht_now()
            
            export_dir = os.path.join(BASE_DIR, "exports")
            if os.path.exists(export_dir):
                current_timestamp = time.time()
                for file_name in os.listdir(export_dir):
                    file_path = os.path.join(export_dir, file_name)
                    if os.path.getmtime(file_path) < current_timestamp - 7200:
                        try:
                            os.remove(file_path)
                        except OSError:
                            pass

            track_file = os.path.join(BASE_DIR, "last_backup.txt")
            last_backup = ""
            if os.path.exists(track_file):
                with open(track_file, "r") as f: 
                    last_backup = f.read().strip()
            
            today_str = now.strftime('%Y-%m-%d')
            
            # ISO 25010 Reliability: daily SQLite quick_check. Nakakahuli ng
            # database corruption MAAGA (habang kaya pa ang VACUUM INTO
            # recovery) sa halip na sa unang pagkabigo ng query. Isang beses
            # kada araw lang, resulta ay nakasulat sa crash log; ang
            # quick_check ay mas mura kaysa full integrity_check.
            integrity_track = os.path.join(BASE_DIR, "last_integrity_check.txt")
            last_check = ""
            if os.path.exists(integrity_track):
                with open(integrity_track, "r") as f:
                    last_check = f.read().strip()
            if last_check != today_str:
                try:
                    idb = SessionLocal()
                    row = idb.execute(text("PRAGMA quick_check")).fetchone()
                    idb.close()
                    result = row[0] if row else "unknown"
                    if result == "ok":
                        force_log(f"[{now}] Daily DB integrity check: ok")
                    else:
                        force_log(f"[{now}] Daily DB integrity check PROBLEM: {result}")
                    with open(integrity_track, "w") as f:
                        f.write(today_str)
                except Exception as e:
                    force_log(f"Integrity check failed: {e}")
            
            if (now.hour > 16 or (now.hour == 16 and now.minute >= 45)) and last_backup != today_str:
                backup_dir = os.path.join(BASE_DIR, "backups")
                if not os.path.exists(backup_dir):
                    os.makedirs(backup_dir)
                
                db_path = os.path.join(BASE_DIR, 'pasada_production.db')
                if os.path.exists(db_path):
                    zip_name = os.path.join(backup_dir, f"PASADA_Backup_{today_str}.zip")
                    with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
                        zipf.write(db_path, os.path.basename(db_path))
                    force_log(f"Automated backup secured: {zip_name}")
                
                # ISO 25010 Reliability: backup retention policy. Panatilihin
                # lang ang huling 30 araw ng backup ZIP; lahat ng mas luma ay
                # kasama na ng desktop hard drive kung sasapatin, pero ang
                # unang 30 araw ay sapat para sa anumang makatwirang rollback.
                try:
                    cutoff = (now - timedelta(days=30)).strftime('PASADA_Backup_%Y-%m-%d.zip')
                    for old_name in os.listdir(backup_dir):
                        if old_name.startswith("PASADA_Backup_") and old_name < cutoff:
                            try:
                                os.remove(os.path.join(backup_dir, old_name))
                                force_log(f"Backup retention: removed old backup {old_name}")
                            except OSError:
                                pass
                except Exception as prune_err:
                    force_log(f"Backup retention sweep failed: {prune_err}")
                
                with open(track_file, "w") as f: 
                    f.write(today_str)
                    
        except Exception as e:
            force_log(f"Background task engine error: {e}")
            
        time.sleep(60)

LIFECYCLE_START_ISO = get_pht_now().isoformat()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ROUTE FACTS: make sure every known Naic TODA route has its verified
    # census population and road length on first launch. Idempotent and
    # silent about rows the office has already corrected (office values win).
    try:
        from route_seed import seed_route_facts
        seed_db = SessionLocal()
        try:
            seed_route_facts(seed_db)
        finally:
            seed_db.close()
    except Exception as e:
        force_log(f"Route fact seeding deferred: {e}")
    threading.Thread(target=automated_background_tasks, daemon=True).start()
    def safe_sync():
        try:
            start_lan_sync()
        except Exception as e:
            force_log(f"LAN Sync initialization deferred: {e}")
    threading.Thread(target=safe_sync, daemon=True).start()
    yield

app = FastAPI(title="PASADA Registry API", lifespan=lifespan)

app.add_middleware(  
    CORSMiddleware,  
    # SECURITY: only the app's own origins need CORS. The API is reached at
    # http://127.0.0.1:43888 from the app window itself. Windows WebView2
    # reports the app origin as http://tauri.localhost (https on some builds),
    # macOS/Linux WebKit use tauri://localhost, and the dev server runs on
    # localhost:3000. Do NOT put "*" here: with allow_origins=["*"] Starlette
    # mirrors any Origin header, which would let any website open in a browser
    # on this computer read LGU records from the local API.
    allow_origins=[
        "http://tauri.localhost",  
        "https://tauri.localhost",  
        "tauri://localhost",  
        "http://localhost:3000",  
        "http://127.0.0.1:3000",  
    ],  
    allow_credentials=False,  
    allow_methods=["*"],  
    allow_headers=["*"],  
    expose_headers=["Content-Disposition"]  
)  
  
from starlette.requests import Request as _StarletteRequest  
from starlette.responses import Response as _StarletteResponse  
  
@app.middleware("http")  
async def allow_private_network_access(request: _StarletteRequest, call_next):  
    if request.method == "OPTIONS":  
        response = _StarletteResponse(status_code=200)  
    else:  
        response = await call_next(request)  
  
    # SECURITY: reflect the Origin only when it is one of the app's own.
    # Anything else gets no ACAO header, so browsers block the response.
    # Windows WebView2 sends http://tauri.localhost; WebKit sends tauri://.
    ALLOWED_ORIGINS = (
        "http://tauri.localhost",  
        "https://tauri.localhost",  
        "tauri://localhost",  
        "http://localhost:3000",  
        "http://127.0.0.1:3000",  
    )
    origin = request.headers.get("origin", "")  
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin  
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"  
    response.headers["Access-Control-Allow-Headers"] = "*"  
    response.headers["Access-Control-Allow-Private-Network"] = "true"  
    return response

# --- JWT AUTHENTICATION CONFIGURATION ---
SECRET_KEY_PATH = os.path.join(BASE_DIR, "jwt_secret.key")
if os.path.exists(SECRET_KEY_PATH):
    with open(SECRET_KEY_PATH, "r") as f:
        JWT_SECRET_KEY = f.read().strip()
else:
    JWT_SECRET_KEY = str(uuid.uuid4())
    with open(SECRET_KEY_PATH, "w") as f:
        f.write(JWT_SECRET_KEY)

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30 

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def create_access_token(data: dict):
    to_encode = data.copy()
    # timezone-aware na UTC para hindi na mag-warning sa Python 3.12+ (deprecated na yung utcnow)
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=ALGORITHM)

# --- DATABASE INJECTION ---
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

# --- PYDANTIC MODELS ---
class FranchiseCreate(BaseModel):
    sbn_no: Optional[str] = ""
    # Yung SBN na nakita ng user sa edit modal nung binuksan nya yung form.
    # Ito ang basehan ng renewal detection, hindi yung stored value, kasi
    # display lang sa listahan yung base + year suffix. See update endpoint notes.
    original_sbn_no: Optional[str] = ""
    operator_name: Optional[str] = ""
    address: Optional[str] = ""
    motor_no: Optional[str] = ""
    chassis_no: Optional[str] = ""
    make: Optional[str] = ""
    plate_no: Optional[str] = ""
    route: str
    driving_route: Optional[str] = ""
    issue_date: Optional[str] = ""
    valid_until: Optional[str] = ""

class RouteRenameRequest(BaseModel):
    new_route_name: str
    new_prefix: str
    new_driving_route: str
    # Only used when the office has a single active Admin (see the two-key
    # rule below): the direct execution then demands a written reason.
    override_reason: str = ""

class UserCreate(BaseModel):
    first_name: str
    last_name: str
    username: str
    password: str
    # Optional for older clients; the bundled UI always sends it.
    password_confirm: Optional[str] = None
    role: str

class LoginRequest(BaseModel):
    username: str
    password: str

class SettingsUpdate(BaseModel):
    committee_chair: str
    enable_esignature: Optional[bool] = False 

class PasswordUpdate(BaseModel):
    new_password: str

class UsernameUpdate(BaseModel):
    new_username: str

class AdminPasswordReset(BaseModel):
    username: str
    new_password: str
    # Optional for older clients; the bundled UI always sends it.
    password_confirm: Optional[str] = None

class RouteDataUpdate(BaseModel):
    population: int
    road_length_km: float

class BulkDeleteRequest(BaseModel):
    sbn_list: List[str]

class SignupRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    username: str = Field(min_length=3, max_length=60)
    password: str = Field(min_length=8, max_length=72)  # bcrypt hard limit
    # Optional for backward compatibility with older clients; the bundled
    # frontend always sends it and the endpoint enforces the match.
    password_confirm: Optional[str] = None
    role: str = "Clerk"  # ignored by the endpoint — see setup_admin_notes

class BatchGenerateRequest(BaseModel):
    record_ids: List[str]

# --- SECURITY DEPENDENCIES ---
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
        
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if getattr(user, "is_deactivated", False):
        # A deactivated account's tokens stop working immediately: sign-in is
        # refused and every signed-in session is dropped on its next request.
        raise HTTPException(status_code=401, detail="This account has been deactivated by the Admin.")
    return user

# --- CENTRALIZED BUSINESS LOGIC HELPERS ---

def alias_route(route: str) -> str:
    """Silently redirects spelling variants to one canonical route name to prevent
    duplicate route creation. NCTODA->NPTODA was the original rule; the rest come
    from route_seed_data.ALIASES (older spellings like DOMSA/DOMSATODA now redirect
    to the office-confirmed DOMMSATODA, and short forms the clerks type)."""
    if not route: return ""
    r = route.strip().upper()
    if r == "NCTODA":
        return "NPTODA"
    return route_seed_data.ALIASES.get(r, r)

def _active_admins(db: Session) -> list:
    """Admin accounts that can actually act: role Admin AND not deactivated.
    A deactivated admin cannot sign in, so for bootstrap, the recovery valve,
    and the last-admin guard only active admins count."""
    return [u for u in db.query(User).filter(User.role == "Admin").all()
            if not getattr(u, "is_deactivated", False)]

def require_admin(current_user: User) -> None:
    """One gate for every Admin-only operation. Kept as a helper so the rule
    lives in exactly one place: if the signed-in account is not an Admin the
    request stops here with 403, no matter which endpoint called it."""
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Admin only")

def require_record_writer(current_user: User) -> None:
    """One gate for every write to the records themselves (create/edit/delete
    operators, uploads, certificate generation). Admin and Clerk pass; the
    Viewer role — added so the second office PC can look at the registry
    without being able to change it — is stopped here with 403. Kept beside
    require_admin for the same reason: the rule lives in one place."""
    if current_user.role == "Viewer":
        raise HTTPException(status_code=403, detail="Viewer accounts are read-only. Ask the Admin for a Clerk account to make changes.")

def _other_active_admin_exists(db: Session, current_user: User) -> bool:
    """KEPT FOR COMPATIBILITY but no longer gates the Admin's own actions.
    DECISION 2026-10-14 (owner): PASADA runs as ONE person operating the
    office PC(s), so the old two-key rule dead-ended the hard-to-undo
    actions behind an approval ticket the second Admin (often the same
    person on the other PC) could not meaningfully consent to. The rule for
    the big, hard-to-undo actions is now SINGLE-KEY: an Admin executes
    directly, but ALWAYS with a MANDATORY written reason recorded loudly in
    the audit log; a Clerk still files a ticket for the Admin to execute.
    This helper remains only for code/tests that read the admin roster.
    """
    return db.query(User).filter(
        User.role == "Admin",
        User.is_deactivated == False,
        User.id != current_user.id,
    ).count() > 0

def get_full_name(user: User) -> str:
    first = getattr(user, 'first_name', "") or ""
    last = getattr(user, 'last_name', "") or ""
    name = f"{first} {last}".strip()
    
    if not name or name == "None" or name == "None None":
        return getattr(user, 'username', "SYSTEM ADMIN")
    return name

def compute_record_status(record: FranchiseRecord) -> str:
    is_vacant = not record.operator_name or str(record.operator_name).strip() == ""
    if is_vacant:
        return "VACANT"
    issue_year = record.issue_date.year if record.issue_date else 0
    current_year = get_pht_now().year
    
    if getattr(record, 'is_active', True) is False or issue_year <= current_year - 2:
        return "REVOKED"
    if issue_year == current_year - 1:
        return "FLAGGED"
    return "ACTIVE"

def attach_status(record: FranchiseRecord):
    record.status = compute_record_status(record)
    return record

def log_action(db: Optional[Session], clerk_name: str, action: str, target_id: str, target_route: str, details: str,
               operator_name: Optional[str] = None, sbn_no: Optional[str] = None, field_changed: Optional[str] = None,
               old_value: Optional[str] = None, new_value: Optional[str] = None, secondary_value: Optional[str] = None, 
               ip_or_source: Optional[str] = None):
    if db is None:
        # Some admin actions (template upload) run outside the request's DB
        # session; open our own so the audit trail never depends on the caller.
        db = SessionLocal()
        try:
            _write_audit(db, clerk_name, action, target_id, target_route, details, operator_name,
                         sbn_no, field_changed, old_value, new_value, secondary_value, ip_or_source)
        finally:
            db.close()
        return
    _write_audit(db, clerk_name, action, target_id, target_route, details, operator_name,
                 sbn_no, field_changed, old_value, new_value, secondary_value, ip_or_source)

def _write_audit(db: Session, clerk_name: str, action: str, target_id: str, target_route: str, details: str,
                 operator_name: Optional[str] = None, sbn_no: Optional[str] = None, field_changed: Optional[str] = None,
                 old_value: Optional[str] = None, new_value: Optional[str] = None, secondary_value: Optional[str] = None,
                 ip_or_source: Optional[str] = None):
    new_log = AuditLog(
        clerk_name=clerk_name, 
        action=action, 
        target_id=str(target_id), 
        target_route=target_route, 
        details=details,
        operator_name=operator_name,
        sbn_no=sbn_no,
        field_changed=field_changed,
        old_value=old_value,
        new_value=new_value,
        secondary_value=secondary_value,
        ip_or_source=ip_or_source
    )
    db.add(new_log)
    db.commit()

def determine_status(issue_date):
    if not issue_date: return False
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

def get_fuzzy_col_dict(row_dict, target):
    for col, val in row_dict.items():
        if target in str(col).upper():
            if val is None or str(val).lower() in ["nan", "none", "nat"]:
                return ""
            return str(val).strip()
    return ""

def parse_safe_date(raw_date, fallback_year):
    if raw_date is None or pd.isna(raw_date) or str(raw_date).strip().lower() in ["nan", "nat", "none", ""]:
        return None
    try:
        if isinstance(raw_date, datetime):
            return raw_date
        
        raw_str = str(raw_date).strip()
        
        try:
            iso_str = raw_str.split('T')[0]
            dt = datetime.fromisoformat(iso_str)
            return dt
        except ValueError:
            pass

        dt = pd.to_datetime(raw_str, errors='coerce', dayfirst=True)
        if pd.isna(dt):
            return None
        return dt.to_pydatetime()
    except (ValueError, TypeError, OverflowError) as e:
        force_log(f"Date parsing failed: {e}")
        return None

# --- NATIVE PYTHON OPTIMIZATION: Memoization Cache for regex operations ---
_SBN_MEMO = {}

# --- LIGHTNING CACHE: Fixes Dashboard Lags & Loading Times ---
_GLOBAL_STATS_CACHE = {"time": 0, "data": None}
_TODA_SUMMARY_CACHE = {"time": 0, "data": None}
_ROUTE_DIST_CACHE = {"time": 0, "data": None}
_ALL_DEDUPED_CACHE = {"time": 0, "data": None}
_ROUTE_RECORDS_CACHE = {} 

def clear_api_caches():
    """Flushes the lightning RAM cache when a record is added, edited, or deleted."""
    global _GLOBAL_STATS_CACHE, _TODA_SUMMARY_CACHE, _ROUTE_DIST_CACHE, _ALL_DEDUPED_CACHE, _ROUTE_RECORDS_CACHE
    _GLOBAL_STATS_CACHE["time"] = 0
    _TODA_SUMMARY_CACHE["time"] = 0
    _ROUTE_DIST_CACHE["time"] = 0
    _ALL_DEDUPED_CACHE["time"] = 0
    _ROUTE_RECORDS_CACHE.clear()

def get_base_sbn(sbn):
    sbn = str(sbn).strip().upper()
    match = re.match(r'^([A-Z0-9]+[\-\_]\d+)[\-\_](\d{2}|19\d{2}|20\d{2})$', sbn)
    if match:
        return match.group(1)
    return sbn

def normalize_base_sbn(sbn):
    if pd.isna(sbn) or not sbn: return ""
    sbn_str = str(sbn).strip().upper()
    
    # Memoization intercept (returns instantly if seen before)
    if sbn_str in _SBN_MEMO:
        return _SBN_MEMO[sbn_str]

    match = re.match(r'^(.*?)[\s\-\_]+(\d{2}|19\d{2}|20\d{2})$', sbn_str)
    base = match.group(1) if match else sbn_str
        
    match = re.match(r'^(.*?)[\s\-\_]+(\d+)$', base)
    if match:
        prefix = re.sub(r'[^A-Z0-9]', '', match.group(1))
        num_str = match.group(2)
        padding = 4 if int(num_str) >= 1000 else 3
        result = f"{prefix}-{int(num_str):0{padding}d}"
        _SBN_MEMO[sbn_str] = result
        return result

    clean_base = re.sub(r'[^A-Z0-9]', '', base)
    match = re.match(r'^([A-Z]+)(\d+)$', clean_base)
    if match:
        prefix = match.group(1)
        num_str = match.group(2)
        padding = 4 if int(num_str) >= 1000 else 3
        result = f"{prefix}-{int(num_str):0{padding}d}"
        _SBN_MEMO[sbn_str] = result
        return result

    result = base.replace(" ", "")
    _SBN_MEMO[sbn_str] = result
    return result

def format_sbn_with_year(sbn, issue_date, is_vacant=False):
    base_sbn = normalize_base_sbn(sbn)
    if is_vacant or not issue_date:
        return base_sbn
    try:
        if isinstance(issue_date, str):
            issue_date = datetime.fromisoformat(issue_date.split('T')[0])
        year_suffix = str(issue_date.year)[-2:]
        return f"{base_sbn}-{year_suffix}"
    except Exception:
        return base_sbn

def get_record_year(dt):
    if dt and isinstance(dt, datetime):
        return dt.year
    elif dt and hasattr(dt, 'year'):
        return dt.year
    return 0

def set_if_blank(curr_val, new_val):
    if (not curr_val or not str(curr_val).strip()) and new_val:
        return str(new_val).strip().upper()
    return curr_val

def extract_sbn_integer(sbn):
    base_sbn = get_base_sbn(sbn)
    nums = re.findall(r'\d+', base_sbn)
    if nums:
        return int(nums[-1])
    return None 
    
def get_sbn_sort_key(record):
    val = extract_sbn_integer(record.sbn_no)
    return val if val is not None else 999999

def generate_next_sbn(db: Session, route: str) -> str:
    route_upper = alias_route(route.strip().upper())
    records = db.query(FranchiseRecord.sbn_no).filter(
        FranchiseRecord.route == route_upper,
        FranchiseRecord.is_deleted == False
    ).all()
    max_num = 0
    prefix = ""
    padding_len = 3
    
    for (sbn_val,) in records:
        if sbn_val:
            sbn_str = str(sbn_val).strip().upper()
            base = get_base_sbn(sbn_str)
            match = re.match(r'^([A-Z0-9]+)[\-\_]?(\d+)', base)
            if match:
                if not prefix: 
                    prefix = match.group(1) 
                num_str = match.group(2)
                padding_len = max(padding_len, len(num_str))
            
            nums = re.findall(r'\d+', base)
            if nums:
                val = int(nums[-1])
                if val > max_num:
                    max_num = val
                    
    if not prefix:
        clean_route = route_upper.replace("TODA", "").strip()
        prefix = clean_route if len(clean_route) <= 4 else clean_route[:3]
        
    next_num = max(max_num + 1, 1)
    while next_num == 0:
        next_num += 1
        
    return f"{prefix}-{next_num:0{padding_len}d}"

def get_dominant_driving_route(db: Session, route_name: str) -> str:
    records = db.query(FranchiseRecord.driving_route).filter(
        FranchiseRecord.route == alias_route(route_name),
        FranchiseRecord.driving_route != None,
        FranchiseRecord.driving_route != "",
        FranchiseRecord.is_deleted == False
    ).all()
    
    valid_routes = [str(r[0]).strip().upper() for r in records if r[0] and str(r[0]).strip()]
    if not valid_routes:
        return ""
        
    from collections import Counter
    most_common = Counter(valid_routes).most_common(1)
    if most_common:
        return most_common[0][0]
    return ""

def deduplicate_records_by_base_sbn(records):
    unique_map = {}
    for r in records:
        if getattr(r, 'is_deleted', False): continue
        base_id = normalize_base_sbn(r.sbn_no)
        r.sbn_no = base_id
        if base_id not in unique_map:
            unique_map[base_id] = r
        else:
            curr_existing = unique_map[base_id]
            curr_year = get_record_year(curr_existing.issue_date)
            new_year = get_record_year(r.issue_date)
            if new_year > curr_year:
                unique_map[base_id] = r
            elif new_year == curr_year and (r.operator_name and str(r.operator_name).strip() and not str(curr_existing.operator_name).strip()):
                unique_map[base_id] = r
    return list(unique_map.values())

def get_all_deduplicated_records(db: Session):
    global _ALL_DEDUPED_CACHE
    if time.time() - _ALL_DEDUPED_CACHE["time"] < 60 and _ALL_DEDUPED_CACHE["data"] is not None:
        return _ALL_DEDUPED_CACHE["data"]
        
    all_records = db.query(FranchiseRecord).filter(FranchiseRecord.is_deleted == False).all()
    result = deduplicate_records_by_base_sbn(all_records)
    _ALL_DEDUPED_CACHE["data"] = result
    _ALL_DEDUPED_CACHE["time"] = time.time()
    return result

def escape_excel(val):
    if not val:
        return ""
    s = str(val).strip()
    if s.startswith(('=', '+', '-', '@', '\t', '\r')):
        return f"'{s}"
    return s

# --- GLOBAL ROUTE DISPLAY MAP ---
ROUTE_DISPLAY_MAP = {
    "BATODA": "BATODA (BANCAAN/SAPA)",
    "BBSTODA": "BBSTODA (BUCANA/BAGONG KALSADA/SAPA)",
    "CNTODA": "CNTODA (CIUDAD NUEVO)",
    "CO1TODA": "CO1TODA (TIMALAN BALSAHAN/HILLSVIEW)",
    "CO2TODA": "CO2TODA (TIMALAN BALSAHAN/HILLSVIEW)",
    "DOMMSATODA": "DOMMSATODA (MUZON)",
    "HCTODA": "HCTODA (HALANG/CALUBCOB)",
    "HMTODA": "HMTODA (HUMBAC/MAKINA)",
    "HVRTODA": "HVRTODA (HILLSVIEW/TIMALAN BALSAHAN)",
    "MALATODA": "MALATODA (MABULO/LABAC)",
    "MMTODA": "MMTODA (MALAINEN LUMA/MOLINO)",
    "MMGTODA": "MMGTODA (MUNTING MAPINO)",
    "NCTODA": "NPTODA (POBLACION)", # Alias target
    "NPTODA": "NPTODA (POBLACION)", 
    "PAL1TODA": "PAL1TODA (PALANGUE CENTRAL)",
    "PAL2TODA": "PAL2&3TODA (PALANGUE 2&3)",
    "SABANGTODA": "SABANGTODA (SABANG)",
    "SMSTODA": "SMSTODA (SAN ROQUE/M. BAGO/SANTULAN)",
    "TCTODA": "TCTODA (TIMALAN CONCEPCION)",
    "VASTODA": "VASTODA (VILLA APOLONIA)",
    "VISTODA": "VISTODA (FREEDOMVILLE)"
}

# FULL ADDRESS MAP: yung mga klerk minsan pa-shortcut pagta-type ng barangay
# (PAL.CENTRAL, TIM.BALSAHAN, ganyan) tapos yun na yung nailalagay sa records.
# Dito natin nila-expand para laging kumpleto ang address sa certificates,
# sa listahan, at sa exports. Exact match lang sa buong address para hindi
# tayo makasabit ng ibang barangay na may parehong simula.
FULL_ADDRESS_MAP = {
    "PAL.CENTRAL": "PALANGUE CENTRAL",
    "PAL. CENTRAL": "PALANGUE CENTRAL",
    "PAL CENTRAL": "PALANGUE CENTRAL",
    "PALANGUE CENTRAL": "PALANGUE CENTRAL",
    "TIM.BALSAHAN": "TIMALAN BALSAHAN",
    "TIM. BALSAHAN": "TIMALAN BALSAHAN",
    "TIM BALSAHAN": "TIMALAN BALSAHAN",
    "TIMALAN BALSAN": "TIMALAN BALSAHAN",
    "BALSAHAN": "TIMALAN BALSAHAN",
    "TIMALAN BALSAHAN": "TIMALAN BALSAHAN",
    "TIM.CONCEPCION": "TIMALAN CONCEPCION",
    "TIM. CONCEPCION": "TIMALAN CONCEPCION",
    "TIM CONCEPCION": "TIMALAN CONCEPCION",
    "CONCEPCION": "TIMALAN CONCEPCION",
    "TIMALAN CONCEPCION": "TIMALAN CONCEPCION",
}

def expand_address_abbreviations(address: Optional[str]) -> str:
    """Nililinis dito yung mga pa-shortcut na address bago ma-save sa DB.
    Binabaliwala rin natin kung may nakadugtong nang ', NAIC, CAVITE' - ibabalik
    natin yun pagkatapos i-expand para consistent sa format ng ibang records."""
    if not address:
        return ""
    cleaned = str(address).strip().upper()

    # alisin muna yung suffix kung meron na, tapos ibalik pagkatapos ng expansion
    had_suffix = False
    for suffix in (", NAIC, CAVITE", "NAIC, CAVITE"):
        if cleaned.endswith(suffix):
            had_suffix = True
            cleaned = cleaned[: -len(suffix)].strip().rstrip(",").strip()
            break

    if not cleaned:
        return ""

    expanded = FULL_ADDRESS_MAP.get(cleaned, cleaned)
    if had_suffix and expanded:
        expanded = f"{expanded}, NAIC, CAVITE"
    return expanded

def get_toda_summary_data(db: Session):
    global _TODA_SUMMARY_CACHE
    if time.time() - _TODA_SUMMARY_CACHE["time"] < 60 and _TODA_SUMMARY_CACHE["data"]:
        return _TODA_SUMMARY_CACHE["data"]

    current_time = get_pht_now()
    current_year = current_time.year
    as_of_date = current_time.strftime("%B %d, %Y").upper()
    
    deduped_all = get_all_deduplicated_records(db)
    route_counts = {}
    route_totals = {}
    
    for r in deduped_all:
        route_totals[r.route] = route_totals.get(r.route, 0) + 1
        if r.issue_date and r.issue_date.year == current_year and r.operator_name and str(r.operator_name).strip() != "":
            route_counts[r.route] = route_counts.get(r.route, 0) + 1
            
    rows = [
        {
            "route": ROUTE_DISPLAY_MAP.get(route, route),
            "total": route_totals[route], 
            "renewed": route_counts.get(route, 0)
        } 
        for route in sorted(route_totals.keys())
    ]
    
    total_toda = len(rows)
    grand_total = sum(r["total"] for r in rows)
    grand_renewed = sum(r["renewed"] for r in rows)
    
    res = {
        "as_of_date": as_of_date,
        "rows": rows,
        "total_toda": total_toda,
        "grand_total": grand_total,
        "grand_renewed": grand_renewed,
        "year": current_year
    }
    
    _TODA_SUMMARY_CACHE["data"] = res
    _TODA_SUMMARY_CACHE["time"] = time.time()
    return res

# --- API ENDPOINTS ---

@app.get("/health")
def health_check():
    return {"status": "online"}

@app.delete("/api/operators/{identifier}")
def delete_single_operator(identifier: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_record_writer(current_user)
    if len(identifier) > 15 and "-" in identifier: 
        records = db.query(FranchiseRecord).filter(
            FranchiseRecord.id == identifier,
            FranchiseRecord.is_deleted == False
        ).all()
        clean_sbn = records[0].sbn_no if records else identifier
    else:
        clean_sbn = normalize_base_sbn(identifier)
        # May LIKE clause tayo para kapag base SBN ang binigay (hal. BAT-002 habang
        # naka-store as BAT-002-26), mahahanap pa rin. Dati 404 ang sagot dito.
        records = db.query(FranchiseRecord).filter(
            ((FranchiseRecord.sbn_no == clean_sbn) | (FranchiseRecord.sbn_no == identifier.upper()) | (FranchiseRecord.sbn_no.like(f"{clean_sbn}-%"))) &
            (FranchiseRecord.is_deleted == False)
        ).all()
        
    if not records:
        raise HTTPException(status_code=404, detail="Operator record not found.")
        
    count = len(records)
    target_route = None
    for r in records:
        target_route = r.route
        r.is_deleted = True 
        r.updated_at = get_pht_now()
        
    db.commit()
    invalidate_ml_cache(target_route)
    clear_api_caches()
    log_action(db, get_full_name(current_user), "DELETE_RECORD", identifier, "ALL", f"Soft deleted operator record {clean_sbn}.")
    return {"message": f"{count} operator(s) deleted successfully."}

@app.post("/api/operators/bulk-delete")
def delete_bulk_operators(payload: BulkDeleteRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_record_writer(current_user)
    deleted_count = 0
    for identifier in payload.sbn_list:
        if len(identifier) > 15 and "-" in identifier:
            records = db.query(FranchiseRecord).filter(
                FranchiseRecord.id == identifier,
                FranchiseRecord.is_deleted == False
            ).all()
        else:
            clean_sbn = normalize_base_sbn(identifier)
            # same fix as single delete: hanapin din yung may year suffix (BAT-002-26)
            records = db.query(FranchiseRecord).filter(
                ((FranchiseRecord.sbn_no == clean_sbn) | (FranchiseRecord.sbn_no == identifier.upper()) | (FranchiseRecord.sbn_no.like(f"{clean_sbn}-%"))) &
                (FranchiseRecord.is_deleted == False)
            ).all()
            
        for r in records:
            r.is_deleted = True 
            r.updated_at = get_pht_now()
            deleted_count += 1
    db.commit()
    invalidate_ml_cache() 
    clear_api_caches()
    log_action(db, get_full_name(current_user), "BULK_DELETE", "0", "ALL", f"Bulk deleted {deleted_count} operator record(s).")
    return {"message": f"{deleted_count} operator(s) deleted successfully."}

@app.delete("/api/routes/{route_name}")
def delete_entire_route(route_name: str, override_reason: str = "", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Wiping a whole TODA line is one of the hard-to-undo actions. Since the
    # single-key decision (2026-10-14): an Admin executes DIRECTLY, with a
    # mandatory written reason recorded in the audit log. A Clerk files a
    # ticket for the Admin instead — clerks never execute these.
    route_to_delete = alias_route(route_name)
    records = db.query(FranchiseRecord).filter(FranchiseRecord.route == route_to_delete).all()
    
    if not records:
        raise HTTPException(status_code=404, detail="Route not found or already empty.")

    if current_user.role != "Admin":
        if db.query(ApprovalTicket).filter(
                ApprovalTicket.ticket_type == "route_delete",
                ApprovalTicket.status == "pending",
                ApprovalTicket.payload_json.contains(route_to_delete)).first():
            raise HTTPException(status_code=409, detail=f"A delete ticket for {route_to_delete} is already waiting for approval.")
        ticket = ApprovalTicket(
            created_by=get_full_name(current_user),
            ticket_type="route_delete",
            payload_json=json.dumps({"route": route_to_delete}),
        )
        db.add(ticket)
        db.commit()
        log_action(db, get_full_name(current_user), "TICKET_FILED", ticket.id, route_to_delete,
                   f"Requested approval to delete route '{route_to_delete}' ({len(records)} records).")
        return {"status": "ticket_filed",
                "message": f"Request sent to the Admin for approval. {len(records)} records stay untouched until they approve."}

    # DIRECT EXECUTION (single-key rule): the action
    # runs now, and only with a written reason so the audit log records why.
    reason = (override_reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400,
                            detail="Type a short reason for this deletion so the audit log records why.")
    count = 0
    for r in records:
        if not r.is_deleted:
            r.is_deleted = True
            r.updated_at = get_pht_now()
            count += 1
    db.commit()
    invalidate_ml_cache(route_to_delete)
    clear_api_caches()
    log_action(db, get_full_name(current_user), "DELETE_ROUTE", "0", route_to_delete,
               f"Single-admin override: soft deleted entire route line '{route_to_delete}' containing {count} record(s). Reason: {reason}")
    return {"message": f"Route '{route_to_delete}' deleted successfully."}

@app.post("/api/operators/{record_id}/restore")
def restore_single_operator(record_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_record_writer(current_user)
    record = db.query(FranchiseRecord).filter(FranchiseRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Operator record not found.")
    
    record.is_deleted = False
    record.updated_at = get_pht_now()
    db.commit()
    invalidate_ml_cache(record.route)
    clear_api_caches()
    
    log_action(db, get_full_name(current_user), "RESTORE_RECORD", record.id, record.route, f"Restored operator record {record.sbn_no}.")
    return {"message": "Operator restored successfully."}

@app.get("/api/operators/deleted")
def get_deleted_records(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    records = db.query(FranchiseRecord).filter(FranchiseRecord.is_deleted == True).all()
    deduped_records = deduplicate_records_by_base_sbn(records)
    
    for record in deduped_records:
        is_vac = not record.operator_name or str(record.operator_name).strip() == ""
        record.sbn_no = format_sbn_with_year(record.sbn_no, record.issue_date, is_vacant=is_vac)

    sorted_records = sorted(deduped_records, key=get_sbn_sort_key)
    result = [attach_status(r) for r in sorted_records]
    return result

@app.put("/api/routes/{route_name}/rename")
def rename_route(route_name: str, payload: RouteRenameRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # A rename rewrites the route code and every SBN prefix on the line at
    # once. Since the single-key decision (2026-10-14): an Admin executes
    # DIRECTLY with a mandatory written reason for the audit log; a Clerk
    # files a ticket for the Admin. No second-Admin approval gate anymore.
    old_route = alias_route(route_name)
    if current_user.role != "Admin":
        new_route_check = alias_route(payload.new_route_name)
        if db.query(ApprovalTicket).filter(
                ApprovalTicket.ticket_type == "route_rename",
                ApprovalTicket.status == "pending",
                ApprovalTicket.payload_json.contains(old_route)).first():
            raise HTTPException(status_code=409, detail=f"A rename ticket for {old_route} is already waiting for approval.")
        ticket = ApprovalTicket(
            created_by=get_full_name(current_user),
            ticket_type="route_rename",
            payload_json=json.dumps({"route": old_route,
                                     "new_route_name": payload.new_route_name,
                                     "new_prefix": payload.new_prefix,
                                     "new_driving_route": payload.new_driving_route or ""}),
            reason=payload.new_driving_route and f"Also set driving route: {payload.new_driving_route}" or None,
        )
        db.add(ticket)
        db.commit()
        log_action(db, get_full_name(current_user), "TICKET_FILED", ticket.id, old_route,
                   f"Requested approval to rename route '{old_route}' to '{alias_route(payload.new_route_name)}'.")
        return {"status": "ticket_filed",
                "message": f"Rename request sent to the Admin for approval."}

    # DIRECT EXECUTION (single-key rule): one written reason for the audit
    # log, then the rename runs.
    reason = (payload.override_reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400,
                            detail="Type a short reason for this rename so the audit log records why.")

    new_route = alias_route(payload.new_route_name)
    new_route = alias_route(payload.new_route_name)
    new_prefix = payload.new_prefix.strip().upper()
    
    records = db.query(FranchiseRecord).filter(FranchiseRecord.route == old_route, FranchiseRecord.is_deleted == False).all()
    if not records:
        raise HTTPException(status_code=404, detail="No records found for this route.")
        
    count = 0
    for r in records:
        r.route = new_route
        if payload.new_driving_route:
            r.driving_route = payload.new_driving_route.strip().upper()
        
        # Update prefix safely
        if new_prefix:
            sbn_int = extract_sbn_integer(r.sbn_no)
            if sbn_int is not None:
                padding = 4 if sbn_int >= 1000 else 3
                base_sbn = f"{new_prefix}-{sbn_int:0{padding}d}"
                is_vacant = not r.operator_name or str(r.operator_name).strip() == ""
                r.sbn_no = format_sbn_with_year(base_sbn, r.issue_date, is_vacant)
            
        r.updated_at = get_pht_now()
        count += 1
        
    # Migrate demographics if they exist
    old_route_info = db.query(RouteData).filter(RouteData.route_name == old_route).first()
    if old_route_info and old_route != new_route:
        new_route_info = db.query(RouteData).filter(RouteData.route_name == new_route).first()
        if not new_route_info:
            db.add(RouteData(route_name=new_route, population=old_route_info.population, road_length_km=old_route_info.road_length_km))
        db.delete(old_route_info)
        
    db.commit()
    invalidate_ml_cache(old_route)
    invalidate_ml_cache(new_route)
    clear_api_caches()
    log_action(db, get_full_name(current_user), "RENAME_ROUTE", "0", new_route,
               f"Single-admin override: renamed route {old_route} to {new_route} with prefix {new_prefix}. Updated {count} records. Reason: {reason}")
    return {"status": "success", "message": f"Successfully renamed {count} records to {new_route}.", "new_route": new_route}

# --- ADMIN APPROVAL TICKETS -------------------------------------------
# 25010 Characteristic: Accountability. The heavy actions (route delete,
# route rename, record restore, database restore) used to be either
# Admin-only (clerk hit a 403 wall) or open to whoever clicked. Now a clerk
# FILES a ticket, the Admin APPROVES it, and only then does the action run.
# Every filing, approval, and rejection lands in the audit log.

class TicketDecision(BaseModel):
    note: str = ""

def _ticket_brief(t: ApprovalTicket) -> dict:
    return {
        "id": t.id, "created_at": t.created_at.isoformat() if t.created_at else None,
        "created_by": t.created_by, "ticket_type": t.ticket_type,
        "payload": json.loads(t.payload_json or "{}"), "reason": t.reason,
        "status": t.status, "decided_by": t.decided_by,
        "decided_at": t.decided_at.isoformat() if t.decided_at else None,
        "result_note": t.result_note,
    }

@app.get("/tickets/for-record/{record_id}")
def get_record_restore_status(record_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """LIGHTWEIGHT STATUS for the restore affordances (record History dialog,
    Activity Logs delete rows): is the record currently deleted, and is an
    open restore ticket already waiting for it? Also answers the shared
    question the front ends need: WHO is signed in here, because an Admin
    restores DIRECTLY (with a reason) while a Clerk FILES a ticket."""
    rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == record_id).first()
    restore_requested = False
    if rec:
        for t in db.query(ApprovalTicket).filter(
                ApprovalTicket.ticket_type == "record_restore",
                ApprovalTicket.status == "pending").all():
            try:
                ids = json.loads(t.payload_json or "{}").get("record_ids", [])
            except Exception:
                ids = []
            if str(record_id) in [str(i) for i in ids]:
                restore_requested = True
                break
    return {
        "exists": rec is not None,
        "record_id": record_id,
        "sbn_no": rec.sbn_no if rec else None,
        "route": rec.route if rec else None,
        "is_deleted": bool(rec.is_deleted) if rec else False,
        "restore_requested": restore_requested,
        "current_role": current_user.role,
    }

@app.get("/admin/tickets")
def list_tickets(status_filter: str = "pending", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Approval queue for the Admin Console. Clerks also read it to see their
    own requests' status, so the list is open to any signed-in account."""
    q = db.query(ApprovalTicket)
    if status_filter != "all":
        q = q.filter(ApprovalTicket.status == status_filter)
    tickets = q.order_by(ApprovalTicket.created_at.desc()).limit(200).all()
    return [_ticket_brief(t) for t in tickets]

@app.post("/admin/tickets/{ticket_id}/approve")
def approve_ticket(ticket_id: str, decision: TicketDecision = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(current_user)
    ticket = db.query(ApprovalTicket).filter(ApprovalTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    if ticket.status != "pending":
        raise HTTPException(status_code=409, detail=f"Ticket already {ticket.status}.")

    payload = json.loads(ticket.payload_json or "{}")
    admin_name = get_full_name(current_user)

    # SECOND-KEY RULE: nobody approves their own request, not even an Admin.
    # (Rejecting your own ticket is still allowed; withdrawing is fine.)
    if ticket.created_by and ticket.created_by.strip().upper() == admin_name.strip().upper():
        raise HTTPException(status_code=403,
                            detail="You filed this ticket. Only a different Admin can approve it.")
    if ticket.ticket_type == "user_deactivate" and not bool(payload.get("is_active", True)):
        # The TARGET may approve their own deactivation (consent: A files it,
        # B accepts being switched off, the other admin keeps the office
        # alive). What must never happen is losing the LAST active Admin.
        target_check = db.query(User).filter(User.username == str(payload.get("username", ""))).first()
        if target_check and target_check.role == "Admin":
            others = db.query(User).filter(
                User.role == "Admin",
                User.is_deactivated == False,
                User.id != target_check.id,
            ).count()
            if others == 0:
                raise HTTPException(status_code=403,
                                    detail="This would switch off the last active Admin. Reactivate another Admin first.")
    if ticket.ticket_type == "route_delete":
        route_to_delete = payload.get("route", "")
        records = db.query(FranchiseRecord).filter(FranchiseRecord.route == route_to_delete).all()
        count = 0
        for r in records:
            if not r.is_deleted:
                r.is_deleted = True
                r.updated_at = get_pht_now()
                count += 1
        db.commit()
        invalidate_ml_cache(route_to_delete)
        clear_api_caches()
        ticket.result_note = f"Deleted {count} records in {route_to_delete}."
        log_action(db, admin_name, "DELETE_ROUTE", ticket.id, route_to_delete,
                   f"Approved ticket: deleted route '{route_to_delete}' ({count} records). Requested by {ticket.created_by}.")
    elif ticket.ticket_type == "route_rename":
        old_route = payload.get("route", "")
        new_route = alias_route(payload.get("new_route_name", ""))
        new_prefix = str(payload.get("new_prefix", "")).strip().upper()
        new_driving = str(payload.get("new_driving_route", "")).strip().upper()
        records = db.query(FranchiseRecord).filter(FranchiseRecord.route == old_route, FranchiseRecord.is_deleted == False).all()
        if not records:
            ticket.status = "rejected"
            ticket.decided_by = admin_name
            ticket.decided_at = get_pht_now()
            ticket.result_note = "Rejected automatically: the route has no active records anymore."
            db.commit()
            raise HTTPException(status_code=404, detail="Route has no active records; ticket rejected automatically.")
        count = 0
        for r in records:
            r.route = new_route
            if new_driving:
                r.driving_route = new_driving
            if new_prefix:
                sbn_int = extract_sbn_integer(r.sbn_no)
                if sbn_int is not None:
                    padding = 4 if sbn_int >= 1000 else 3
                    base_sbn = f"{new_prefix}-{sbn_int:0{padding}d}"
                    is_vacant = not r.operator_name or str(r.operator_name).strip() == ""
                    r.sbn_no = format_sbn_with_year(base_sbn, r.issue_date, is_vacant)
            r.updated_at = get_pht_now()
            count += 1
        old_route_info = db.query(RouteData).filter(RouteData.route_name == old_route).first()
        if old_route_info and old_route != new_route:
            new_route_info = db.query(RouteData).filter(RouteData.route_name == new_route).first()
            if not new_route_info:
                db.add(RouteData(route_name=new_route, population=old_route_info.population, road_length_km=old_route_info.road_length_km))
            db.delete(old_route_info)
        db.commit()
        invalidate_ml_cache(old_route)
        invalidate_ml_cache(new_route)
        clear_api_caches()
        ticket.result_note = f"Renamed {count} records: {old_route} is now {new_route}."
        log_action(db, admin_name, "RENAME_ROUTE", ticket.id, new_route,
                   f"Approved ticket: renamed {old_route} to {new_route} ({count} records). Requested by {ticket.created_by}.")
    elif ticket.ticket_type == "record_restore":
        record_ids = payload.get("record_ids", [])
        restored = 0
        already_back = 0
        restored_routes = set()
        for rid in record_ids:
            rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == rid).first()
            if rec and rec.is_deleted:
                rec.is_deleted = False
                rec.updated_at = get_pht_now()
                restored += 1
                restored_routes.add(rec.route)
            elif rec and not rec.is_deleted:
                already_back += 1
            # CHANGE: the restore bumps updated_at on purpose — the restored
            # row re-appears in every office computer's next signed pull
            # (/api/sync/pull fetches rows with updated_at after the caller's
            # watermark), so LAN sync carries the restore for free.
        db.commit()
        for rl in restored_routes:
            invalidate_ml_cache(rl)
        clear_api_caches()
        ticket.result_note = (
            f"Restored {restored} record(s)."
            if restored > 0
            else ("All records in this request were already back in the registry (restored directly)."
                  if already_back > 0 else "No restorable record found for this request.")
        )
        log_action(db, admin_name, "RESTORE_APPROVED", ticket.id, "SYSTEM",
                   f"Approved ticket: restored {restored} record(s). Requested by {ticket.created_by}.")
        # PER-RECORD TRAIL: approval lands in each record's own History too,
        # where the clerk originally pressed "Request restore".
        for rid in record_ids:
            rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == rid).first()
            if rec:
                log_action(db, admin_name, "RESTORE_APPROVED", rec.id, rec.route,
                           f"Restore approved by ticket from {ticket.created_by}: record {rec.sbn_no} is back in the registry.")
    elif ticket.ticket_type == "user_deactivate":
        username = str(payload.get("username", ""))
        is_active = bool(payload.get("is_active"))
        target = db.query(User).filter(User.username == username).first()
        if not target:
            ticket.status = "rejected"
            ticket.decided_by = admin_name
            ticket.decided_at = get_pht_now()
            ticket.result_note = "Rejected automatically: the account no longer exists."
            db.commit()
            raise HTTPException(status_code=404, detail="Account no longer exists; ticket rejected automatically.")
        if not is_active and target.id == current_user.id:
            # Consented removal: the target admin approves being switched off
            # themselves; the filing admin stays active so the office keeps
            # a working Admin.
            pass
        target.is_deactivated = not is_active
        db.commit()
        # HEARTBEAT: the flag must reach the other office computers in seconds.
        sync_engine.notify_users_changed()
        if not is_active:
            _clear_persisted_lock(target.username, db)
            with _login_lock:
                _login_attempts.pop(target.username, None)
        verb = "deactivated" if not is_active else "reactivated"
        ticket.result_note = f"{verb.capitalize()} the account of {target.username}."
        log_action(db, admin_name, "DEACTIVATE_USER" if not is_active else "REACTIVATE_USER", ticket.id, "SYSTEM",
                   f"Approved ticket: {verb} the account of {target.username}. Requested by {ticket.created_by}.")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown ticket type: {ticket.ticket_type}")

    ticket.status = "approved"
    ticket.decided_by = admin_name
    ticket.decided_at = get_pht_now()
    db.commit()
    return {"status": "approved", "result_note": ticket.result_note}

@app.post("/admin/tickets/{ticket_id}/reject")
def reject_ticket(ticket_id: str, decision: TicketDecision = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(current_user)
    ticket = db.query(ApprovalTicket).filter(ApprovalTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    if ticket.status != "pending":
        raise HTTPException(status_code=409, detail=f"Ticket already {ticket.status}.")
    note = (decision.note if decision and decision.note else "") or "No reason given."
    ticket.status = "rejected"
    ticket.decided_by = get_full_name(current_user)
    ticket.decided_at = get_pht_now()
    ticket.result_note = note
    db.commit()
    # FULL CHAIN for restore requests: the rejection is logged BOTH as the
    # generic ticket event AND as RESTORE_REJECTED entries for every record
    # the request named, so the per-record History and the Activity Logs show
    # request -> decision for the exact records involved.
    if ticket.ticket_type == "record_restore":
        record_ids = json.loads(ticket.payload_json or "{}").get("record_ids", [])
        for rid in record_ids:
            rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == rid).first()
            if rec:
                log_action(db, get_full_name(current_user), "RESTORE_REJECTED", rec.id, rec.route,
                           f"Restore request rejected by {get_full_name(current_user)}: {note} (record {rec.sbn_no} stays in the Inactive list.)")
    log_action(db, get_full_name(current_user), "TICKET_REJECTED", ticket.id, "SYSTEM",
               f"Rejected {ticket.ticket_type} ticket from {ticket.created_by}: {note}")
    return {"status": "rejected", "result_note": ticket.result_note}

def _resolve_deleted_record_ids(db: Session, entries: list) -> list:
    """Accept mixed record ids / SBNs / base SBNs; return canonical ids of
    records that are CURRENTLY deleted (Year-suffix variants of a base SBN
    are all included, since one delete row can cover several of them)."""
    resolved, seen = [], set()
    for entry in entries:
        entry = str(entry or "").strip()
        if not entry:
            continue
        rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == entry).first()
        if rec and rec.is_deleted:
            if rec.id not in seen:
                seen.add(rec.id)
                resolved.append(rec.id)
            continue
        clean = normalize_base_sbn(entry)
        for rec in db.query(FranchiseRecord).filter(
                ((FranchiseRecord.sbn_no == clean) |
                 (FranchiseRecord.sbn_no == entry.upper()) |
                 (FranchiseRecord.sbn_no.like(f"{clean}-%"))) &
                (FranchiseRecord.is_deleted == True)).all():
            if rec.id not in seen:
                seen.add(rec.id)
                resolved.append(rec.id)
    return resolved


@app.post("/api/restore-records/ticket")
def file_restore_ticket(payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Bring back deleted records. Since the single-key decision
    (2026-10-14): an Admin restores DIRECTLY with a mandatory written reason
    recorded in the audit log; a Clerk files a restore ticket for the Admin,
    as before. Accepts record_ids (specific rows) or {'all': True} for every
    currently deleted record."""
    record_ids = payload.get("record_ids", [])
    want_all = bool(payload.get("all"))
    if not want_all and not record_ids:
        raise HTTPException(status_code=400, detail="Nothing to restore: pass record_ids or all=true.")

    require_record_writer(current_user)
    if want_all:
        record_ids = [r.id for r in db.query(FranchiseRecord).filter(FranchiseRecord.is_deleted == True).all()]

    # ENTRIES MAY BE SBNs: the Activity Logs delete rows carry the record's
    # SBN/base SBN in target_id, and the office writes tickets with what they
    # see on screen. Resolve every entry — id first, then SBN (including its
    # year-suffixed forms BAT-002-26) — to the canonical ids of records
    # CURRENTLY deleted. Unresolvable entries stop the request with an
    # honest 400 instead of silently restoring nothing.
    record_ids = _resolve_deleted_record_ids(db, record_ids)
    if not record_ids:
        raise HTTPException(status_code=400, detail="No currently deleted record matches those entries (they may already be restored).")

    # DIRECT EXECUTION (single-key rule): one written reason for the audit
    # log, then the restore runs.
    if current_user.role == "Admin":
        reason = (payload.get("override_reason") or "").strip()
        if not reason:
            raise HTTPException(status_code=400,
                                detail="Type a short reason for this restore so the audit log records why.")
        restored = 0
        for rid in record_ids:
            rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == rid).first()
            if rec and rec.is_deleted:
                rec.is_deleted = False
                rec.updated_at = get_pht_now()
                restored += 1
                # PER-RECORD TRAIL: RESTORE_DIRECT lands in the record's own
                # History, the Activity Logs, and rides the LAN sync via the
                # updated_at bump below.
                log_action(db, get_full_name(current_user), "RESTORE_DIRECT", rec.id, rec.route,
                           f"Restored directly by the Admin (no ticket needed). Reason: {reason}")
        db.commit()
        clear_api_caches()
        return {"status": "success", "message": f"Restored {restored} record(s)."}

    if db.query(ApprovalTicket).filter(ApprovalTicket.ticket_type == "record_restore",
                                       ApprovalTicket.status == "pending").first():
        raise HTTPException(status_code=409, detail="A restore ticket is already waiting for approval.")
    ticket = ApprovalTicket(
        created_by=get_full_name(current_user),
        ticket_type="record_restore",
        payload_json=json.dumps({"record_ids": record_ids}),
        reason=payload.get("reason") or payload.get("override_reason"),
    )
    db.add(ticket)
    db.commit()
    # FULL CHAIN IN THE TRAIL: the request itself names each record (id, SBN,
    # route), so the per-record History cards add a RESTORE_REQUEST entry the
    # moment the clerk files the request; approval/rejection add theirs later.
    log_action(db, get_full_name(current_user), "TICKET_FILED", ticket.id, "SYSTEM",
               f"Requested approval to restore {len(record_ids)} deleted record(s).")
    for rid in record_ids:
        rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == rid).first()
        if rec:
            log_action(db, get_full_name(current_user), "RESTORE_REQUEST", rec.id, rec.route,
                       f"Restore requested for record {rec.sbn_no}.")
    # The ticket went to the Admin queue, nothing executed yet — tell the
    # caller so the UI can say "waiting for approval" instead of guessing.
    return {"status": "ticket_filed",
            "message": f"Restore request sent to the Admin for approval ({len(record_ids)} record(s))."}


@app.post("/admin/refresh-db")
def refresh_database(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # The refresh rewrites SBNs, clears bad dates and merges duplicates across
    # the whole registry in one pass. Too sweeping for a clerk's normal day.
    require_admin(current_user)
    all_records = db.query(FranchiseRecord).filter(FranchiseRecord.is_deleted == False).all()
    route_sbn_map = {}
    deleted_count = 0
    updated_count = 0
    current_year = get_pht_now().year
    
    for r in all_records:
        r.route = alias_route(r.route) # Ensure silent fix
        
        sbn_str = str(r.sbn_no).strip().upper()
        sbn_int = extract_sbn_integer(sbn_str)
        if not sbn_str or sbn_int == 0:
            r.is_deleted = True
            r.updated_at = get_pht_now()
            deleted_count += 1
            continue
        
        clean_sbn = normalize_base_sbn(r.sbn_no)
        if r.sbn_no != clean_sbn:
            r.sbn_no = clean_sbn
            updated_count += 1

        if r.issue_date and r.issue_date.month == 1 and r.issue_date.day == 1 and r.issue_date.year == current_year:
            r.issue_date = None
            r.valid_until = None
            r.is_active = False
            updated_count += 1
        
        is_vacant = not r.operator_name or str(r.operator_name).strip() == ""
        if is_vacant:
            if r.is_active != False or r.issue_date is not None:
                r.is_active = False
                r.issue_date = None
                r.valid_until = None
                updated_count += 1
        
        key = (r.route, clean_sbn)
        if key not in route_sbn_map:
            route_sbn_map[key] = r
        else:
            existing = route_sbn_map[key]
            existing_year = get_record_year(existing.issue_date)
            current_year_val = get_record_year(r.issue_date)
            
            if current_year_val > existing_year:
                existing.is_deleted = True
                existing.updated_at = get_pht_now()
                route_sbn_map[key] = r
                deleted_count += 1
            elif current_year_val == existing_year and (r.operator_name and str(r.operator_name).strip() and not str(existing.operator_name).strip()):
                existing.is_deleted = True
                existing.updated_at = get_pht_now()
                route_sbn_map[key] = r
                deleted_count += 1
            else:
                r.is_deleted = True
                r.updated_at = get_pht_now()
                deleted_count += 1
    
    for key, record in route_sbn_map.items():
        is_vacant = not record.operator_name or str(record.operator_name).strip() == ""
        record.sbn_no = format_sbn_with_year(record.sbn_no, record.issue_date, is_vacant)

    unique_routes = {r.route for r in route_sbn_map.values()}
    for r_name in unique_routes:
        dom_route = get_dominant_driving_route(db, r_name)
        if dom_route:
            for r in route_sbn_map.values():
                if r.route == r_name:
                    curr_dr = str(r.driving_route).strip().upper() if r.driving_route else ""
                    if curr_dr == "" or (curr_dr == "POBLACION" and dom_route != "POBLACION"):
                        r.driving_route = dom_route

    db.commit()
    invalidate_ml_cache() 
    clear_api_caches()
    log_action(db, get_full_name(current_user), "REFRESH_DB", "0", "ALL", f"Fixed wrong dates and route names, and removed {deleted_count} duplicate entries.")
    return {
        "status": "success",
        "message": f"Finished. Removed {deleted_count} duplicate records. Remaining records: {len(route_sbn_map)}."
    }

@app.post("/signup")
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    # 25010 Characteristic: Security — bootstrapping-only registration.
    # The API listens on the whole LAN (0.0.0.0, required by the sync engine), so an
    # always-open signup would let any nearby device mint accounts. First-run only:
    # once an account exists, registration answers 403 and accounts are made by an
    # authenticated admin. New admins are provisioned by promoting an existing
    # account in the users table (UPDATE users SET role='Admin'), then that admin
    # creates Clerks through the app.
    user_count = db.query(User).count()
    if user_count > 0:
        raise HTTPException(status_code=403, detail="Registration is closed. Ask an administrator to create your account.")
    if payload.role != "Clerk":
        raise HTTPException(status_code=400, detail="Only Clerk accounts can be self-registered.")
    # The signup screen asks twice on purpose: the very first password typed
    # here is the one that later unlocks admin bootstrap, and there is no
    # password recovery before an admin exists to reset it. A silent typo at
    # this step would lock the whole installation out.
    if payload.password_confirm is not None and payload.password != payload.password_confirm:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    username_upper = payload.username.upper()
    if db.query(User).filter(User.username == username_upper).first():
        raise HTTPException(status_code=400, detail="Username taken")
    new_user = User(
        first_name=payload.first_name.upper(),
        last_name=payload.last_name.upper(),
        username=username_upper,
        password_hash=pwd_context.hash(payload.password),
        role="Clerk"
    )
    db.add(new_user)
    db.commit()
    # HEARTBEAT: the first account must reach every other office computer
    # immediately, or their next sync cycle would still be the clock.
    sync_engine.notify_users_changed()
    log_action(db, "SYSTEM", "USER_REGISTRATION", "0", "SYSTEM", f"Registered first-run account for {username_upper}")
    return {"message": "Account created"}

@app.get("/signup/open")
def signup_open(db: Session = Depends(get_db)):
    # Lets the login page hide the Register link once an account exists, so
    # nobody clicks a button that can only ever answer 403. Reveals nothing
    # sensitive: just whether first-run registration is still possible.
    return {"open": db.query(User).count() == 0}

# --- LOGIN RATE LIMITING & ACCOUNT LOCKOUT ---
# 25010 Characteristic: Security.
# Mabilis na counter sa memorya + AKTIBONG lock na naka-mirror sa SQLite
# (login_lockouts table). Dati, memorya lang: restart ng backend = reset ng
# lock, kaya puwedeng i-reset ng attacker ang brute-force sa pamamagitan ng
# paulit-ulit na restart. Ngayon, pagkatapos ng restart, babasahin mula sa DB
# ang aktibong lock BAGO kahit isang password attempt. Local SQLite lang —
# walang internet, walang migration step (CREATE TABLE IF NOT EXISTS sa
# unang login), at ang expired na lock ay kusang binubura para hindi
# ma-stuck ang lehitimong user o umipon ang lumang failure count.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_SECONDS = 15 * 60
_login_attempts = {}
_login_lock = threading.Lock()

def _ensure_lock_table(db: Session) -> bool:
    """Tinitiyak na mayroong login_lockouts table sa kasalukuyang database.
    Nililikha sa unang paggamit kada database kaya gumagana pa rin ang mga
    test na may sariling test DB, at walang kailangang migration sa mga
    existing na installation. CREATE TABLE IF NOT EXISTS lang ito kada tawag —
    mura sa SQLite at hindi bumibitaw kapag pinalitan ang database file."""
    try:
        db.execute(text(
            "CREATE TABLE IF NOT EXISTS login_lockouts ("
            "username VARCHAR PRIMARY KEY, "
            "failed_count INTEGER NOT NULL DEFAULT 0, "
            "locked_until REAL)"
        ))
        db.commit()
        return True
    except Exception as e:
        force_log(f"Login lockout table unavailable (RAM counter still active): {e}")
        return False

def _persist_lock(username: str, failed: int, locked_until: float, db: Session):
    """Best-effort na pagsulat ng lock state sa DB (wall-clock time)."""
    try:
        if not _ensure_lock_table(db):
            return
        db.execute(text(
            "INSERT INTO login_lockouts (username, failed_count, locked_until) "
            "VALUES (:u, :f, :l) "
            "ON CONFLICT(username) DO UPDATE SET failed_count=:f, locked_until=:l"
        ), {"u": username, "f": failed, "l": locked_until})
        db.commit()
    except Exception as e:
        force_log(f"Login lockout persistence skipped (RAM counter still active): {e}")

def _load_persisted_lock(username: str, db: Session):
    """Bumabalik na (failed_count, wall_clock_locked_until) mula sa DB, o (0, 0)."""
    try:
        if not _ensure_lock_table(db):
            return 0, 0.0
        row = db.execute(text(
            "SELECT failed_count, locked_until FROM login_lockouts WHERE username = :u"
        ), {"u": username}).fetchone()
        if not row:
            return 0, 0.0
        failed, locked_until = int(row[0] or 0), float(row[1] or 0)
        if locked_until and locked_until <= time.time():
            # Lumipas na ang lock habang naka-shutdown: burahin para malinis
            # ang susunod na pag-detected ng attack at hindi manatili ang lumang count.
            _clear_persisted_lock(username, db)
            return 0, 0.0
        return failed, locked_until
    except Exception as e:
        force_log(f"Login lockout read skipped (RAM counter still active): {e}")
        return 0, 0.0

def _clear_persisted_lock(username: str, db: Session):
    """Binubura ang mirror sa DB (tamang login o expired na lock)."""
    try:
        if not _ensure_lock_table(db):
            return
        db.execute(text("DELETE FROM login_lockouts WHERE username = :u"), {"u": username})
        db.commit()
    except Exception as e:
        force_log(f"Login lockout cleanup skipped: {e}")

def _get_lock_state(username: str, db: Session = None):
    """Returns (failed_count, seconds_left). (0, 0) kapag walang lock.
    Kapag walang entry sa RAM (hal. pagkatapos ng restart), ibinabalik ang
    lock mula sa DB bago magpatuloy."""
    with _login_lock:
        entry = _login_attempts.get(username)
        if entry:
            failed, locked_until = entry
            now = time.monotonic()
            if locked_until and now < locked_until:
                return failed, int(locked_until - now) + 1
            return failed, 0
    # WALANG entry sa RAM — tingnan ang DB (restart-proof na lock).
    if db is not None:
        failed, wall_until = _load_persisted_lock(username, db)
        if wall_until > time.time():
            monotonic_until = time.monotonic() + (wall_until - time.time())
            with _login_lock:
                current = _login_attempts.get(username)
                if not current or current[1] < monotonic_until:
                    _login_attempts[username] = (failed, monotonic_until)
            return failed, int(wall_until - time.time()) + 1
    return 0, 0

def _register_failed_login(username: str, db: Session = None):
    with _login_lock:
        failed, _ = _login_attempts.get(username, (0, 0))
        failed += 1
        locked_until = time.monotonic() + LOGIN_LOCKOUT_SECONDS if failed >= LOGIN_MAX_ATTEMPTS else 0
        _login_attempts[username] = (failed, locked_until)
    if db is not None:
        # I-mirror ang aktibong lock sa DB (wall-clock) para survibahin ang restart.
        _persist_lock(username, failed, time.time() + (locked_until - time.monotonic() if locked_until else 0), db)

@app.post("/token")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    username_upper = payload.username.upper()
    
    # 1. Account lockout check — bago kahit anong password attempt.
    #    dala ang db para mabawi ang lock mula sa DB pagkatapos ng restart.
    failed_count, seconds_left = _get_lock_state(username_upper, db)
    if seconds_left > 0:
        mins = max(1, seconds_left // 60)
        log_action(
            db, username_upper, "LOGIN_BLOCKED", "0", "SYSTEM",
            f"Login attempt blocked: account locked. Try again in {mins} minute(s).",
            ip_or_source=payload.username
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Account locked. Try again in {mins} minute(s)."
        )
    
    user = db.query(User).filter(User.username == username_upper).first()
    if user is not None and getattr(user, "is_deactivated", False):
        # A deactivated account cannot sign in even with the right password.
        # The message says so plainly: the alternative is the clerk and the
        # admin chasing a phantom wrong-password problem, and the attempt is
        # audit-logged here anyway.
        log_action(db, username_upper, "LOGIN_BLOCKED", "0", "SYSTEM",
                   "Sign-in refused: this account is deactivated.",
                   ip_or_source=payload.username)
        raise HTTPException(status_code=401, detail="This account has been deactivated by the Admin.")
    if not user or not pwd_context.verify(payload.password, user.password_hash):
        # DIAGNOSTIC: a failed login on THIS machine even though "true creds"
        # nearly always means the local copy of the account is stale — most
        # often a SYNCED_NO_PASSWORD stub, or a hash that never roamed because
        # the peer pull chain was broken. Say WHY in the crash log so the
        # office can tell "wrong password" from "sync never delivered".
        if user is None:
            force_log(
                f"[LOGIN] failed for '{username_upper}': account NOT FOUND "
                "in this computer's database (never synced or never created "
                "here).")
        elif user.password_hash == "SYNCED_NO_PASSWORD":
            force_log(
                f"[LOGIN] failed for '{username_upper}': account exists but "
                "carries the no-password sync stub; the real bcrypt hash "
                "never arrived from the computer that owns the account.")
        else:
            force_log(
                f"[LOGIN] failed for '{username_upper}': password mismatch "
                "on the local copy (likely a stale hash — check the owning "
                "computer's Connections tab for a working sync).")
        # 2. Failed attempt — i-record at i-lock kapag umabot na sa limit
        #    (i-mirror din sa DB para hindi mabura ng restart).
        _register_failed_login(username_upper, db)
        new_failed, locked = _get_lock_state(username_upper)
        if locked > 0:
            log_action(
                db, username_upper, "LOGIN_LOCKED", "0", "SYSTEM",
                f"Account locked after {new_failed} failed login attempts. Auto-unlocks in {LOGIN_LOCKOUT_SECONDS // 60} minutes.",
                ip_or_source=payload.username
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Account locked for {LOGIN_LOCKOUT_SECONDS // 60} minutes."
            )
        remaining = LOGIN_MAX_ATTEMPTS - new_failed
        raise HTTPException(status_code=400, detail=f"Incorrect credentials. {remaining} attempt(s) left before lockout.")
    
    # 3. Success — burahin ang failure counter (RAM at DB mirror).
    with _login_lock:
        _login_attempts.pop(username_upper, None)
    _clear_persisted_lock(username_upper, db)
    
    full_name = get_full_name(user)
    access_token = create_access_token(data={"sub": username_upper})
    
    log_action(db, full_name, "LOGIN", "0", "SYSTEM", "Successful authentication")
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "full_name": full_name, 
        "role": user.role
    }

@app.get("/login/hint")
def login_hint(username: str, db: Session = Depends(get_db)):
    # LOGIN-SUCCESS PROBE: answers whether a correct password on THIS machine
    # would verify. Used by the frontend right before showing "incorrect
    # credentials" so the screen can say WHY signing in failed — a synced
    # account with a no-password stub (hash never roamed) or an account this
    # computer has never heard of read completely differently from a wrong
    # password, and the difference is what the office needs to act on.
    # Reveals nothing sensitive: like /signup/open and /recovery/questions,
    # it only reflects whether a named account can sign in here, and callers
    # already know the login just failed.
    canonical = username.strip().upper()
    row = db.query(User).filter(User.username == canonical).first()
    if row is None:
        return {"outcome": "unknown-account"}
    if getattr(row, "is_deactivated", False):
        return {"outcome": "deactivated"}
    if row.password_hash == "SYNCED_NO_PASSWORD":
        return {"outcome": "no-password-stub"}
    try:
        probe = pwd_context.verify("__pasada_probe__", row.password_hash)
    except (ValueError, TypeError):
        # A corrupt or non-bcrypt hash string must surface as a diagnosis,
        # not a 500: this endpoint exists to explain broken accounts.
        return {"outcome": "unverifiable-hash"}
    return {"outcome": "wrong-password" if probe is False else "unexpected"}

# --- ACCOUNT RECOVERY (SECURITY QUESTIONS) ---
# 25010 Characteristic: Security + Usability.
# A clerk who forgets their password recovers the account on this computer by
# answering their three security questions. Only bcrypt hashes of the answers
# are stored, the flow is rate-limited like login, and every step is written
# to the audit log WITHOUT the answer text.
RECOVERY_MAX_ATTEMPTS = 5
RECOVERY_LOCKOUT_SECONDS = 15 * 60
_recovery_attempts = {}
_recovery_lock = threading.Lock()

class RecoverySetup(BaseModel):
    q1: str
    q2: str
    q3: str
    a1: str
    a2: str
    a3: str

class RecoveryQuestions(BaseModel):
    username: str

class RecoveryAnswers(BaseModel):
    username: str
    a1: str
    a2: str
    a3: str
    new_password: str

def _recovery_guard(username: str):
    """Shared rate limiter for the two recovery endpoints."""
    with _recovery_lock:
        failed, locked_until = _recovery_attempts.get(username, (0, 0))
        now = time.monotonic()
        if locked_until and now < locked_until:
            mins = max(1, int(locked_until - now) // 60)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many recovery attempts. Try again in {mins} minute(s)."
            )
        return failed

def _recovery_fail(username: str, db: Session, stage: str):
    with _recovery_lock:
        failed, _ = _recovery_attempts.get(username, (0, 0))
        failed += 1
        locked_until = time.monotonic() + RECOVERY_LOCKOUT_SECONDS if failed >= RECOVERY_MAX_ATTEMPTS else 0
        _recovery_attempts[username] = (failed, locked_until)
    log_action(db, username, "RECOVERY_FAILED", "0", "SYSTEM", f"Account recovery failed at {stage}.")
    if failed >= RECOVERY_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many recovery attempts. Locked for {RECOVERY_LOCKOUT_SECONDS // 60} minutes."
        )
    remaining = RECOVERY_MAX_ATTEMPTS - failed
    raise HTTPException(status_code=400, detail=f"Incorrect answer(s). {remaining} attempt(s) left before lockout.")

def _recovery_ok(username: str, db: Session, stage: str):
    with _recovery_lock:
        _recovery_attempts.pop(username, None)
    log_action(db, username, "RECOVERY_STEP", "0", "SYSTEM", f"Account recovery passed {stage}.")

def _normalize_answer(answer: str) -> str:
    return " ".join(answer.strip().lower().split())

@app.get("/recovery/questions")
def get_recovery_questions(username: str, db: Session = Depends(get_db)):
    # Step 1 of recovery: hand back ONLY the question texts, never answers.
    # A wrong username gets the same empty list as one without recovery set:
    # do not reveal which accounts exist.
    username_upper = username.strip().upper()
    _recovery_guard(username_upper)
    user = db.query(User).filter(User.username == username_upper).first()
    if not user or not (user.security_q1 and user.security_q2 and user.security_q3):
        raise HTTPException(status_code=404, detail="No security questions are set up for this account. Ask an administrator to reset your password on this computer.")
    _recovery_ok(username_upper, db, "username lookup")
    return {"q1": user.security_q1, "q2": user.security_q2, "q3": user.security_q3}

@app.post("/recovery/reset")
def recovery_reset(payload: RecoveryAnswers, db: Session = Depends(get_db)):
    # Step 2: verify all three answers (case-insensitive, whitespace-tolerant)
    # and set the new password. Verification uses constant-time bcrypt verify
    # per answer; a wrong username counts the same as a wrong answer.
    username_upper = payload.username.strip().upper()
    _recovery_guard(username_upper)
    user = db.query(User).filter(User.username == username_upper).first()
    # LAST-RESORT ADMIN RECOVERY. Security questions are stored only on the
    # machine that set them, so an office whose accounts arrived through LAN
    # sync has no in-app way to regain administrator access once every admin
    # account is lost. While NO Admin exists anywhere, answering an account's
    # three questions correctly also promotes that account to Admin. Same
    # three proofs, same lockout; the account must already have its own
    # password. Once any Admin exists this valve stays closed.
    promote_to_admin = bool(
        user
        and user.password_hash
        and user.password_hash != "SYNCED_NO_PASSWORD"
        and len(_active_admins(db)) == 0
    )
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    answers = [_normalize_answer(payload.a1), _normalize_answer(payload.a2), _normalize_answer(payload.a3)]
    if not user or not user.security_a1_hash:
        _recovery_fail(username_upper, db, "answer check")
    stored = [user.security_a1_hash, user.security_a2_hash, user.security_a3_hash]
    all_correct = True
    for answer, a_hash in zip(answers, stored):
        try:
            if not a_hash or not pwd_context.verify(answer, a_hash):
                all_correct = False
        except Exception:
            all_correct = False
    if not all_correct:
        _recovery_fail(username_upper, db, "answer check")
    user.password_hash = pwd_context.hash(payload.new_password)
    if promote_to_admin:
        user.role = "Admin"
    db.commit()
    # HEARTBEAT: the password reset (and any promotion) must reach the other
    # office computers in seconds, not on the next sync cycle.
    sync_engine.notify_users_changed()
    # The recovery reset must also clear a stale login lockout: this path
    # exists for offices with no Admin to do it manually, and a locked
    # account that just proved its identity should be able to sign in now.
    _clear_persisted_lock(username_upper, db)
    with _login_lock:
        _login_attempts.pop(username_upper, None)
    _recovery_ok(username_upper, db, "password reset")
    log_action(db, username_upper, "PASSWORD_RESET", "0", "SYSTEM", "Password reset via security questions on this computer.")
    if promote_to_admin:
        log_action(db, username_upper, "ADMIN_RESTORED", "0", "SYSTEM",
                   "No Admin exists in the office. The recovered account was promoted to Admin (last-resort path).")
        return {"status": "success", "message": "Password updated and this account is now the office Admin. You can now sign in with the new password."}
    return {"status": "success", "message": "Password updated. You can now sign in with the new password."}

@app.put("/recovery/setup")
def recovery_setup(payload: RecoverySetup, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Signed-in users set or replace their recovery questions from Settings.
    # Answers are normalized then bcrypt-hashed; the plaintext is never stored
    # or logged.
    questions = [payload.q1.strip(), payload.q2.strip(), payload.q3.strip()]
    answers = [_normalize_answer(a) for a in (payload.a1, payload.a2, payload.a3)]
    if not all(questions) or not all(answers):
        raise HTTPException(status_code=400, detail="All three questions and answers are required.")
    if any(len(a) < 2 for a in answers):
        raise HTTPException(status_code=400, detail="Answers must be at least 2 characters.")
    current_user.security_q1 = questions[0]
    current_user.security_q2 = questions[1]
    current_user.security_q3 = questions[2]
    current_user.security_a1_hash = pwd_context.hash(answers[0])
    current_user.security_a2_hash = pwd_context.hash(answers[1])
    current_user.security_a3_hash = pwd_context.hash(answers[2])
    db.commit()
    log_action(db, get_full_name(current_user), "UPDATE_SECURITY", "0", "SYSTEM", "Set account recovery security questions.")
    return {"status": "success", "message": "Recovery questions saved."}

@app.get("/recovery/status")
def recovery_status(current_user: User = Depends(get_current_user)):
    # Settings card shows whether recovery is configured; questions are sent
    # back so editing is easy. Answer hashes never leave the server.
    return {
        "configured": bool(current_user.security_q1 and current_user.security_a1_hash),
        "q1": current_user.security_q1 or "",
        "q2": current_user.security_q2 or "",
        "q3": current_user.security_q3 or "",
    }

@app.put("/users/password")
def update_password(payload: PasswordUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    current_user.password_hash = pwd_context.hash(payload.new_password)
    db.commit()
    # HEARTBEAT: the password roams, so wake the other computers to pull it.
    sync_engine.notify_users_changed()
    log_action(db, get_full_name(current_user), "UPDATE_SECURITY", "0", "SYSTEM", "Updated account password")
    return {"status": "success"}

@app.put("/users/username")
def update_username(payload: UsernameUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == payload.new_username.upper()).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    
    old_username = current_user.username
    current_user.username = payload.new_username.upper()
    db.commit()
    # HEARTBEAT: username changes roam with the account; wake the others now.
    sync_engine.notify_users_changed()
    
    log_action(db, get_full_name(current_user), "UPDATE_USERNAME", "0", "SYSTEM", f"Changed username from {old_username} to {payload.new_username.upper()}")
    return {"status": "success"}

# --- ADMIN BOOTSTRAP (the "no admin exists" problem) ---
# Registration closes once ANY account exists, so an office that started with
# a Clerk has no Admin and no way to make one from inside the app: the fix is
# a one-time, self-service bootstrap. When no Admin exists, the FIRST signed-in
# account may promote itself by proving it knows its own password. When an
# Admin already exists the endpoint always answers 403, so it can never be
# used to mint a second admin without the real admin's approval (that path is
# the Manage Accounts panel). The whole attempt is written to the audit log,
# including the rejected ones, so a sneaky self-promotion leaves a trace.
class AdminBootstrap(BaseModel):
    password: str

class UserSetActive(BaseModel):
    username: str
    # Deactivate or reactivate an account. true = active again, false = off.
    is_active: bool
    # Only used when the office has a single active Admin (two-key rule): the
    # direct execution then demands a written reason.
    override_reason: str = ""

@app.get("/admin/needed")
def admin_needed(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"needed": db.query(User).filter(User.role == "Admin").count() == 0}

@app.post("/admin/bootstrap")
def admin_bootstrap(payload: AdminBootstrap, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if _active_admins(db):
        log_action(db, get_full_name(current_user), "ADMIN_BOOTSTRAP_DENIED", "0", "SYSTEM",
                   "Bootstrap refused: an Admin already exists.")
        raise HTTPException(status_code=403, detail="An Admin account already exists. Ask that Admin to manage accounts.")
    if not pwd_context.verify(payload.password, current_user.password_hash or ""):
        log_action(db, get_full_name(current_user), "ADMIN_BOOTSTRAP_DENIED", "0", "SYSTEM",
                   "Bootstrap refused: password did not match.")
        raise HTTPException(status_code=401, detail="Password did not match this account.")
    current_user.role = "Admin"
    db.commit()
    # HEARTBEAT: role changes roam, so wake the other computers now.
    sync_engine.notify_users_changed()
    log_action(db, get_full_name(current_user), "ADMIN_BOOTSTRAP", "0", "SYSTEM",
               f"First-run bootstrap: {current_user.username} became the office Admin.")
    return {"status": "success", "role": "Admin", "message": f"{current_user.username} is now the office Admin."}

# --- ADMIN USER MANAGEMENT ---
# 25010 Characteristic: Functional Suitability. Registration closes after the
# first-run account exists, and synced accounts used to be log-in-only stubs,
# which left an office with NO way to add a clerk or fix a forgotten password
# from another computer. These Admin-only endpoints close that gap; every
# action lands in the audit log. Password resets also clear any login-lockout
# mirror so a reset user is not greeted by a stale 15-minute lock.
@app.get("/users")
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(current_user)
    users = db.query(User).order_by(User.username).all()
    # LOGIN rows are written with the signer's full name, so one lookup maps
    # each account to its most recent successful sign-in. Accounts that never
    # signed in (freshly created, or password-pending sync stubs) show None.
    login_times = dict(
        db.query(AuditLog.clerk_name, func.max(AuditLog.timestamp))
        .filter(AuditLog.action == "LOGIN")
        .group_by(AuditLog.clerk_name)
        .all()
    )
    return [
        {"username": u.username, "full_name": get_full_name(u), "role": u.role,
         "has_password": bool(u.password_hash) and u.password_hash != "SYNCED_NO_PASSWORD",
         "is_deactivated": bool(getattr(u, "is_deactivated", False)),
         "last_login": login_times[get_full_name(u)].isoformat() if login_times.get(get_full_name(u)) else None}
        for u in users
    ]

@app.post("/users")
def admin_create_user(payload: UserCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(current_user)
    if payload.role not in ("Admin", "Clerk", "Viewer"):
        raise HTTPException(status_code=400, detail="Role must be Admin, Clerk, or Viewer")
    if payload.password_confirm is not None and payload.password != payload.password_confirm:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    username_upper = payload.username.strip().upper()
    if not username_upper:
        raise HTTPException(status_code=400, detail="Username is required")
    if db.query(User).filter(User.username == username_upper).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    new_user = User(
        first_name=payload.first_name.strip().upper(),
        last_name=payload.last_name.strip().upper(),
        username=username_upper,
        password_hash=pwd_context.hash(payload.password),
        role=payload.role,
    )
    db.add(new_user)
    db.commit()
    # HEARTBEAT: the new account can sign in on every computer, so wake the
    # others to pull it immediately.
    sync_engine.notify_users_changed()
    log_action(db, get_full_name(current_user), "CREATE_USER", "0", "SYSTEM", f"Admin created {payload.role} account {username_upper}")
    return {"status": "success", "message": f"Account {username_upper} created."}

@app.put("/users/reset-password")
def admin_reset_password(payload: AdminPasswordReset, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(current_user)
    if payload.password_confirm is not None and payload.new_password != payload.password_confirm:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    target = db.query(User).filter(User.username == payload.username.strip().upper()).first()
    if not target:
        raise HTTPException(status_code=404, detail="Account not found")
    target.password_hash = pwd_context.hash(payload.new_password)
    db.commit()
    # HEARTBEAT: the old password must die everywhere within seconds.
    sync_engine.notify_users_changed()
    _clear_persisted_lock(target.username, db)
    with _login_lock:
        _login_attempts.pop(target.username, None)
    log_action(db, get_full_name(current_user), "RESET_PASSWORD", "0", "SYSTEM", f"Admin reset the password of {target.username}")
    return {"status": "success", "message": f"Password of {target.username} reset."}

@app.put("/users/set-active")
def admin_set_user_active(payload: UserSetActive, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # DEACTIVATE / REACTIVATE. Deactivation switches an account off without
    # deleting it: the person's records, audit history, and settings stay
    # untouched, only sign-in is refused. Reactivation restores access.
    require_admin(current_user)
    if payload.is_active and current_user.is_deactivated:
        # A deactivated admin's old token must not be able to sign anyone in;
        # with this gate the request dies before the target is touched.
        raise HTTPException(status_code=403, detail="This account is deactivated. Ask another Admin to sign in.")
    target = db.query(User).filter(User.username == payload.username.strip().upper()).first()
    if not target:
        raise HTTPException(status_code=404, detail="Account not found")
    if target.id == current_user.id:
        # This rule is what guarantees every office always keeps at least one
        # active Admin: whoever acts must be an active Admin, and an active
        # Admin cannot switch off their own account, so the last active Admin
        # can never be deactivated through the API.
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account while signed in to it.")

    # DIRECT EXECUTION (single-key rule, 2026-10-14): switching an account
    # off or back on runs right away — no second-Admin ticket — and the
    # mandatory written reason is recorded in the audit log.
    reason = (payload.override_reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400,
                            detail="Type a short reason so the audit log records why this account is being switched.")
    target.is_deactivated = not payload.is_active
    db.commit()
    # HEARTBEAT: a deactivated clerk must not be able to dodge the switch by
    # signing in on another computer; wake those computers to pull the flag now.
    sync_engine.notify_users_changed()
    if not payload.is_active:
        _clear_persisted_lock(target.username, db)
        with _login_lock:
            _login_attempts.pop(target.username, None)
        log_action(db, get_full_name(current_user), "DEACTIVATE_USER", "0", "SYSTEM",
                   f"Single-admin override: deactivated the account of {target.username}. Sign-in is refused until it is reactivated. Reason: {reason}")
        return {"status": "success",
                "message": f"{get_full_name(target)} is deactivated. History and records are kept; sign-in is refused."}
    log_action(db, get_full_name(current_user), "REACTIVATE_USER", "0", "SYSTEM",
               f"Single-admin override: reactivated the account of {target.username}. Reason: {reason}")
    return {"status": "success", "message": f"{get_full_name(target)} can sign in again."}

@app.get("/settings")
def get_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return init_settings(db)

@app.put("/settings")
def update_settings(settings: SettingsUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sys_settings = init_settings(db)
    sys_settings.committee_chair = settings.committee_chair
    db.commit()
    log_action(db, get_full_name(current_user), "UPDATE_SETTINGS", "0", "SYSTEM", "Updated Global Committee Settings")
    return {"status": "success"}

@app.get("/route_data/{route_name}")
def get_route_data(route_name: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # What the Route Info card on the dashboard shows before saving: the
    # values already stored for this route, or nothing when they were never
    # set (the 5000 / 5.0 the ML engine falls back to are defaults, not
    # saved values, so they are NOT shown as if the office entered them).
    route_name = alias_route(route_name)
    route_info = db.query(RouteData).filter(RouteData.route_name == route_name).first()
    if not route_info:
        return {"exists": False, "population": None, "road_length_km": None}
    return {"exists": True, "population": route_info.population, "road_length_km": route_info.road_length_km}

@app.post("/route_data/{route_name}")
def update_route_data(route_name: str, payload: RouteDataUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_record_writer(current_user)
    route_name = alias_route(route_name)
    route_info = db.query(RouteData).filter(RouteData.route_name == route_name).first()
    if not route_info:
        route_info = RouteData(route_name=route_name, population=payload.population, road_length_km=payload.road_length_km)
        db.add(route_info)
    else:
        route_info.population = payload.population
        route_info.road_length_km = payload.road_length_km
    db.commit()
    invalidate_ml_cache(route_name) 
    clear_api_caches()
    log_action(db, get_full_name(current_user), "UPDATE_ROUTE_DATA", "0", route_name, f"Updated X2 and X3 factors.")
    return {"status": "success", "message": f"Updated demographic data for {route_name}"}

@app.get("/system/network")
def get_network_status(current_user: User = Depends(get_current_user)):
    # TRUST SEMANTICS (Settings > Connections): PEERS is NOT a
    # "machines we heard anything from" list. An IP enters (and stays in)
    # this registry ONLY through an HMAC-verified packet — a discovery or
    # nudge broadcast signed with the SHARED CLUSTER SECRET, or a signed
    # pull that this machine ACCEPTED. A merely broadcasting machine with a
    # different key can never appear here, so every name/row the card shows
    # is a machine that provably holds the office's cluster key. Pull
    # health per row (miss streak, last heard) rides in peer_status below.
    # FRIENDLY NAMES: shown next to peer IPs in Settings > Connections. Names
    # are display only; trust is the HMAC cluster signature, so a lying name
    # grants nothing. First-seen wins per IP so one machine cannot flap its
    # name into someone else's row.
    peer_names = {}
    for ip in PEERS:
        name = sync_engine.PEER_NAMES.get(ip)
        if name:
            peer_names[ip] = name
    return {
        "local_ip": get_local_ip(),
        "connected_peers": list(PEERS),
        "peer_names": peer_names,
        "computer_name": sync_engine.COMPUTER_NAME,
        "last_sync_check": sync_engine.get_last_sync_check(),
        # Per-peer visibility for the Connections card: name, last heard,
        # pull-miss streak, registry state.
        "peer_status": sync_engine.get_peer_status(),
    }

@app.get("/api/sync/diagnostics")
def get_sync_diagnostics(current_user: User = Depends(get_current_user)):
    """WHY-NOTHING-IS-SYNCING REPORT (Settings > Connections card).

    The Connections card can look "alive" while nothing travels: a machine
    missing the cryptography entitlement can never pair, a turned-off
    auto-pairing switch hides the recovery path, an office whose computers
    hold different cluster keys reads an empty peer list, and a clock more
    than 5 minutes off refuses every packet. This snapshot names WHICH, so
    the office sees the reason instead of a dead green light — and the
    fingerprint lets two logs be compared without ever showing the key.
    Read-only: the same JWT auth as every other system endpoint; trust is
    never weakened here."""
    return {
        "crypto_ok": bool(sync_engine._CRYPTO_OK),
        "pairing_enabled": sync_engine.auto_pairing_enabled(),
        "secret_fingerprint": cluster_secret_fingerprint(),
        "peers": sorted(PEERS),
        "peer_status": sync_engine.get_peer_status(),
        "auto_pair_events": sync_engine.get_auto_pair_events(),
        "last_sync_check": get_last_sync_check(),
        "sync_port": sync_engine.SYNC_PORT,
        "api_port": sync_engine.API_PORT,
        "local_ip": get_local_ip(),
        "all_local_ips": sync_engine._local_ipv4_addresses(),
    }

# --- CLUSTER KEY ROTATION / IMPORT (Connections card) ---
# The live check can now NAME the fault "the two computers hold different
# cluster secrets"; these endpoints let the Admin fix it without reinstalling:
# rotate mints a fresh key here (returned once, never logged), every other
# computer then IMPORTs the same text by hand. AUTH MODEL: Admin-only, since
# whoever can set the key controls who joins the cluster. The key text is
# accepted back ONLY in the moment of rotation/import and is never persisted
# in logs, audit entries, or responses beyond the rotate response itself.
@app.get("/system/cluster-key")
def get_cluster_key_status(current_user: User = Depends(get_current_user)):
    """Fingerprint of the key this computer holds — display-safe (it cannot
    be reversed to the key). Two computers showing the same fingerprint hold
    the same key."""
    require_admin(current_user)
    return {"fingerprint": cluster_secret_fingerprint()}

@app.post("/system/cluster-key/rotate")
def rotate_cluster_key(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mint a fresh cluster key, adopt it live, and return its text ONCE so
    the Admin can hand-deliver it to the office's other computers."""
    require_admin(current_user)
    new_key = rotate_cluster_secret()
    log_action(db, get_full_name(current_user), "CLUSTER_KEY_ROTATE", "0", "SYSTEM",
               f"Rotated the cluster key (new fingerprint {cluster_secret_fingerprint()}). "
               "Other computers must import the new key text.")
    # Single delivery: the only response that ever carries the key text.
    return {"status": "success", "key": new_key,
            "fingerprint": cluster_secret_fingerprint(),
            "message": "New key minted. Import this exact text on every other office computer now."}

@app.post("/system/cluster-key/import")
def import_cluster_key(payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Adopt a hand-delivered cluster key. Succeeds only with the EXACT text
    the owning computer produced."""
    require_admin(current_user)
    raw = str(payload.get("key", ""))
    if not raw.strip():
        raise HTTPException(status_code=400, detail="Paste the new key text first.")
    adopted = import_cluster_secret(raw)
    if adopted is None:
        raise HTTPException(status_code=400, detail="That text does not look like a PASADA cluster key (32–200 characters). Copy it exactly from the Rotate computer.")
    log_action(db, get_full_name(current_user), "CLUSTER_KEY_IMPORT", "0", "SYSTEM",
               f"Imported a cluster key (fingerprint {cluster_secret_fingerprint()}).")
    return {"status": "success", "fingerprint": cluster_secret_fingerprint(),
            "message": "Key adopted. This computer now broadcasts with the new key."}

# --- PIN PAIRING (Connections card) ---
# The manual complement to auto-pairing: when the automatic handshake can't
# run (a Windows machine whose crypto wheel failed to load, AP-isolated
# Wi-Fi, a stubborn firewall) or the Admin simply wants to admit a new
# computer BY HAND, the host computer ARMS a 6-digit PIN for ten minutes
# and the joining computer types that same PIN. The cluster key then crosses
# the LAN inside an envelope the(joiner itself rolled (AES-GCM under
# SHA256(pin+salt)), so a sniffer holding neither the salt nor the PIN sees
# only ciphertext. Same auth model as rotate/import: Admin-only.
def generate_join_pin() -> str:
    """Six random digits (leading zeroes allowed) for the (host endpoint."""
    return "".join(secrets.choice("0123456789") for _ in range(6))

@app.get("/system/pairing-pin/status")
def pairing_pin_status(current_user: User = Depends(get_current_user)):
    """Display-safe armed state: no PIN is ever echoed back."""
    require_admin(current_user)
    status = pin_pairing_status()
    status.update({
        "computer_name": sync_engine.COMPUTER_NAME,
        "fingerprint": cluster_secret_fingerprint(),
    })
    return status

@app.post("/system/pairing-pin/arm")
def arm_pairing_pin_endpoint(payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Arms the Admin-chosen PIN (or a random one when omitted) for ten
    minutes. Returns the PIN ONCE — it is never stored or logged."""
    require_admin(current_user)
    try:
        if str(payload.get("pin", "")).strip() == "":
            chosen = generate_join_pin()
        else:
            chosen = str(payload["pin"])
        armed = arm_pairing_pin(chosen)
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # AUDIT: names the action, the actor and the expiry — never the digits.
    log_action(db, get_full_name(current_user), "PIN_PAIRING_ARMED", "0", "SYSTEM",
               "Armed the manual join PIN (expires in 10 minutes). "
               "Give the digits to the joining computer.")
    return {"status": "success", "pin": armed,
            "expires_in_seconds": pin_pairing_status()["expires_in_seconds"],
            "message": "PIN armed. Type it on the joining computer within 10 minutes."}

@app.post("/system/pairing-pin/clear")
def clear_pairing_pin_endpoint(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(current_user)
    cleared = clear_pairing_pin()
    if cleared:
        log_action(db, get_full_name(current_user), "PIN_PAIRING_CLEARED", "0", "SYSTEM",
                   "Cleared the armed join PIN early.")
    return {"status": "success", "armed": pin_pairing_status()["armed"]}

@app.post("/system/pairing-pin/join")
def join_via_pin_endpoint(payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Joiner computer: an Admin types the host's armed PIN here. Sends the
    encrypted challenge to the host (direct IP when given, LAN broadcast
    otherwise) and waits for a valid reply. On adoption the fingerprint is
    returned so the Admin can confirm both computers now agree."""
    require_admin(current_user)
    pin = str(payload.get("pin", "")).strip()
    host_ip = str(payload.get("host_ip", "") or "").strip()
    if host_ip:
        # The typed IP/host goes into a wire payload the sync engine sends —
        # accept only sane IPv4 literals or hostnames, never arbitrary text
        # someone could bend the UDP salvo with.
        import ipaddress as _ipaddress
        try:
            if not host_ip.replace(".", "").isdigit():
                raise ValueError
            _ipaddress.IPv4Address(host_ip)
        except ValueError:
            raise HTTPException(status_code=400,
                                detail="host_ip must be the other computer's IP address (for example 192.168.1.10).")
    try:
        request_pin_join(pin, host_ip or None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    joined = pin_join_was_successful()
    fingerprint = cluster_secret_fingerprint() if joined else ""
    log_action(db, get_full_name(current_user), "PIN_PAIRING_JOIN", "0", "SYSTEM",
               f"Attempted to join the cluster with a shared PIN (host: "
               f"{host_ip or 'office broadcast'}). "
               + ("Key adopted (fingerprint " + fingerprint + ")." if joined
                  else "No reply; the PIN may be wrong, expired, or the host unreachable."))
    return {"status": "success", "joined": joined, "fingerprint": fingerprint,
            "message": ("Joined the cluster. Verify that this fingerprint "
                        "matches on the other computer.") if joined else
                       ("No reply yet. Make sure the other computer has ARMED "
                        "a PIN (Connections > Pair a computer) and is on the "
                        "same network, then try again within 10 minutes.")}

@app.post("/system/sync-diagnostics")
def sync_diagnostics(current_user: User = Depends(get_current_user)):
    """LIVE CONNECTION CHECK (Connections card > "Test computers now").

    Runs one real signed pull against every peer the registry currently
    knows and returns the exact reason each one failed (timeout, refused,
    signature rejected 403, HTTP status) instead of the background loop's
    aggregate miss counter. Diagnostic only: pulls results are discarded, no
    local state changes hands, and the audit log records who ran it."""
    require_admin(current_user)
    results = []
    # SELF CHECK: pocket-money-laptop failure modes named plainly — can this
    # machine RECEIVE on its own ports before any peer is asked anything?
    lst = sync_engine.get_listener_state()
    if lst["error"]:
        _fw_hint = ("On Linux run: sudo ufw allow " + str(lst["port"]) + "/udp. "
                    "On Windows run (admin PowerShell): netsh advfirewall firewall "
                    "add rule name=\"PASADA Sync\" dir=in action=allow protocol=UDP localport="
                    + str(lst["port"]) + ".")
        results.append({"peer": "this computer", "name": sync_engine.COMPUTER_NAME,
                        "last_seen": None, "ok": False, "reason": "bind-failed",
                        "counts": None,
                        "detail": f"This machine cannot receive on UDP port {lst['port']} "
                                  f"({lst['error']}). Discovery broadcasts and PIN envelopes "
                                  f"arrive but are unheard. {_fw_hint} "
                                  "Also close any other copy of PASADA on this computer."})
    else:
        _fw_hint = ("If this machine rebinding requires it later: Linux — sudo ufw allow "
                    + str(lst["port"]) + "/udp; Windows — netsh advfirewall firewall "
                    "add rule name=\"PASADA Sync\" dir=in action=allow protocol=UDP localport="
                    + str(lst["port"]) + "; the API port " + str(sync_engine.API_PORT)
                    + " over TCP likewise.")
        results.append({"peer": "this computer", "name": sync_engine.COMPUTER_NAME,
                        "last_seen": None, "ok": True, "reason": None,
                        "counts": None,
                        "detail": f"This machine receives fine on UDP {lst['port']} and serves the API on TCP {sync_engine.API_PORT}. "
                                  f"This computer's key fingerprint: {cluster_secret_fingerprint()}. "
                                  "Check that the other computer shows the same fingerprint. "
                                  + _fw_hint})
    for peer in list(PEERS):
        ts = str(int(time.time()))
        nonce = secrets.token_hex(8)
        body = f"PULL:{peer}:{ts}:{nonce}".encode('utf-8')
        signature = sync_engine._hmac_hex(body)
        entry = {
            "peer": peer,
            "name": sync_engine.PEER_NAMES.get(peer),
            "last_seen": sync_engine.get_peer_status().get(peer, {}).get("last_seen"),
        }
        try:
            response = requests.get(
                f"http://{peer}:{sync_engine.API_PORT}/api/sync/pull?since=2000-01-01T00:00:00",
                headers={
                    "X-Cluster-Timestamp": ts,
                    "X-Cluster-Nonce": nonce,
                    "X-Cluster-Signature": signature,
                },
                timeout=5,
            )
        except requests.exceptions.Timeout:
            entry.update({"ok": False, "reason": "timeout",
                          "detail": f"No answer within 5 seconds. The other computer may be turned off, asleep, or blocked in the firewall. On that machine allow the ports: Linux — sudo ufw allow {sync_engine.API_PORT}/tcp and sudo ufw allow {sync_engine.SYNC_PORT}/udp; Windows (admin PowerShell) — netsh advfirewall firewall add rule name=\"PASADA API\" dir=in action=allow protocol=TCP localport={sync_engine.API_PORT}, then the same with name=\"PASADA Sync\" protocol=UDP localport={sync_engine.SYNC_PORT}."})
        except requests.exceptions.ConnectionError as e:
            entry.update({"ok": False, "reason": "refused",
                          "detail": f"PASADA is not answering on {peer} (port {sync_engine.API_PORT}). Open PASADA on that computer, or allow the port on its firewall: Linux — sudo ufw allow {sync_engine.API_PORT}/tcp; Windows — netsh advfirewall firewall add rule name=\"PASADA API\" dir=in action=allow protocol=TCP localport={sync_engine.API_PORT}."})
        except Exception as e:
            entry.update({"ok": False, "reason": "error", "detail": f"{type(e).__name__}: {e}"})
        else:
            if response.status_code == 403:
                entry.update({"ok": False, "reason": "wrong-secret",
                              "detail": "The two computers hold different shared keys, so they will not sync each other. Normally PASADA pairs computers by itself: turn PASADA off and on again on BOTH computers (with this one alone at first if the office has several) and they will re-introduce themselves within a minute. If that fails, Admin Console > Technical > Manual key recovery."})
            elif response.status_code == 200:
                try:
                    payload = response.json()
                    counts = {
                        "records": len(payload.get("records", [])),
                        "users": len(payload.get("users", [])),
                    }
                except Exception:
                    counts = None
                entry.update({"ok": True, "reason": None, "counts": counts,
                              "detail": f"Connected and trusted{(' — sharing ' + str(counts['users']) + ' account(s) and ' + str(counts['records']) + ' record(s)') if counts else '.'}"})
            else:
                entry.update({"ok": False, "reason": f"http-{response.status_code}",
                              "detail": f"The other computer answered with an unexpected error (code {response.status_code})."})
        results.append(entry)
    db = SessionLocal()
    try:
        log_action(db, get_full_name(current_user), "SYNC_DIAGNOSTICS", "0", "SYSTEM",
                   f"Ran a live connection check against {len(results)} peer(s): "
                   + ", ".join(f"{r['peer']}={'ok' if r.get('ok') else r.get('reason')}" for r in results) + ".")
    finally:
        db.close()
    return {"local_ip": get_local_ip(), "results": results,
            "checked_at": get_pht_now().isoformat()}

@app.post("/system/sync-now")
def sync_now(current_user: User = Depends(get_current_user)):
    """Sync now button (Admin Console > Technical). Wakes the pull loop for
    an immediate cycle instead of waiting for the next 10-second tick. The
    heartbeat nudge already does this automatically after user changes; this
    is the manual override for when an office wants records pulled right
    away, for example after reconnecting a cable."""
    require_admin(current_user)
    sync_engine.request_sync_cycle()
    return {"status": "success", "message": "Sync cycle requested. Records refresh in a moment."}

@app.post("/system/computer-name")
def set_computer_name_endpoint(payload: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # The broadcast name is the signed-in ACCOUNT's name (who is using this
    # computer), not a machine label. The frontend sends the account name
    # right after login; it can still be edited by hand in Settings.
    name = str(payload.get("name", "")).strip()[:40]
    if not name:
        raise HTTPException(status_code=400, detail="Sign in first so PASADA knows whose computer this is.")
    sync_engine.set_computer_name(name)
    return {"status": "success", "name": sync_engine.COMPUTER_NAME}

# PULL SIGNATURE CHECK: mirrors sync_engine's builder. A valid signature is
# at most PULL_MAX_AGE seconds old and never repeats (replay cache).
PULL_MAX_AGE_SECONDS = 300
_seen_pull_nonces = {}
_seen_pull_lock = threading.Lock()

def _verify_pull_signature(ts: str, nonce: str, signature: str) -> bool:
    if not ts or not nonce or not signature:
        return False
    try:
        age = abs(time.time() - float(ts))
    except ValueError:
        return False
    if age > PULL_MAX_AGE_SECONDS:
        return False
    # The caller signs the IP it ADDRESSED: this machine's LAN IP when sync
    # runs between office computers, or a loopback name when the caller is on
    # this same machine (dev, tests). Trying the small candidate list here
    # keeps the wire format unchanged and still fails closed: without the
    # cluster secret no candidate ever matches.
    # MULTIPLE NETWORK CARDS: a PC can sit on the office LAN on more than
    # one interface; a peer that reaches it through the second NIC signs that
    # NIC's address. Every local IPv4 is a candidate; the trust check is
    # unchanged (still the cluster secret over the addressed bytes).
    candidate_ips = [get_local_ip(), "127.0.0.1", "localhost", "::1"]
    candidate_ips += [ip for ip in sync_engine._local_ipv4_addresses() if ip not in candidate_ips]
    for peer in candidate_ips:
        body = f"PULL:{peer}:{ts}:{nonce}".encode('utf-8')
        # LIVE SECRET, not an import-time copy: auto-pairing adoption (and
        # admin-key rotation) rewrites sync_engine.CLUSTER_SECRET in place,
        # while a `from sync_engine import CLUSTER_SECRET` binding keeps the
        # value from module import — pulls signed with the adopted cluster
        # key would be refused until this process restarted.
        expected = hmac.new(sync_engine.CLUSTER_SECRET.encode('utf-8'), body, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, signature.lower()):
            break
    else:
        return False
    # REPLAY GUARD: record each nonce with its expiry and lazily drop stale
    # ones so the cache cannot grow without bound.
    with _seen_pull_lock:
        current = time.time()
        for k in [k for k, exp in _seen_pull_nonces.items() if exp <= current]:
            del _seen_pull_nonces[k]
        if nonce in _seen_pull_nonces:
            return False
        _seen_pull_nonces[nonce] = current + PULL_MAX_AGE_SECONDS
    return True

@app.get("/api/sync/pull")
def sync_pull(since: str, request: Request, db: Session = Depends(get_db)):
    # SIGNED PULL: the caller proves it holds the cluster secret by signing
    # (peer, timestamp, nonce). The secret itself never crosses the network.
    ts = request.headers.get("x-cluster-timestamp", "")
    nonce = request.headers.get("x-cluster-nonce", "")
    signature = request.headers.get("x-cluster-signature", "")
    if not _verify_pull_signature(ts, nonce, signature):
        raise HTTPException(status_code=403, detail="Unauthorized cluster request")
        
    try:
        target_time = datetime.fromisoformat(since).replace(tzinfo=None)
    except ValueError:
        # An unparseable watermark used to surface as a raw 500 traceback on
        # this side and a generic miscount on the pull side. Fail honest.
        raise HTTPException(status_code=422, detail=
            '"since" must be an ISO timestamp, e.g. since=2000-01-01T00:00:00.')
    # > vs >=: a record stamped EXACTLY at the watermark sits ON the tie and
    # was silently skipped by the strict filter every cycle. Rows are merged
    # idempotently under last-write-wins, so re-sending the boundary row is
    # cheap and a tie is never lost. (User accounts have no timestamp gate at
    # all — the whole accounts table rides every pull — so ties on users are
    # impossible by construction.)
    records = db.query(FranchiseRecord).filter(FranchiseRecord.updated_at >= target_time).all()
    users = db.query(User).all()
    
    # PASSWORD ROAMING: the cluster is HMAC-trusted (same office LAN, shared
    # secret, signed pulls), so the bcrypt password hash travels with the
    # account. An account created on one computer can then sign in on every
    # computer — bcrypt hashes are safe to share between machines that
    # already trust each other. Only the SECURITY-ANSWER hashes stay local:
    # recovery is deliberately answered on the machine that set the
    # questions, and leaking answer hashes widens an offline-guessing attack
    # to the whole cluster for no benefit.
    SENSITIVE_USER_COLUMNS = {
        "security_a1_hash", "security_a2_hash", "security_a3_hash"
    }
    safe_users = []
    for u in users:
        u_dict = {c.name: getattr(u, c.name) for c in u.__table__.columns if c.name not in SENSITIVE_USER_COLUMNS}
        safe_users.append(u_dict)
        
    return {"records": [attach_status(r) for r in records], "users": safe_users}

# --- ADMIN CONSOLE: TEMPLATE MANAGEMENT ---
# 25010 Characteristic: Maintainability. The certificate (template.docx) and
# the TODA summary (dashboard_template.docx) are Word files with placeholder
# tokens ([SBN_NO], [NAME], ...). When the LGU amends the form, the office
# uploads the amended .docx here instead of waiting for a rebuild of the
# installer. Uploads are validated before replacing anything: a file that is
# not a readable .docx is rejected and the previous template stays in place.
# The previous file is kept beside the new one as a .bak, so one bad upload
# can always be undone by hand. Every upload lands in the audit log.
TEMPLATE_DIR = BASE_DIR
# Templates ship inside the PyInstaller bundle (sys._MEIPASS at runtime), so
# "installed" must look where the doc generator actually reads them, not at
# the data directory. Uploaded replacements go to the data directory and the
# doc generator's resource lookup finds them there first (it checks _MEIPASS
# and falls back to its own folder; the upload path below mirrors that).
try:
    from doc_generator import get_resource_path as _tpl_resource_path
    _BUNDLED_TEMPLATE_DIR = os.path.dirname(_tpl_resource_path("template.docx"))
except Exception:
    _BUNDLED_TEMPLATE_DIR = os.path.abspath(os.path.dirname(__file__))
ALLOWED_TEMPLATE_FILES = {
    "certificate": "template.docx",
    "toda_summary": "dashboard_template.docx",
}
MAX_TEMPLATE_BYTES = 20 * 1024 * 1024  # a real form is a few hundred KB

def _template_status(template_key: str) -> dict:
    filename = ALLOWED_TEMPLATE_FILES[template_key]
    # A template is "installed" when the doc generator can actually load it:
    # the bundled copy inside the PyInstaller bundle, or an uploaded copy in
    # the data directory (upload_template's target, which wins if present).
    data_copy = os.path.join(TEMPLATE_DIR, filename)
    bundled = os.path.join(_BUNDLED_TEMPLATE_DIR, filename)
    path = data_copy if os.path.exists(data_copy) else bundled
    return {
        "key": template_key,
        "filename": filename,
        "installed": os.path.exists(path),
        "size": os.path.getsize(path) if os.path.exists(path) else 0,
        "modified": (datetime.fromtimestamp(os.path.getmtime(path)).isoformat()
                     if os.path.exists(path) else None),
    }

@app.get("/admin/templates")
def list_templates(current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    return [_template_status(key) for key in sorted(ALLOWED_TEMPLATE_FILES)]

@app.post("/admin/templates/{template_key}")
async def upload_template(template_key: str, file: UploadFile = File(...),
                          current_user: User = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    require_admin(current_user)
    if template_key not in ALLOWED_TEMPLATE_FILES:
        raise HTTPException(status_code=404, detail="Unknown template. Use certificate or toda_summary.")
    filename = ALLOWED_TEMPLATE_FILES[template_key]
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Template must be a .docx file.")
    data = await file.read()
    if len(data) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=413, detail="Template exceeds the 20 MB limit.")

    from docx import Document as _Doc
    from io import BytesIO as _BytesIO
    try:
        doc = _Doc(_BytesIO(data))
        token_count = sum(
            1 for p in doc.paragraphs for token in ("[SBN_NO]", "{{SBN_NO}}", "[NAME]", "{{NAME}}")
            if token in p.text)
    except Exception:
        raise HTTPException(status_code=400, detail="File is not a readable Word document.")

    target = os.path.join(TEMPLATE_DIR, filename)
    backup = os.path.join(TEMPLATE_DIR, filename + ".bak")
    if os.path.exists(target):
        shutil.copy2(target, backup)
    with open(target, "wb") as f:
        f.write(data)
    # Audit through THIS request's session so the row lands in the same
    # database the upload belongs to (a test DB, or another office PC's DB),
    # never silently in the first machine's production database.
    log_action(db=db, clerk_name=get_full_name(current_user), action="TEMPLATE_UPLOAD",
               target_id="0", target_route="SYSTEM",
               details=f"Uploaded new {filename} ({len(data)} bytes, {token_count} SBN/NAME tokens found).")
    return {"status": "success", "template": filename, "size": len(data),
            "recognized_tokens": token_count,
            "warning": None if token_count > 0 else "No [SBN_NO]/[NAME] tokens found. Check the document before printing certificates."}

@app.get("/admin/diagnostics")
def admin_diagnostics(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """One call for the Admin Console's technical tab: what this computer is
    running, how the database is doing, what the sync engine sees, and the
    tail of the crash log. Read-only; safe to call any time."""
    require_admin(current_user)

    # DATABASE: SQLite's own integrity check is cheap and answers "is my data
    # file still healthy?" without locking the office out of anything.
    integrity = "unknown"
    record_count = 0
    try:
        row = db.execute(text("PRAGMA integrity_check")).fetchone()
        integrity = row[0] if row else "unknown"
        record_count = db.query(FranchiseRecord).filter(FranchiseRecord.is_deleted == False).count()
    except Exception:
        pass

    # BACKUPS: newest file produced by the nightly backup thread.
    backup_dir = os.path.join(BASE_DIR, "backups")
    latest_backup = None
    if os.path.isdir(backup_dir):
        candidates = [f for f in os.listdir(backup_dir) if f.endswith(".zip")]
        if candidates:
            newest = max(candidates, key=lambda f: os.path.getmtime(os.path.join(backup_dir, f)))
            latest_backup = {
                "file": newest,
                "modified": datetime.fromtimestamp(os.path.getmtime(os.path.join(backup_dir, newest))).isoformat(),
                "size": os.path.getsize(os.path.join(backup_dir, newest)),
            }

    # CRASH LOG TAIL: the last lines, newest last, capped so the payload
    # stays small on a slow office network.
    crash_tail: list[str] = []
    try:
        with open(crash_log_path, "r", encoding="utf-8", errors="replace") as f:
            crash_tail = f.read().splitlines()[-60:]
    except Exception:
        pass

    users_count = db.query(User).count()
    admins = [u.username for u in db.query(User).filter(User.role == "Admin").all()]
    return {
        "runtime": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "machine": platform.node(),
            "pid": os.getpid(),
            "started": LIFECYCLE_START_ISO,
        },
        "database": {"integrity": integrity, "records": record_count, "users": users_count, "admins": admins},
        "sync": {
            "local_ip": get_local_ip(),
            "api_port": sync_engine.API_PORT,
            "peers": sorted(PEERS),
            "peer_names": dict(sync_engine.PEER_NAMES),
            "computer_name": sync_engine.COMPUTER_NAME,
            "last_sync_check": sync_engine.get_last_sync_check(),
        },
        "backup": latest_backup,
        "crash_log_tail": crash_tail,
    }

@app.get("/admin/audit-overview")
def admin_audit_overview(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Operational picture for the Admin Console: who did what, how much, and
    when the office was last active. Counts only, no record payload."""
    require_admin(current_user)
    last = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).first()
    week_ago = get_pht_now() - timedelta(days=7)
    actions = (
        db.query(AuditLog.action, func.count(AuditLog.id))
        .filter(AuditLog.timestamp >= week_ago)
        .group_by(AuditLog.action)
        .all()
    )
    by_user = (
        db.query(AuditLog.clerk_name, func.count(AuditLog.id))
        .filter(AuditLog.timestamp >= week_ago)
        .group_by(AuditLog.clerk_name)
        .all()
    )
    # One bar per day for the last 7 days. Counted in office time (the same
    # clock the audit rows are written with), and empty days are filled with
    # zero so the chart shows a quiet day as a quiet day, not a gap.
    per_day = (
        db.query(func.date(AuditLog.timestamp), func.count(AuditLog.id))
        .filter(AuditLog.timestamp >= week_ago)
        .group_by(func.date(AuditLog.timestamp))
        .all()
    )
    counts_by_date = {str(d): c for d, c in per_day}
    daily_last_7_days = []
    for offset in range(6, -1, -1):
        day = (get_pht_now() - timedelta(days=offset)).date()
        daily_last_7_days.append({"day": day.strftime("%a"), "count": counts_by_date.get(day.isoformat(), 0)})
    return {
        "total_logs": db.query(AuditLog).count(),
        "logs_last_7_days": sum(c for _, c in actions),
        "last_activity": last.timestamp.isoformat() if last and last.timestamp else None,
        "actions_last_7_days": sorted(
            ({"action": a, "count": c} for a, c in actions), key=lambda x: -x["count"]),
        "users_last_7_days": sorted(
            ({"user": (u or "SYSTEM"), "count": c} for u, c in by_user), key=lambda x: -x["count"]),
        "daily_last_7_days": daily_last_7_days,
    }

@app.post("/api/operators")
def create_operator_api(record: FranchiseCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return create_franchise(record, current_user, db)

@app.post("/franchise/")
def create_franchise(record: FranchiseCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_record_writer(current_user)
    record.route = alias_route(record.route)
    record.address = expand_address_abbreviations(record.address)

    full_name = get_full_name(current_user)
    current_time = get_pht_now()
    
    if not record.sbn_no or str(record.sbn_no).strip() == "":
        raw_next = generate_next_sbn(db, record.route)
    else:
        raw_next = record.sbn_no

    is_vacant = not record.operator_name or str(record.operator_name).strip() == ""
    
    manual_issue = parse_safe_date(record.issue_date, current_time.year) if record.issue_date else None
    manual_valid = parse_safe_date(record.valid_until, current_time.year) if record.valid_until else None

    actual_issue_date = manual_issue if manual_issue else (None if is_vacant else current_time)
    actual_valid_until = manual_valid if manual_valid else (None if is_vacant else datetime(current_time.year, 12, 31))
    actual_active = False if is_vacant else determine_status(actual_issue_date)

    record.sbn_no = format_sbn_with_year(raw_next, actual_issue_date, is_vacant)
    record.plate_no = sanitize_plate(record.plate_no, record.chassis_no, record.motor_no)
    
    if not record.driving_route or str(record.driving_route).strip() == "":
        record.driving_route = get_dominant_driving_route(db, record.route) or record.route

    # original_sbn_no ay hindi column — form bookkeeping lang yan para sa renewal detection.
    update_data = record.model_dump(exclude={'issue_date', 'valid_until', 'original_sbn_no'})
    new_record = FranchiseRecord(
        **update_data, processed_by=full_name, issue_date=actual_issue_date,
        valid_until=actual_valid_until, is_active=actual_active
    )
    
    try:
        db.add(new_record)
        db.commit()
        db.refresh(new_record)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to add. SBN {record.sbn_no} already exists or violates constraints.")
        
    invalidate_ml_cache(new_record.route)
    clear_api_caches()
    
    log_action(db, full_name, "CREATE_RECORD", new_record.id, new_record.route, f"Registered new operator {record.operator_name or 'VACANT'} under SBN {record.sbn_no} ({record.route})")
    
    return {
        "status": "success", 
        "message": f"Franchise operator added successfully with SBN {new_record.sbn_no}.",
        "issue_date": new_record.issue_date.isoformat() if new_record.issue_date else None,
        "valid_until": new_record.valid_until.isoformat() if new_record.valid_until else None,
        "sbn_no": new_record.sbn_no
    }

@app.put("/franchise/{record_id}")
def update_franchise(
    record_id: str, 
    record: FranchiseCreate, 
    auto_change_motor_date: bool = True,
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    # AUTH FIRST: the Viewer/Clerk gate fires before any record lookup, so a
    # crafted request learns nothing about which record ids exist (a 404 on
    # a guessed id would otherwise leak existence before authorization).
    require_record_writer(current_user)
    db_record = db.query(FranchiseRecord).filter(FranchiseRecord.id == record_id, FranchiseRecord.is_deleted == False).first()
    if not db_record: raise HTTPException(status_code=404)
    
    # I-refresh muna nang buo yung record mula sa DB bago kahit anong pagbabago.
    # Kapag may nag-GET kasi bago tumuloy yung PUT (hal. nag-refresh yung listahan
    # habang bukas yung edit modal), hindi pa na-load yung ibang fields sa object
    # tapos pagbabasehan natin ng comparison, mababasa natin bilang NULL kahit may
    # I-refresh muna natin galing sa DB yung object bago tayo mang-compare. Kapag
    # may ibang request na nagbasa ng record (15s polling ng frontend, page refresh,
    # etc.) bago pa ma-commit yung PUT, nag-eexpire yung record sa session at
    # nagmumukhang "lahat ng specs nagbago" kahit wala namang pinagbago — doon
    # nanggagaling yung mga phantom change-motor entries. Isang refresh lang, dito.
    db.refresh(db_record)
    
    record.route = alias_route(record.route)
    record.address = expand_address_abbreviations(record.address)

    # RENEWAL DETECTION — dito nagluluko dati. Yung listahan na nababasa ng modal
    # ay may year suffix na derived lang sa issue_date (format_sbn_with_year),
    # pero hindi yun laging tugma sa stored SBN (hal. backdated record: display
    # "BA-280-25" pero naka-store "BA-280-26"). Dahil raw string compare lang ang
    # dating logic, kahit pangalan lang ang binago mo ay nag-fi-fire yung renewal
    # branch — napapalitan ng date today ang Date Issued. Kaya ngayon, ang
    # kinukumpara natin ay yung SBN na hinawakan ng user sa modal nung binuksan
    # nya yung form (original_sbn_no), hindi yung naka-store.
    original_sbn = str(getattr(record, "original_sbn_no", "") or "").strip().upper()
    modal_sbn = str(record.sbn_no).strip().upper()
    new_base_sbn = normalize_base_sbn(record.sbn_no)
    # Fall back sa lumang compare kung wala yung original (old clients / direct API calls)
    sbn_edit_reference = original_sbn or str(db_record.sbn_no).strip().upper()
    sbn_edited = modal_sbn != sbn_edit_reference

    is_renewal = False
    is_change_motor = False
    record.plate_no = sanitize_plate(record.plate_no, record.chassis_no, record.motor_no)
    
    is_vacant = not record.operator_name or str(record.operator_name).strip() == ""
    
    current_time = get_pht_now()
    
    # --- CHANGE MOTOR CHECK (motor specs lang dapat ang nagti-trigger nito) ---
    # Dito tayo nag-i-snapshot ng LUMANG values, pagkatapos na ma-refresh yung object
    # para siguradong galing sa DB ang pagkukumpara at hindi sa stale session state.
    def norm_spec(v):
        return str(v or "").strip().upper()

    old_motor = norm_spec(db_record.motor_no)
    old_chassis = norm_spec(db_record.chassis_no)
    old_make = norm_spec(db_record.make)
    
    new_motor = norm_spec(record.motor_no)
    new_chassis = norm_spec(record.chassis_no)
    new_make = norm_spec(record.make)
    
    motor_specs_changed = (
        old_motor != new_motor or
        old_chassis != new_chassis or
        old_make != new_make
    )
    
    def safe_date_str(dt):
        return dt.strftime('%Y-%m-%d') if dt else ""

    # NOTE: huwag nang mag-refresh ulit dito — nasa taas na yung db.refresh(db_record),
    # at kapag inulit mo pa, mabubura lang yung mga binago natin sa taas.

    old_issue_str = safe_date_str(db_record.issue_date)
    new_issue_str = (record.issue_date or "").split('T')[0]
    user_changed_issue = (old_issue_str != new_issue_str) and new_issue_str != ""
    
    old_valid_str = safe_date_str(db_record.valid_until)
    new_valid_str = (record.valid_until or "").split('T')[0]
    user_changed_valid = (old_valid_str != new_valid_str) and new_valid_str != ""

    manual_issue = parse_safe_date(record.issue_date, current_time.year) if record.issue_date else None
    manual_valid = parse_safe_date(record.valid_until, current_time.year) if record.valid_until else None

    old_motor = norm_spec(db_record.motor_no)
    old_chassis = norm_spec(db_record.chassis_no)
    old_make = norm_spec(db_record.make)
    old_operator = str(db_record.operator_name or "").strip().upper()

    if is_vacant:
        db_record.is_active = False
        db_record.issue_date = None
        db_record.valid_until = None
    else:
        if motor_specs_changed:
            is_change_motor = True
            if user_changed_issue:
                db_record.issue_date = manual_issue
                db_record.valid_until = manual_valid if user_changed_valid else datetime(manual_issue.year, 12, 31)
            elif auto_change_motor_date:
                db_record.issue_date = current_time
                db_record.valid_until = manual_valid if user_changed_valid else datetime(current_time.year, 12, 31)
            else:
                if user_changed_valid:
                    db_record.valid_until = manual_valid
                    
            db_record.is_active = True
            
        elif sbn_edited: 
            is_renewal = True
            db_record.issue_date = manual_issue if user_changed_issue else current_time
            db_record.valid_until = manual_valid if user_changed_valid else datetime(db_record.issue_date.year, 12, 31)
            db_record.is_active = True

        else:
            if user_changed_issue: 
                db_record.issue_date = manual_issue
                db_record.is_active = determine_status(db_record.issue_date)
            
            if user_changed_valid:
                db_record.valid_until = manual_valid
            elif user_changed_issue:
                db_record.valid_until = datetime(manual_issue.year, 12, 31)

    record.sbn_no = format_sbn_with_year(new_base_sbn, db_record.issue_date, is_vacant)

    if not record.driving_route or str(record.driving_route).strip() == "":
        record.driving_route = get_dominant_driving_route(db, db_record.route) or db_record.route

    # NOTE: model_dump pero hindi kasama ang issue_date/valid_until — yung dalawang
    # yun ay hawak na ng change-motor / renewal logic sa taas, huwag nang i-overwrite.
    update_data = record.model_dump(exclude={'issue_date', 'valid_until', 'original_sbn_no'})
    for key, value in update_data.items():
        setattr(db_record, key, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to update. SBN {record.sbn_no} might conflict with an existing record.")

    invalidate_ml_cache(db_record.route)
    clear_api_caches()
    full_name = get_full_name(current_user)
    
    if is_change_motor:
        # Ilagay sa log LANG yung specs na talagang nagbago, hindi buong motor/chassis/make
        # na parang nagbago lahat. Mas malinaw tignan sa Change Motor History page.
        spec_changes = []
        if old_motor != new_motor: spec_changes.append(("MOTOR_NO", old_motor, new_motor))
        if old_chassis != new_chassis: spec_changes.append(("CHASSIS_NO", old_chassis, new_chassis))
        if old_make != new_make: spec_changes.append(("MAKE", old_make, new_make))
        
        details_str = "; ".join(
            f"{field}: {old or 'NONE'} -> {new or 'NONE'}" for field, old, new in spec_changes
        )
        details_str += f". Date Issued set to {db_record.issue_date.strftime('%Y-%m-%d') if db_record.issue_date else 'NONE'}."
        
        log_action(
            db, 
            full_name, 
            "CHANGE_MOTOR", 
            db_record.id, 
            db_record.route, 
            details_str,
            operator_name=db_record.operator_name,
            sbn_no=new_base_sbn,
            field_changed=", ".join(field for field, _, _ in spec_changes),
            old_value=spec_changes[0][1] or "NONE",
            new_value=spec_changes[0][2] or "NONE",
            secondary_value=db_record.issue_date.strftime('%Y-%m-%d') if db_record.issue_date else ""
        )
    elif is_renewal:
        # Ilagay sa log yung aktwal na valid_until na na-compute, huwag yung hardcoded
        # na "Dec 31 ng current year" — minsan magkaiba talaga.
        _vu_disp = db_record.valid_until.strftime('%Y-%m-%d') if db_record.valid_until else "NO DATE"
        log_action(db, full_name, "RENEWAL", db_record.id, db_record.route, f"Renewed SBN to {new_base_sbn}. Extended to {_vu_disp}")
    else:
        log_action(db, full_name, "EDIT_RECORD", db_record.id, db_record.route, f"Updated record for {db_record.operator_name or 'VACANT'} - SBN {db_record.sbn_no} ({db_record.route})")
        
    return {
        "status": "success",
        "issue_date": db_record.issue_date.isoformat() if db_record.issue_date else None,
        "valid_until": db_record.valid_until.isoformat() if db_record.valid_until else None,
        "sbn_no": db_record.sbn_no
    }

# NOTE: Normal re-upload does not reset the system (uses merge-only & year-gates).
# To reset for testing, download a .db backup first, then use Full Restore.
MAX_DB_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB — a full registry DB is ~100 MB

@app.post("/upload/database")
async def upload_database_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    # Importing a whole .db file can add or overwrite thousands of records;
    # that is an administrative migration, not part of a clerk's workflow.
    require_admin(current_user)
    temp_db_path = os.path.join(BASE_DIR, f"temp_import_{uuid.uuid4().hex}.db")
    written = 0
    # The nightly backup is a ZIP whose payload is pasada.db. Accept it here so
    # an office whose Franchise folder is stale can still import from the
    # backup package alone (same merge-only path as a raw .db).
    if (file.filename or "").lower().endswith(".zip"):
        member_name = None
        try:
            written = 0
            with zipfile.ZipFile(io.BytesIO(await file.read())) as zf:
                # Pick the largest .db member; the nightly zip holds exactly one.
                db_members = [i for i in zf.infolist()
                              if not i.is_dir() and i.filename.lower().endswith(".db")
                              and not os.path.basename(i.filename).startswith("._")]
                if not db_members:
                    raise HTTPException(status_code=400, detail="This ZIP has no .db file inside. Choose the nightly PASADA_Backup zip or a plain .db import file.")
                member = max(db_members, key=lambda i: i.file_size)
                member_name = member.filename
                with zf.open(member) as src, open(temp_db_path, "wb") as buffer:
                    while chunk := src.read(1024 * 1024):
                        written += len(chunk)
                        if written > MAX_DB_UPLOAD_BYTES:
                            raise HTTPException(status_code=413, detail="The .db inside this ZIP exceeds the 500 MB import limit.")
                        buffer.write(chunk)
        except HTTPException:
            if os.path.exists(temp_db_path):
                os.remove(temp_db_path)
            raise
        except zipfile.BadZipFile:
            return JSONResponse(status_code=415, content={"detail": "This ZIP file is corrupted. Try the plain .db file instead."})
        force_log(f"ZIP import: extracted {member_name} ({written} bytes) from {(file.filename or '').rsplit('/', 1)[-1]}")
    else:
        written = 0
        with open(temp_db_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_DB_UPLOAD_BYTES:
                    buffer.close()
                    os.remove(temp_db_path)
                    raise HTTPException(status_code=413, detail="Database file exceeds the 500 MB import limit.")
                buffer.write(chunk)
    
    temp_db = None
    db = None
    try:
        temp_engine = create_engine(f"sqlite:///{temp_db_path}")
        inspector = inspect(temp_engine)
        if "franchise_records" not in inspector.get_table_names():
            raise Exception("Uploaded database is invalid or corrupted. Missing 'franchise_records' table.")
            
        TempSession = sessionmaker(bind=temp_engine)
        temp_db = TempSession()
        imported_records = temp_db.query(FranchiseRecord).all()
        db = SessionLocal()
        
        existing_ids = {r.id for r in db.query(FranchiseRecord.id).all()}
        
        new_count = 0
        skipped_count = 0
        
        for r in imported_records:
            if getattr(r, 'is_deleted', False):
                skipped_count += 1
                continue
                
            if r.id in existing_ids:
                skipped_count += 1
                continue

            is_vac = not r.operator_name or str(r.operator_name).strip() == ""
            new_record = FranchiseRecord(
                id=r.id, sbn_no=format_sbn_with_year(r.sbn_no, r.issue_date, is_vac), operator_name=r.operator_name,
                address=r.address, motor_no=r.motor_no, chassis_no=r.chassis_no,
                make=r.make, plate_no=r.plate_no, route=alias_route(r.route),
                driving_route=r.driving_route, issue_date=r.issue_date,
                valid_until=r.valid_until, is_active=r.is_active,
                processed_by=get_full_name(current_user), 
                updated_at=r.updated_at
            )
            db.add(new_record)
            existing_ids.add(r.id)
            new_count += 1
            
        db.commit()
        invalidate_ml_cache()
        clear_api_caches()
        log_action(db, get_full_name(current_user), "DATABASE_MIGRATION", "0", "ALL", f"Merged {new_count} records from .db file. Skipped {skipped_count}.")
        return {"imported": new_count, "skipped": skipped_count}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if temp_db:
            try: temp_db.close()
            except: pass
        if db:
            try: db.close()
            except: pass
        if os.path.exists(temp_db_path):
            try: os.remove(temp_db_path)
            except: pass

@app.get("/backup/database")
def backup_database(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_path = os.path.join(BASE_DIR, 'pasada_production.db')
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Database file not found.")
    
    temp_backup_dir = os.path.join(BASE_DIR, "temp_backups")
    os.makedirs(temp_backup_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"PASADA_BACKUP_{timestamp}.db"
    temp_db_path = os.path.join(temp_backup_dir, filename)
    
    shutil.copyfile(db_path, temp_db_path)
    
    log_action(db, get_full_name(current_user), "DOWNLOAD_DB_BACKUP", "0", "SYSTEM", f"Downloaded raw database backup {filename}")
    
    headers = {'Content-Disposition': f'attachment; filename="{filename}"'}
    return FileResponse(path=temp_db_path, media_type="application/octet-stream", headers=headers)

@app.post("/restore/database")
async def restore_database_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    # Full Restore replaces the whole registry with the uploaded backup.
    # Same rule as /upload/database: Admin only. (Found in the full endpoint
    # audit: the merge import was gated but this one was not.)
    require_admin(current_user)
    temp_db_path = os.path.join(BASE_DIR, f"temp_restore_{uuid.uuid4().hex}.db")
    written = 0
    with open(temp_db_path, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            written += len(chunk)
            if written > MAX_DB_UPLOAD_BYTES:
                buffer.close()
                os.remove(temp_db_path)
                raise HTTPException(status_code=413, detail="Database file exceeds the 500 MB restore limit.")
            buffer.write(chunk)
    
    temp_db = None
    db = None
    try:
        temp_engine = create_engine(f"sqlite:///{temp_db_path}")
        inspector = inspect(temp_engine)
        if "franchise_records" not in inspector.get_table_names():
            raise Exception("Uploaded database is invalid or corrupted. Missing 'franchise_records' table.")
            
        TempSession = sessionmaker(bind=temp_engine)
        temp_db = TempSession()
        imported_records = temp_db.query(FranchiseRecord).all()
        db = SessionLocal()
        
        restored_updated = 0
        restored_inserted = 0
        
        valid_keys = {c.name for c in FranchiseRecord.__table__.columns}
        
        for r in imported_records:
            existing = db.query(FranchiseRecord).filter(FranchiseRecord.id == r.id).first()
            if existing:
                for key in valid_keys:
                    setattr(existing, key, getattr(r, key))
                restored_updated += 1
            else:
                clean_kwargs = {key: getattr(r, key) for key in valid_keys}
                new_rec = FranchiseRecord(**clean_kwargs)
                db.add(new_rec)
                restored_inserted += 1
            
        db.commit()
        invalidate_ml_cache()
        clear_api_caches()
        log_action(db, get_full_name(current_user), "DATABASE_RESTORE", "0", "ALL", f"Restored DB: {restored_updated} updated, {restored_inserted} inserted.")
        return {"restored_updated": restored_updated, "restored_inserted": restored_inserted}
    except Exception as e:
        if db: db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if temp_db:
            try: temp_db.close()
            except: pass
        if db:
            try: db.close()
            except: pass
        if os.path.exists(temp_db_path):
            try: os.remove(temp_db_path)
            except: pass

# NOTE: Normal re-upload does not reset the system (uses merge-only & year-gates).
# To reset for testing, download a .db backup first, then use Full Restore.
@app.post("/upload/bulk/{route_name}")
async def upload_bulk_files(
    route_name: str, 
    files: List[UploadFile] = File(...), 
    force_overwrite: bool = False,
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    require_record_writer(current_user)
    route_name = alias_route(route_name)
    full_name = get_full_name(current_user)
    imported_count = 0
    current_time = get_pht_now()
    error_log = [] 
    
    existing_route_records = db.query(FranchiseRecord).filter(FranchiseRecord.route == route_name, FranchiseRecord.is_deleted == False).all()

    sbn_map = {normalize_base_sbn(pr.sbn_no): pr for pr in existing_route_records}
    plate_map = {pr.plate_no: pr for pr in existing_route_records if pr.plate_no}
    motor_map = {pr.motor_no: pr for pr in existing_route_records if pr.motor_no}
    chassis_map = {pr.chassis_no: pr for pr in existing_route_records if pr.chassis_no}

    for file in files:
        if file.filename.startswith("~$") or file.filename.startswith("._") or file.filename == ".DS_Store":
            continue

        contents = await file.read()
        try:
            if file.filename.endswith(".xlsx") or file.filename.endswith(".csv"):
                row_dicts = []
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
                    if header_idx == -1:
                        # ISO 25010 Functional Suitability: fail the file loudly
                        # with the column names we need, instead of importing 0
                        # rows and answering "success".
                        raise Exception(
                            "No header row found: need columns containing NAME and SBN "
                            f"in the first 20 rows of {file.filename}."
                        )
                    for r_idx in range(header_idx + 1, sheet.max_row + 1):
                        row_dict = {}
                        for c_idx in range(1, sheet.max_column + 1):
                            row_dict[headers[c_idx - 1]] = sheet.cell(row=r_idx, column=c_idx).value
                        row_dicts.append(row_dict)
                else:
                    df = pd.read_csv(io.BytesIO(contents), header=None)
                    df.fillna("", inplace=True)
                    header_idx = -1
                    for i, row in df.iterrows():
                        row_vals = [str(x).upper().strip() for x in row.values if str(x).strip()]
                        if any("NAME" in val for val in row_vals) and any("SBN" in val for val in row_vals):
                            header_idx = i
                            break
                    if header_idx == -1:
                        # Same loud failure for CSV: no NAME+SBN header = no import.
                        raise Exception(
                            "No header row found: need columns containing NAME and SBN "
                            f"in {file.filename}."
                        )
                    df.columns = [str(c).strip().upper() for c in df.iloc[header_idx]]
                    df = df.iloc[header_idx+1:].reset_index(drop=True)
                    row_dicts = df.to_dict(orient="records")

                for row_dict in row_dicts:
                    raw_sbn = get_fuzzy_col_dict(row_dict, "SBN")
                    if not raw_sbn: continue 
                        
                    name = get_fuzzy_col_dict(row_dict, "NAME")
                    chassis = get_fuzzy_col_dict(row_dict, "CHASSIS")
                    motor = get_fuzzy_col_dict(row_dict, "MOTOR")
                    plate = get_fuzzy_col_dict(row_dict, "PLATE")
                    address = get_fuzzy_col_dict(row_dict, "ADDRESS")
                    make = get_fuzzy_col_dict(row_dict, "MAKE")

                    is_vacant = not name or str(name).strip() == ""

                    raw_date = None
                    if not is_vacant:
                        for col, val in row_dict.items():
                            if "RENEWAL" in str(col).upper() or "DATE" in str(col).upper():
                                raw_date = val
                                break

                    parsed_date = parse_safe_date(raw_date, current_time.year)
                    
                    incoming_base_sbn = normalize_base_sbn(raw_sbn)
                    clean_plate = sanitize_plate(plate, chassis, motor)
                    
                    existing_record = sbn_map.get(incoming_base_sbn)

                    if existing_record:
                        if force_overwrite or get_record_year(parsed_date) >= get_record_year(existing_record.issue_date):
                            existing_record.issue_date = parsed_date
                            existing_record.valid_until = datetime(parsed_date.year, 12, 31) if parsed_date else None
                            existing_record.is_active = False if is_vacant else determine_status(parsed_date)
                            existing_record.sbn_no = format_sbn_with_year(incoming_base_sbn, parsed_date, is_vacant)
                            
                            if force_overwrite:
                                if name and str(name).strip(): existing_record.operator_name = str(name).strip().upper()
                                if address and str(address).strip(): existing_record.address = str(address).strip().upper()
                                if make and str(make).strip(): existing_record.make = str(make).strip().upper()
                                if clean_plate and str(clean_plate).strip(): existing_record.plate_no = str(clean_plate).strip().upper()
                                if chassis and str(chassis).strip(): existing_record.chassis_no = str(chassis).strip().upper()
                                if motor and str(motor).strip(): existing_record.motor_no = str(motor).strip().upper()
                            else:
                                if name and str(name).strip(): existing_record.operator_name = str(name).strip().upper()
                                existing_record.address = set_if_blank(existing_record.address, address)
                                existing_record.make = set_if_blank(existing_record.make, make)
                                existing_record.plate_no = set_if_blank(existing_record.plate_no, clean_plate)
                                existing_record.chassis_no = set_if_blank(existing_record.chassis_no, chassis)
                                existing_record.motor_no = set_if_blank(existing_record.motor_no, motor)
                            imported_count += 1
                    else:
                        record = FranchiseRecord(
                            sbn_no=format_sbn_with_year(incoming_base_sbn, parsed_date, is_vacant),
                            operator_name=name.upper() if name else "",
                            address=address.upper() if address else "", motor_no=motor.upper() if motor else "",
                            plate_no=clean_plate.upper() if clean_plate else "", chassis_no=chassis.upper() if chassis else "",
                            make=make.upper() if make else "", route=route_name, driving_route="", 
                            issue_date=parsed_date, valid_until=datetime(parsed_date.year, 12, 31) if parsed_date else None,
                            processed_by=full_name, is_active=False if is_vacant else determine_status(parsed_date)
                        )
                        db.add(record)
                        sbn_map[incoming_base_sbn] = record
                        imported_count += 1

            elif file.filename.endswith(".docx"):
                extracted = extract_docx_data(contents, route_name, current_time.year)
                is_vacant = not extracted['operator_name'] or str(extracted['operator_name']).strip() == ""
                issue_date = parse_safe_date(extracted['issue_date'], current_time.year)
                
                clean_plate = sanitize_plate(extracted['plate_no'], extracted['chassis_no'], extracted['motor_no'])
                incoming_base_sbn = normalize_base_sbn(extracted['sbn_no'])
                
                existing_record = sbn_map.get(incoming_base_sbn)

                if not existing_record:
                    if clean_plate and str(clean_plate).strip(): existing_record = plate_map.get(str(clean_plate).strip().upper())
                    if not existing_record and extracted['motor_no']: existing_record = motor_map.get(str(extracted['motor_no']).strip().upper())
                    if not existing_record and extracted['chassis_no']: existing_record = chassis_map.get(str(extracted['chassis_no']).strip().upper())
                    
                    if existing_record:
                        incoming_base_sbn = normalize_base_sbn(existing_record.sbn_no)

                if existing_record:
                    if extracted['operator_name'] and str(extracted['operator_name']).strip():
                        existing_record.operator_name = str(extracted['operator_name']).strip().upper()
                    if extracted['address'] and str(extracted['address']).strip():
                        existing_record.address = str(extracted['address']).strip().upper()
                    if extracted['make'] and str(extracted['make']).strip():
                        existing_record.make = str(extracted['make']).strip().upper()
                    if extracted.get('driving_route') and str(extracted['driving_route']).strip():
                        existing_record.driving_route = str(extracted['driving_route']).strip().upper()
                    if clean_plate and str(clean_plate).strip():
                        existing_record.plate_no = str(clean_plate).strip().upper()
                    if extracted['chassis_no'] and str(extracted['chassis_no']).strip():
                        existing_record.chassis_no = str(extracted['chassis_no']).strip().upper()
                    if extracted['motor_no'] and str(extracted['motor_no']).strip():
                        existing_record.motor_no = str(extracted['motor_no']).strip().upper()

                    doc_year = get_record_year(issue_date)
                    existing_year = get_record_year(existing_record.issue_date)
                    if force_overwrite or (issue_date and (not existing_record.issue_date or doc_year > existing_year)):
                        existing_record.issue_date = issue_date
                        existing_record.valid_until = datetime(issue_date.year, 12, 31) if issue_date else None
                        existing_record.is_active = False if is_vacant else determine_status(issue_date)
                    
                    existing_record.sbn_no = format_sbn_with_year(incoming_base_sbn, existing_record.issue_date, is_vacant)
                    imported_count += 1
                else:
                    sbn_int = extract_sbn_integer(incoming_base_sbn)
                    if sbn_int is None or sbn_int != 0:
                        record = FranchiseRecord(
                            sbn_no=format_sbn_with_year(incoming_base_sbn, issue_date, is_vacant),
                            operator_name=extracted['operator_name'].upper() if extracted['operator_name'] else "",
                            address=extracted['address'].upper() if extracted['address'] else "",
                            motor_no=extracted['motor_no'].upper() if extracted['motor_no'] else "",
                            plate_no=clean_plate.upper() if clean_plate else "",
                            chassis_no=extracted['chassis_no'].upper() if extracted['chassis_no'] else "",
                            make=extracted['make'].upper() if extracted['make'] else "",
                            route=route_name,
                            driving_route=extracted['driving_route'].upper() if extracted.get('driving_route') else "",
                            issue_date=issue_date,
                            valid_until=datetime(issue_date.year, 12, 31) if issue_date else None,
                            processed_by=full_name,
                            is_active=False if is_vacant else determine_status(issue_date)
                        )
                        db.add(record)
                        sbn_map[incoming_base_sbn] = record
                        imported_count += 1
        except Exception as e:
            # ISO 25010 Functional Suitability: per-file error reporting with
            # the real cause (missing header, corrupt file), so a silent 0-row
            # import can never masquerade as success. The response surfaces it.
            error_msg = f"Failed importing {file.filename}: {str(e)}"
            force_log(error_msg)
            error_log.append(error_msg)
            continue

    db.commit()
    invalidate_ml_cache(route_name)

    dominant_route = get_dominant_driving_route(db, route_name)
    if dominant_route:
        for pr in db.query(FranchiseRecord).filter(FranchiseRecord.route == route_name, FranchiseRecord.is_deleted == False).all():
            curr_dr = str(pr.driving_route).strip().upper() if pr.driving_route else ""
            if curr_dr == "" or (curr_dr == "POBLACION" and dominant_route != "POBLACION"):
                pr.driving_route = dominant_route
        db.commit()

    clear_api_caches()
    log_msg = f"Imported/Updated {imported_count} records. Errors: {len(error_log)}"
    if force_overwrite:
        log_msg += " (FORCE OVERWRITE)"
    log_action(db, "SYSTEM_MIGRATION", "IMPORT", "0", route_name, log_msg)
    
    return {
        "imported": imported_count,
        "errors": error_log
    }

@app.post("/franchise/download/word/{record_id}")
async def download_word_doc(record_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    record = db.query(FranchiseRecord).filter(FranchiseRecord.id == record_id).first()
    if not record: raise HTTPException(status_code=404)
    settings = init_settings(db)
    
    is_vacant = not record.operator_name or str(record.operator_name).strip() == ""
    full_sbn = format_sbn_with_year(record.sbn_no, record.issue_date, is_vacant)
    
    cert_data = {
        "sbn_no": full_sbn, "operator_name": record.operator_name,
        "address": record.address, "motor_no": record.motor_no,
        "chassis_no": record.chassis_no, "make": record.make,
        "plate_no": record.plate_no, "route": record.route,
        "driving_route": record.driving_route,
        "issue_date": record.issue_date, "valid_until": record.valid_until
    }
    committee_data = {"committee_chair": settings.committee_chair}
    
    doc_path, media_type = await asyncio.to_thread(generate_certificate, cert_data, committee_data, return_format="docx")
    
    if os.path.exists(doc_path):
        log_action(db, get_full_name(current_user), "DOWNLOAD_DOCX", record.id, record.route, f"Downloaded raw MTOP Word Document for SBN {full_sbn}")
        headers = {'Content-Disposition': f'attachment; filename="{full_sbn}.docx"'}
        return FileResponse(path=doc_path, headers=headers, media_type=media_type)
        
    raise HTTPException(status_code=500)

@app.post("/franchise/generate/{record_id}")
async def generate_doc(record_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    record = db.query(FranchiseRecord).filter(FranchiseRecord.id == record_id).first()
    if not record: raise HTTPException(status_code=404)
    settings = init_settings(db)
    
    is_vacant = not record.operator_name or str(record.operator_name).strip() == ""
    full_sbn = format_sbn_with_year(record.sbn_no, record.issue_date, is_vacant)
    
    cert_data = {
        "sbn_no": full_sbn, "operator_name": record.operator_name,
        "address": record.address, "motor_no": record.motor_no,
        "chassis_no": record.chassis_no, "make": record.make,
        "plate_no": record.plate_no, "route": record.route,
        "driving_route": record.driving_route,
        "issue_date": record.issue_date, "valid_until": record.valid_until
    }
    committee_data = {"committee_chair": settings.committee_chair}

    doc_path, media_type = await asyncio.to_thread(generate_certificate, cert_data, committee_data, return_format="pdf")
    
    if os.path.exists(doc_path):
        log_action(db, get_full_name(current_user), "PRINT_MTOP", record.id, record.route, f"Generated MTOP Document for SBN {full_sbn}")
        headers = {'Content-Disposition': f'attachment; filename="{full_sbn}.pdf"'}
        return FileResponse(path=doc_path, headers=headers, media_type=media_type)
        
    raise HTTPException(status_code=500)

@app.post("/franchise/generate-batch")
async def generate_batch_docs(payload: BatchGenerateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        try:
            from PyPDF2 import PdfMerger
        except ImportError:
            from pypdf import PdfWriter as PdfMerger
    except ImportError:
        raise HTTPException(status_code=501, detail="PDF merging library not installed on server.")

    settings = init_settings(db)
    committee_data = {"committee_chair": settings.committee_chair}
    
    # 1. Fetch all records in a single fast DB query
    records = db.query(FranchiseRecord).filter(FranchiseRecord.id.in_(payload.record_ids)).all()
    if not records:
        raise HTTPException(status_code=404, detail="No valid records found.")

    # 2. Concurrently generate all .docx files in pure Python (Lightning fast)
    async def create_single_docx(record):
        is_vacant = not record.operator_name or str(record.operator_name).strip() == ""
        full_sbn = format_sbn_with_year(record.sbn_no, record.issue_date, is_vacant)
        
        cert_data = {
            "sbn_no": full_sbn, "operator_name": record.operator_name,
            "address": record.address, "motor_no": record.motor_no,
            "chassis_no": record.chassis_no, "make": record.make,
            "plate_no": record.plate_no, "route": record.route,
            "driving_route": record.driving_route,
            "issue_date": record.issue_date, "valid_until": record.valid_until
        }
        
        # Bypassing the slow per-file PDF conversion by requesting 'docx' format
        doc_path, _ = await asyncio.to_thread(generate_certificate, cert_data, committee_data, return_format="docx")
        return doc_path

    tasks = [create_single_docx(r) for r in records]
    docx_paths = await asyncio.gather(*tasks)
    docx_paths = [p for p in docx_paths if p and os.path.exists(p)]

    if not docx_paths:
        raise HTTPException(status_code=500, detail="Failed to generate template documents.")

    out_path = os.path.dirname(docx_paths[0])
    generated_pdfs = []

    # 3. Batch convert all DOCX to PDF using a SINGLE heavyweight application instance
    if platform.system() == "Windows":
        word = None
        try:
            import pythoncom
            import win32com.client
            pythoncom.CoInitialize()
            word = win32com.client.DispatchEx("Word.Application")
            word.Visible = False
            word.DisplayAlerts = 0
            
            # Process all documents without closing Word
            for docx_path in docx_paths:
                pdf_path = docx_path.replace(".docx", ".pdf")
                try:
                    doc_obj = word.Documents.Open(docx_path, ReadOnly=True)
                    doc_obj.SaveAs(pdf_path, FileFormat=17)
                    doc_obj.Close()
                    if os.path.exists(pdf_path):
                        generated_pdfs.append(pdf_path)
                except Exception as e:
                    force_log(f"Error converting {docx_path}: {e}")
        except Exception as e:
            force_log(f"Windows batch PDF conversion failed: {e}")
        finally:
            if word is not None:
                word.Quit()  # Quit only once at the very end
            try:
                pythoncom.CoUninitialize()
            except:
                pass
    else:
        # Linux LibreOffice batch conversion (chunked to prevent ARG_MAX shell limits)
        try:
            chunk_size = 150
            for i in range(0, len(docx_paths), chunk_size):
                chunk = docx_paths[i:i+chunk_size]
                subprocess.run(
                    ['libreoffice', '--headless', '--nologo', '--nofirststartwizard', '--convert-to', 'pdf', '--outdir', out_path] + chunk,
                    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
            for docx_path in docx_paths:
                pdf_path = docx_path.replace(".docx", ".pdf")
                if os.path.exists(pdf_path):
                    generated_pdfs.append(pdf_path)
        except Exception as e:
            force_log(f"Linux batch PDF conversion failed: {e}")

    if not generated_pdfs:
        raise HTTPException(status_code=500, detail="PDF conversion failed for the batch.")

    # 4. Merge everything into one PDF
    merged_filename = f"BATCH_PRINT_{int(time.time())}.pdf"
    merged_path = os.path.abspath(os.path.join(out_path, merged_filename))

    merger = PdfMerger()
    for pdf_file in generated_pdfs:
        merger.append(pdf_file)
    merger.write(merged_path)
    merger.close()

    # 5. Clean up the intermediate .docx and .pdf files to prevent disk bloating
    for p in docx_paths:
        try: os.remove(p)
        except: pass
    for p in generated_pdfs:
        try: os.remove(p)
        except: pass

    log_action(db, get_full_name(current_user), "BATCH_PRINT", "0", "MIXED", f"Generated and merged MTOP PDFs for {len(generated_pdfs)} records")
    
    headers = {'Content-Disposition': f'attachment; filename="{merged_filename}"'}
    return FileResponse(path=merged_path, headers=headers, media_type="application/pdf")

@app.get("/franchise/route/{route_name}")
def get_route_records(route_name: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    route_upper = alias_route(route_name)
    
    global _ROUTE_RECORDS_CACHE
    # Serve the fully serialized JSON payload when cached. Serializing 6,137
    # records to a ~3 MB JSON body costs over a second even when the ORM
    # objects themselves are cached, so the cache stores the finished bytes.
    cached = _ROUTE_RECORDS_CACHE.get(route_upper)
    if cached and time.time() - cached["time"] < 60:
        return JSONResponse(content=cached["data"], headers={"X-Cache": "hit"})

    if route_upper == "ALL":
        deduped_records = get_all_deduplicated_records(db)
    elif "," in route_upper:
        route_list = [alias_route(r.strip()) for r in route_upper.split(",")]
        records = db.query(FranchiseRecord).filter(
            FranchiseRecord.route.in_(route_list), 
            FranchiseRecord.is_deleted == False
        ).all()
        deduped_records = deduplicate_records_by_base_sbn(records)
    else:
        records = db.query(FranchiseRecord).filter(
            FranchiseRecord.route == route_upper, 
            FranchiseRecord.is_deleted == False
        ).all()
        deduped_records = deduplicate_records_by_base_sbn(records)

    for record in deduped_records:
        is_vac = not record.operator_name or str(record.operator_name).strip() == ""
        record.sbn_no = format_sbn_with_year(record.sbn_no, record.issue_date, is_vacant=is_vac)

    sorted_records = sorted(deduped_records, key=get_sbn_sort_key)
    result = [attach_status(r) for r in sorted_records]
    
    _ROUTE_RECORDS_CACHE[route_upper] = {
        "time": time.time(),
        "data": jsonable_encoder(result),
    }
    return JSONResponse(content=_ROUTE_RECORDS_CACHE[route_upper]["data"], headers={"X-Cache": "miss"})

@app.get("/api/route-info/{route_name}")
def get_route_info(route_name: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    route_upper = alias_route(route_name)
    display_name = ROUTE_DISPLAY_MAP.get(route_upper, f"{route_upper} REGISTRY")
    dominant_route = get_dominant_driving_route(db, route_upper)
    return {
        "route": route_upper,
        "display_name": display_name,
        "dominant_route": dominant_route
    }

@app.get("/franchise/status/inactive")
def get_inactive_records(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    records = db.query(FranchiseRecord).filter(FranchiseRecord.is_deleted == False).all()
    deduped = deduplicate_records_by_base_sbn(records)
    
    inactive_records = []
    for r in deduped:
        r_with_status = attach_status(r)
        if r_with_status.status in ["REVOKED", "VACANT"]:
            is_vac = not r_with_status.operator_name or str(r_with_status.operator_name).strip() == ""
            r_with_status.sbn_no = format_sbn_with_year(r_with_status.sbn_no, r_with_status.issue_date, is_vac)
            inactive_records.append(r_with_status)
            
    return sorted(inactive_records, key=get_sbn_sort_key)

@app.get("/predict/{route}")
def get_prediction(route: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return run_kmeans_clustering(db, alias_route(route))

@app.get("/export/masterlist/{route_name}")
def export_toda_masterlist(route_name: str, status_filter: str = "ALL", current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    route_upper = alias_route(route_name)
    if route_upper == "ALL":
        records_query = db.query(FranchiseRecord).filter(FranchiseRecord.is_deleted == False).all()
    else:
        records_query = db.query(FranchiseRecord).filter(FranchiseRecord.route == route_upper, FranchiseRecord.is_deleted == False).all()
        
    records_query = deduplicate_records_by_base_sbn(records_query)
    records_query = sorted(records_query, key=get_sbn_sort_key)
    current_year = get_pht_now().year
    
    filtered_records = []
    for r in records_query:
        computed_filter_status = compute_record_status(r)
        if status_filter == "ALL" or status_filter == computed_filter_status:
            filtered_records.append(r)

    if not filtered_records:
        raise HTTPException(status_code=404, detail="No records found matching this filter")
        
    csv_data = []
    for r in filtered_records:
        is_vacant = not r.operator_name or str(r.operator_name).strip() == ""
        formatted_sbn = normalize_base_sbn(r.sbn_no)
        
        csv_data.append({
            "SBN": escape_excel(formatted_sbn),
            "DATE OF RENEWAL": None if is_vacant else r.issue_date,
            "NAME": "" if is_vacant else escape_excel(r.operator_name),
            "MAKE": escape_excel(r.make), 
            "MOTOR NO.": escape_excel(r.motor_no),
            "CHASSIS NO.": escape_excel(r.chassis_no),
            "PLATE NO.": escape_excel(r.plate_no)
        })
        
    df = pd.DataFrame(csv_data)
    output = io.BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name="Masterlist", startrow=1)
        ws = writer.sheets['Masterlist']
        
        calibri_11 = Font(name="Calibri", size=11)
        calibri_11_bold = Font(name="Calibri", size=11, bold=True)
        calibri_16_bold = Font(name="Calibri", size=16, bold=True)
        
        fill_vacant = PatternFill(start_color="FF00B0F0", end_color="FF00B0F0", fill_type="solid")
        fill_y2_1 = PatternFill(start_color="FFBDD7EE", end_color="FFBDD7EE", fill_type="solid")
        fill_y3_7 = PatternFill(start_color="FF92D050", end_color="FF92D050", fill_type="solid")
        fill_y8 = PatternFill(start_color="FFFFFF00", end_color="FFFFFF00", fill_type="solid")
        
        for row in ws.iter_rows():
            for cell in row:
                cell.font = calibri_11

        total_row_count = len(filtered_records) + 2

        ws.merge_cells('A1:B1')
        ws['A1'] = f'=COUNTIFS(B3:B{total_row_count}, ">="&K5, B3:B{total_row_count}, "<="&K6)'
        ws['A1'].font = calibri_16_bold
        ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
        
        for col_num in range(1, 8):
            cell = ws.cell(row=2, column=col_num)
            cell.font = calibri_11_bold
            cell.alignment = Alignment(horizontal='center', vertical='center')
        
        ws['I3'] = "VACANT"
        ws['I3'].font = calibri_11_bold
        ws['I3'].fill = fill_vacant
        
        ws['I4'] = "2024-2025"
        ws['I4'].font = calibri_11_bold
        ws['I4'].fill = fill_y2_1
        
        ws['I5'] = "2019-2023"
        ws['I5'].font = calibri_11_bold
        ws['I5'].fill = fill_y3_7
        
        ws['I6'] = "2018"
        ws['I6'].font = calibri_11_bold
        ws['I6'].fill = fill_y8

        ws['J5'] = "Count:"
        ws['J5'].font = calibri_11_bold
        ws['J5'].alignment = Alignment(horizontal='right', vertical='center')
        ws['K5'] = f"{current_year}-01-01"
        ws['K5'].font = calibri_11
        ws['K6'] = f"{current_year}-12-31"
        ws['K6'].font = calibri_11

        for row_num, r_dict in enumerate(csv_data, start=3):
            op_name = str(r_dict["NAME"]).strip()
            issue_date = r_dict["DATE OF RENEWAL"]
            issue_year = issue_date.year if pd.notna(issue_date) else 0
            
            fill_color = None
            if not op_name or op_name == "'":
                fill_color = fill_vacant
            elif issue_year == current_year:
                fill_color = None
            elif issue_year == current_year - 1 or issue_year == current_year - 2:
                fill_color = fill_y2_1
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
                if col_num == 2 and cell.value:
                    cell.number_format = 'dd-mmm-yy'
        
        for col_idx in range(1, ws.max_column + 1):
            col_letter = get_column_letter(col_idx)
            if col_letter in ['I', 'J', 'K']:
                ws.column_dimensions[col_letter].width = 16
                continue
            
            max_length = 0
            for row_idx in range(1, ws.max_row + 1):
                cell_value = ws.cell(row=row_idx, column=col_idx).value
                if col_idx == 2 and cell_value: 
                    if 12 > max_length: max_length = 12
                elif cell_value:
                    length = len(str(cell_value))
                    if length > max_length:
                        max_length = length
            ws.column_dimensions[col_letter].width = max_length + 2

    output.seek(0)
    
    if status_filter == "ALL":
        filename_str = f"{route_upper} {current_year}.xlsx"
    else:
        filename_str = f"{route_upper} {current_year} - {status_filter.upper()}.xlsx"

    log_action(db, get_full_name(current_user), "EXPORT_MASTERLIST", "0", route_upper, f"Exported {status_filter} Masterlist for {route_upper}")
    
    headers = {
        'Content-Disposition': f'attachment; filename="{filename_str}"'
    }
    return Response(content=output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)

@app.get("/api/route-distribution")
def get_route_distribution(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    global _ROUTE_DIST_CACHE
    if time.time() - _ROUTE_DIST_CACHE["time"] < 60 and _ROUTE_DIST_CACHE["data"]:
        return _ROUTE_DIST_CACHE["data"]
        
    current_year = get_pht_now().year
    deduped_all = get_all_deduplicated_records(db)
    route_counts = {}
    for r in deduped_all:
        if r.issue_date and r.issue_date.year == current_year and r.operator_name and str(r.operator_name).strip() != "":
            route_counts[r.route] = route_counts.get(r.route, 0) + 1
    route_data = [{"route": route, "count": count} for route, count in sorted(route_counts.items())]
    
    _ROUTE_DIST_CACHE["data"] = route_data
    _ROUTE_DIST_CACHE["time"] = time.time()
    return route_data

@app.get("/api/stats")
def get_api_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_global_stats(db)

@app.get("/api/dashboard")
def get_api_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_global_stats(db)

@app.get("/stats/global")
def get_global_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    global _GLOBAL_STATS_CACHE
    if time.time() - _GLOBAL_STATS_CACHE["time"] < 60 and _GLOBAL_STATS_CACHE["data"]:
        return _GLOBAL_STATS_CACHE["data"]

    current_time = get_pht_now()
    current_year = current_time.year
    current_month = current_time.month
    today_str = current_time.strftime('%Y-%m-%d')
    start_of_week = (current_time - timedelta(days=current_time.weekday())).strftime('%Y-%m-%d')
    
    deduped_all = get_all_deduplicated_records(db)
    total_system_capacity = len(deduped_all)
    vacant_slots = sum(1 for r in deduped_all if not r.operator_name or str(r.operator_name).strip() == "")
    
    active_operators = sum(1 for r in deduped_all if r.issue_date and r.issue_date.year == current_year and r.operator_name and str(r.operator_name).strip() != "")
    flagged_pending = sum(1 for r in deduped_all if r.issue_date and r.issue_date.year == current_year - 1 and r.operator_name and str(r.operator_name).strip() != "")
    inactive_and_vacant = sum(1 for r in deduped_all if (not r.operator_name or str(r.operator_name).strip() == "") or (r.issue_date and r.issue_date.year <= current_year - 2) or not r.issue_date)

    daily_apps = sum(1 for r in deduped_all if r.issue_date and r.issue_date.strftime('%Y-%m-%d') == today_str)
    weekly_apps = sum(1 for r in deduped_all if r.issue_date and r.issue_date.strftime('%Y-%m-%d') >= start_of_week)
    monthly_apps = sum(1 for r in deduped_all if r.issue_date and r.issue_date.year == current_year and r.issue_date.month == current_month)
    yearly_apps = active_operators

    route_counts = {}
    route_totals = {}
    for r in deduped_all:
        route_totals[r.route] = route_totals.get(r.route, 0) + 1
        if r.issue_date and r.issue_date.year == current_year and r.operator_name and str(r.operator_name).strip() != "":
            route_counts[r.route] = route_counts.get(r.route, 0) + 1
            
    route_data = [
        {
            "route": route, 
            "total": route_totals[route], 
            "active": route_counts.get(route, 0), 
            "count": route_counts.get(route, 0) 
        } 
        for route in sorted(route_totals.keys())
    ]

    # DAILY TREND: every record ever, bucketed by weekday (Mon through Sun).
    # Deliberate design by the office: the shape shows how the work week is
    # distributed across days, not a moving window. Do not "fix" this.
    days_map = {'0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat'}
    daily_trend_dict = {d: 0 for d in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
    for r in deduped_all:
        if r.issue_date:
            day_idx = r.issue_date.strftime('%w')
            if day_idx in days_map:
                daily_trend_dict[days_map[day_idx]] += 1
    daily_trend = [{"name": k, "val": v} for k, v in daily_trend_dict.items()]
        
    weekly_trend = []
    for i in range(4, -1, -1):
        target_date = current_time - timedelta(days=current_time.weekday() + (i * 7))
        start_str = target_date.strftime('%Y-%m-%d')
        end_str = (target_date + timedelta(days=6)).strftime('%Y-%m-%d')
        count = sum(1 for r in deduped_all if r.issue_date and start_str <= r.issue_date.strftime('%Y-%m-%d') <= end_str)
        weekly_trend.append({"name": target_date.strftime('%b %d'), "val": count})

    monthly_trend = []
    for i in range(5, -1, -1):
        target_month = current_month - i
        target_year = current_year
        if target_month <= 0:
            target_month += 12
            target_year -= 1
        month_name = calendar.month_abbr[target_month]
        count = sum(1 for r in deduped_all if r.issue_date and r.issue_date.year == target_year and r.issue_date.month == target_month)
        monthly_trend.append({"name": month_name, "val": count})

    res = {
        "total_system_capacity": total_system_capacity,
        "vacant_slots": inactive_and_vacant,
        "daily_apps": daily_apps, "weekly_apps": weekly_apps, "monthly_apps": monthly_apps, "yearly_apps": yearly_apps,
        "flagged_pending": flagged_pending, "revoked": inactive_and_vacant, 
        "route_breakdown": route_data,
        "daily_trend": daily_trend,
        "weekly_trend": weekly_trend,
        "monthly_trend": monthly_trend
    }
    
    _GLOBAL_STATS_CACHE["data"] = jsonable_encoder(res)
    _GLOBAL_STATS_CACHE["time"] = time.time()
    return JSONResponse(content=_GLOBAL_STATS_CACHE["data"])

@app.get("/api/toda-summary")
def api_get_toda_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_toda_summary_data(db)

@app.post("/toda-summary/download/word")
async def download_toda_summary_word(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    settings = init_settings(db)
    summary_data = get_toda_summary_data(db)
    
    doc_path, media_type = await asyncio.to_thread(
        generate_toda_summary, summary_data, {"committee_chair": settings.committee_chair}, return_format="docx"
    )
    
    if os.path.exists(doc_path):
        year = summary_data["year"]
        filename_str = f"TOTAL RENEWAL {year}.docx"
        log_action(db, get_full_name(current_user), "EXPORT_TODA_SUMMARY", "0", "ALL", f"Downloaded TODA Summary Word Document for {year}")
        headers = {'Content-Disposition': f'attachment; filename="{filename_str}"'}
        return FileResponse(path=doc_path, headers=headers, media_type=media_type)
        
    raise HTTPException(status_code=500, detail="Document generation failed.")

@app.post("/toda-summary/generate")
async def generate_toda_summary_pdf(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    settings = init_settings(db)
    summary_data = get_toda_summary_data(db)
    
    doc_path, media_type = await asyncio.to_thread(
        generate_toda_summary, summary_data, {"committee_chair": settings.committee_chair}, return_format="pdf"
    )
    
    if os.path.exists(doc_path):
        year = summary_data["year"]
        filename_str = f"TOTAL RENEWAL {year}.pdf"
        log_action(db, get_full_name(current_user), "PRINT_TODA_SUMMARY", "0", "ALL", f"Generated TODA Summary PDF for {year}")
        headers = {'Content-Disposition': f'attachment; filename="{filename_str}"'}
        return FileResponse(path=doc_path, headers=headers, media_type=media_type)
        
    raise HTTPException(status_code=500, detail="Document generation failed.")

@app.get("/logs/record/{record_id}")
def get_record_history(record_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    logs = db.query(AuditLog).filter(AuditLog.target_id == record_id).order_by(AuditLog.timestamp.desc()).all()
    result = []
    
    for log in logs:
        log_dict = {c.name: getattr(log, c.name) for c in log.__table__.columns}
        
        cname = str(log_dict.get("clerk_name", "")).strip()
        if not cname or cname.lower() in ["none", "null"]:
            cname = "SYSTEM ADMIN"
            
        log_dict["clerk_name"] = cname
        log_dict["user"] = cname
        
        result.append(log_dict)
        
    return result

@app.get("/logs/actions")
def get_log_actions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # kasama na rin dito yung routes para may laman yung TODA filter sa logs page
    # (dating wala, kaya puro fallback list ang nakikita ng user)
    # ROUTES MEAN TODA LINES: system-level entries (route "SYSTEM"/"ALL") are
    # not TODA lines, so they never appear in the route filter. Those events
    # stay fully visible in the table and through the Actions filter.
    _NON_TODA_ROUTES = {"SYSTEM", "ALL", ""}
    routes = db.query(AuditLog.target_route).filter(
        AuditLog.target_route != None,
        AuditLog.target_route.notin_(_NON_TODA_ROUTES)).distinct().all()
    actions = db.query(AuditLog.action).filter(AuditLog.action != None).distinct().all()
    return {
        "routes": sorted({r[0].upper() for r in routes if r[0]}),
        "actions": sorted([a[0] for a in actions if a[0]])
    }

@app.get("/logs/change-motor")
def get_change_motor_logs(
    route: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Vuln hardening: cap pagination so page_size=999999 cannot dump the whole
    # audit table in one authenticated-but-careless request.
    page = max(1, min(page, 10_000))
    page_size = max(1, min(page_size, 500))
    query = db.query(AuditLog).filter(AuditLog.action == "CHANGE_MOTOR")
    if route and route.upper() != "ALL":
        query = query.filter(AuditLog.target_route == alias_route(route))
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (AuditLog.details.ilike(search_term)) |
            (AuditLog.clerk_name.ilike(search_term)) |
            (AuditLog.target_id.ilike(search_term)) |
            (AuditLog.operator_name.ilike(search_term)) |
            (AuditLog.sbn_no.ilike(search_term))
        )
    total_count = query.count()
    offset = (page - 1) * page_size
    logs = query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(page_size).all()
    
    result = []
    for log in logs:
        cname = str(log.clerk_name or "SYSTEM ADMIN").strip()
        if cname.lower() in ["none", "null", ""]: cname = "SYSTEM ADMIN"
        
        result.append({
            "id": log.id,
            "timestamp": log.timestamp.isoformat() if log.timestamp else "",
            "user": cname,
            "route": str(log.target_route or ""),
            "sbn_no": str(log.sbn_no or ""),
            "operator_name": str(log.operator_name or ""),
            "old_value": str(log.old_value or ""),
            "new_value": str(log.new_value or ""),
            "field_changed": str(log.field_changed or ""),
            "secondary_value": str(log.secondary_value or ""),
            "details": str(log.details or "")
        })
    return {"items": result, "total": total_count, "page": page, "page_size": page_size}

@app.get("/logs")
def get_audit_logs(
    route: Optional[str] = None, 
    action: Optional[str] = None,
    search: Optional[str] = None, 
    page: int = 1, 
    page_size: int = 50, 
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    # Vuln hardening: same pagination cap as /logs/change-motor.
    page = max(1, min(page, 10_000))
    page_size = max(1, min(page_size, 500))
    query = db.query(AuditLog)
    
    if route and route.upper() != "ALL":
        # Route filter = TODA lines only. "SYSTEM" is not a line; selecting it
        # would silently hide every row, so a SYSTEM pick shows the system
        # entries directly instead.
        if route.upper() == "SYSTEM":
            query = query.filter(AuditLog.target_route.in_(["SYSTEM", ""]))
        else:
            query = query.filter(AuditLog.target_route == alias_route(route))
    if action and action.upper() != "ALL":
        query = query.filter(AuditLog.action == action.upper())
        
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (AuditLog.action.ilike(search_term)) |
            (AuditLog.details.ilike(search_term)) |
            (AuditLog.clerk_name.ilike(search_term)) |
            (AuditLog.target_id.ilike(search_term))
        )
        
    total_count = query.count()
    offset = (page - 1) * page_size
    logs = query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(page_size).all()
    
    result = []
    for log in logs:
        log_dict = {c.name: getattr(log, c.name) for c in log.__table__.columns}
        
        tid = str(log_dict.get("target_id", ""))
        if len(tid) > 10:  
            rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == tid).first()
            if rec:
                val = f"{rec.sbn_no} ({rec.operator_name or 'VACANT'})"
            else:
                val = "Unknown / Deleted Record"
            # RAW id for the Activity Logs page: the delete row's "Request restore"
            # needs the actual record id to file a restore ticket — the pretty
            # "SBN (name)" display string in target_id/target_record cannot
            # address a record.
            log_dict["raw_record_id"] = tid
        else:
            val = tid if tid and tid != "0" else "SYSTEM"
            
        log_dict["target_id"] = val
        log_dict["target_record"] = val 
        
        cname = str(log_dict.get("clerk_name", "")).strip()
        if not cname or cname.lower() in ["none", "null"]:
            cname = "SYSTEM ADMIN"
            
        log_dict["clerk_name"] = cname
        log_dict["user"] = cname 
        
        result.append(log_dict)
        
    return {"items": result, "total": total_count, "page": page, "page_size": page_size}

@app.get("/export/logs/change-motor")
def export_change_motor_logs(
    route: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(AuditLog).filter(AuditLog.action == "CHANGE_MOTOR")
    if route and route.upper() != "ALL":
        query = query.filter(AuditLog.target_route == alias_route(route))
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (AuditLog.details.ilike(search_term)) |
            (AuditLog.clerk_name.ilike(search_term)) |
            (AuditLog.target_id.ilike(search_term)) |
            (AuditLog.operator_name.ilike(search_term)) |
            (AuditLog.sbn_no.ilike(search_term))
        )
    logs = query.order_by(AuditLog.timestamp.desc()).all()
    
    data = []
    for log in logs:
        data.append({
            "Route": str(log.target_route or ""),
            "SBN": str(log.sbn_no or ""),
            "Operator": str(log.operator_name or ""),
            "Field Changed": str(log.field_changed or ""),
            "Old Value": str(log.old_value or ""),
            "New Value": str(log.new_value or ""),
            "New Date Issued": str(log.secondary_value or "")
        })
    
    df = pd.DataFrame(data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        if not df.empty:
            df.to_excel(writer, index=False, sheet_name="Change Motor")
        else:
            pd.DataFrame([{"Message": "No logs found"}]).to_excel(writer, index=False, sheet_name="Change Motor")
    
    output.seek(0)
    current_year = get_pht_now().year
    filename_str = f"CHANGE MOTOR HISTORY {current_year}.xlsx"
    
    log_action(db, get_full_name(current_user), "EXPORT_LOGS", "0", "ALL", "Exported Change Motor Logs")
    
    headers = {'Content-Disposition': f'attachment; filename="{filename_str}"'}
    return Response(content=output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)

@app.get("/export/logs")
def export_audit_logs(
    route: Optional[str] = None, 
    action: Optional[str] = None,
    search: Optional[str] = None, 
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    query = db.query(AuditLog)
    
    if route and route.upper() != "ALL":
        # Same TODA-only rule as /logs: SYSTEM entries come through the
        # SYSTEM choice, never through a TODA line name.
        if route.upper() == "SYSTEM":
            query = query.filter(AuditLog.target_route.in_(["SYSTEM", ""]))
        else:
            query = query.filter(AuditLog.target_route == alias_route(route))
    if action and action.upper() != "ALL":
        query = query.filter(AuditLog.action == action.upper())
        
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (AuditLog.action.ilike(search_term)) |
            (AuditLog.details.ilike(search_term)) |
            (AuditLog.clerk_name.ilike(search_term)) |
            (AuditLog.target_id.ilike(search_term))
        )
        
    logs = query.order_by(AuditLog.timestamp.desc()).all()
    
    unified_data = []
    
    for log in logs:
        cname = str(log.clerk_name or "SYSTEM ADMIN").strip()
        if cname.lower() in ["none", "null", ""]: cname = "SYSTEM ADMIN"
        
        tid = str(log.target_id or "")
        rec_val = "Unknown / Deleted Record"
        if len(tid) > 10:
            rec = db.query(FranchiseRecord).filter(FranchiseRecord.id == tid).first()
            if rec: rec_val = f"{rec.sbn_no} ({rec.operator_name or 'VACANT'})"
        else:
            rec_val = tid if tid and tid != "0" else "SYSTEM"
            
        row = {
            "Timestamp": log.timestamp.strftime('%Y-%m-%d %H:%M:%S') if log.timestamp else "",
            "User": cname,
            "Action": str(log.action or ""),
            "Route": str(log.target_route or ""),
            "Target Record": rec_val,
            "Details": str(log.details or "")
        }
        unified_data.append(row)
            
    df_unified = pd.DataFrame(unified_data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        if not df_unified.empty:
            df_unified.to_excel(writer, index=False, sheet_name="All Activity Logs")
        else:
            pd.DataFrame([{"Message": "No logs found"}]).to_excel(writer, index=False, sheet_name="All Activity Logs")
            
    output.seek(0)
    
    current_year = get_pht_now().year
    filename_str = f"ACTIVITY LOGS {current_year}.xlsx"
    
    log_action(db, get_full_name(current_user), "EXPORT_LOGS", "0", "ALL", f"Exported Activity Logs for {current_year}")
    
    headers = {'Content-Disposition': f'attachment; filename="{filename_str}"'}
    return Response(content=output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)

@app.get("/export/mass")
def export_mass_backup(
    route: str = "ALL",
    year: str = "ALL",
    export_status: str = "ALL",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Yung 'Export Filtered Backup Files' button sa Settings page, dati walang
    endpoint sa backend kaya laging 'No records found' ang sagot kahit anong pindutin.
    Ngayon, gumagawa na tayo ng totoong ZIP: Excel masterlist + Word certificates
    ng mga records na tugma sa route/year/status na napili."""
    route_upper = alias_route(route)
    
    if route_upper == "ALL":
        records = db.query(FranchiseRecord).filter(FranchiseRecord.is_deleted == False).all()
    else:
        records = db.query(FranchiseRecord).filter(
            FranchiseRecord.route == route_upper,
            FranchiseRecord.is_deleted == False
        ).all()
    
    records = deduplicate_records_by_base_sbn(records)
    
    # Year gate: kapag specific year ang pinili, kunin lang yung records na issued nun
    if year and year.upper() != "ALL":
        try:
            target_year = int(year)
            records = [r for r in records if r.issue_date and r.issue_date.year == target_year]
        except ValueError:
            pass
    
    # Status gate: same logic sa compute_record_status para consistent sa ibang filters
    if export_status and export_status.upper() != "ALL":
        wanted = export_status.upper()
        records = [r for r in records if compute_record_status(r) == wanted]
    
    if not records:
        raise HTTPException(status_code=404, detail="No records found matching the selected filters.")
    
    records = sorted(records, key=get_sbn_sort_key)
    current_time = get_pht_now()
    
    # --- 1. Excel masterlist ---
    csv_data = []
    for r in records:
        is_vacant = not r.operator_name or str(r.operator_name).strip() == ""
        csv_data.append({
            "SBN": escape_excel(normalize_base_sbn(r.sbn_no)),
            "DATE OF RENEWAL": None if is_vacant else r.issue_date,
            "NAME": "" if is_vacant else escape_excel(r.operator_name),
            "ADDRESS": escape_excel(r.address),
            "MAKE": escape_excel(r.make),
            "MOTOR NO.": escape_excel(r.motor_no),
            "CHASSIS NO.": escape_excel(r.chassis_no),
            "PLATE NO.": escape_excel(r.plate_no)
        })
    
    df = pd.DataFrame(csv_data)
    xlsx_buffer = io.BytesIO()
    with pd.ExcelWriter(xlsx_buffer, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name="Masterlist")
    xlsx_buffer.seek(0)
    
    # --- 2. Word certificates (para hindi mabagal, docx muna bago i-zip) ---
    zip_buffer = io.BytesIO()
    settings = init_settings(db)
    committee_data = {"committee_chair": settings.committee_chair}
    
    doc_count = 0
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
        zipf.writestr("MASTERLIST.xlsx", xlsx_buffer.getvalue())
        
        for r in records:
            is_vacant = not r.operator_name or str(r.operator_name).strip() == ""
            if is_vacant:
                # walang kwentang gumawa ng certificate para sa vacant slot
                continue
            try:
                full_sbn = format_sbn_with_year(r.sbn_no, r.issue_date, is_vacant)
                cert_data = {
                    "sbn_no": full_sbn, "operator_name": r.operator_name,
                    "address": r.address, "motor_no": r.motor_no,
                    "chassis_no": r.chassis_no, "make": r.make,
                    "plate_no": r.plate_no, "route": r.route,
                    "driving_route": r.driving_route,
                    "issue_date": r.issue_date, "valid_until": r.valid_until
                }
                doc_path, _ = generate_certificate(cert_data, committee_data, return_format="docx")
                if doc_path and os.path.exists(doc_path):
                    zipf.write(doc_path, f"MTOP/{os.path.basename(doc_path)}")
                    try: os.remove(doc_path)
                    except OSError: pass
                    doc_count += 1
            except Exception as e:
                # hindi hadlang ang isang sirang record para matuloy yung buong export
                force_log(f"Mass export skipped a certificate ({r.sbn_no}): {e}")
                continue
    
    zip_buffer.seek(0)
    
    scope_label = route_upper if route_upper != "ALL" else "ALL ROUTES"
    filename_str = f"PASADA_EXPORT_{scope_label}_{year}_{export_status.upper()}.zip"
    
    log_action(db, get_full_name(current_user), "EXPORT_MASS", "0", scope_label,
               f"Mass export: {len(records)} records, {doc_count} certificates ({year}, {export_status.upper()})")
    
    headers = {'Content-Disposition': f'attachment; filename="{filename_str}"'}
    return Response(content=zip_buffer.getvalue(), media_type="application/zip", headers=headers)

def kill_zombie_port(port):
    try:
        if platform.system() == "Windows":
            output = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, stdin=subprocess.DEVNULL, stderr=subprocess.DEVNULL).decode()
            for line in output.strip().split('\n'):
                if "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    if str(pid) != str(os.getpid()):
                        force_log(f"CRITICAL: Found ghost process (PID: {pid}). Nuking it...")
                        subprocess.run(f"taskkill /PID {pid} /F", shell=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            try:
                output = subprocess.check_output(f"lsof -t -i:{port}", shell=True).decode()
                for pid in output.strip().split('\n'):
                    if pid and str(pid) != str(os.getpid()):
                        force_log(f"CRITICAL: Found ghost process (PID: {pid}). Nuking it...")
                        os.system(f"kill -9 {pid}")
            except Exception:
                output = subprocess.check_output(f"fuser {port}/tcp 2>/dev/null", shell=True).decode()
                for pid in output.strip().split():
                    if pid and str(pid) != str(os.getpid()):
                        force_log(f"CRITICAL: Found ghost process (PID: {pid}). Nuking it...")
                        os.system(f"kill -9 {pid}")
    except Exception as e:
        pass

def _log_bind_time(host, port):
    """Poll-loop that fires exactly once, when the port is first reachable.

    Diagnosing a remote office's slow boot needs one number in the crash
    log: how long from process start to "serving". uvicorn's own logs are
    quiet at warning level, so this watcher answers it. "bound and serving"
    from the log means the app UI's health probe will succeed on its very
    next tick; total process age = imports + bind, both visible here.
    """
    import socket as _socket
    probe_host = "127.0.0.1" if host in ("0.0.0.0", "", "::") else host
    deadline = time.time() + 600
    while time.time() < deadline:
        try:
            with _socket.create_connection((probe_host, port), timeout=0.5):
                force_log(
                    f"[TELEMETRY] Backend bound and serving at "
                    f"{time.time() - BOOT_T0:.1f}s after import finish "
                    f"(host={host}, port={port}), proc age "
                    f"{time.time() - PROC_T0:.1f}s"
                )
                return
        except OSError:
            time.sleep(0.2)
    force_log("[TELEMETRY] Backend did NOT bind within 600s after start")

if __name__ == "__main__":
    try:
        # SECOND INSTANCE (multi-screen lab / two-machine test harness): the
        # zombie scan would kill the first instance listening on 43888 under
        # a different loopback IP. Skip it on purpose when PASADA_SKIP_ZOMBIE_KILL=1.
        if os.environ.get("PASADA_SKIP_ZOMBIE_KILL", "") != "1":
            force_log(f"Scanning for zombie processes on Port {sync_engine.API_PORT}...")
            kill_zombie_port(sync_engine.API_PORT)
        else:
            force_log(f"PASADA_SKIP_ZOMBIE_KILL=1: skipping zombie scan on Port {sync_engine.API_PORT}.")
        force_log(f"Port {sync_engine.API_PORT} is clear. Starting Uvicorn server...")
        # DEPLOYMENT: the API listens on the LAN so the sync engine on other
        # office computers can pull records from this machine. Every pull
        # requires a valid HMAC signature from the cluster secret, so the LAN
        # exposure is authenticated; the app window itself keeps talking to
        # 127.0.0.1. Set PASADA_API_HOST to pin a specific interface.
        api_host = os.environ.get("PASADA_API_HOST", "0.0.0.0")
        # LAB OVERRIDE: PASADA_API_PORT moves the whole HTTP API (sync pulls
        # included — sync_engine.API_PORT reads the same var) so two instances
        # can run while a REAL copy of PASADA answers on 0.0.0.0:43888; without
        # it the lab's /health silently hits the real app instead and fails in
        # confusing ways.
        api_port = sync_engine.API_PORT
        print(f"[Backend] Starting Uvicorn server on http://{api_host}:{api_port} ...")
        sys.stdout.flush()
        # log_level="warning" quiets the per-request access-log lines. The
        # login/signup screens poll /health every 1s and the dashboard every
        # 15s, so at the default INFO level the terminal floods with a line
        # per GET and drowns out anything useful. Warnings and errors still
        # print, so real problems stay visible. Set PASADA_HTTP_ACCESS_LOG=1
        # to bring the access log back when debugging the wire.
        http_access_log = os.environ.get("PASADA_HTTP_ACCESS_LOG", "") == "1"
        # TELEMETRY: one background watcher thread, fires once on bind.
        threading.Thread(target=_log_bind_time, args=(api_host, api_port), daemon=True).start()
        uvicorn.run(app, host=api_host, port=api_port, log_level="warning", access_log=http_access_log)
    except Exception as e:
        err_str = traceback.format_exc()
        force_log(f"\n[{datetime.now()}] !!! SERVER EXECUTION FATAL ERROR !!!\n{err_str}")
        print(f"[Backend Fatal Error]: {err_str}", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)