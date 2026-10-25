# 25010 Characteristic: Reliability

from sqlalchemy import create_engine, Column, Integer, String, Text, Boolean, DateTime, Float, event
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import inspect, text
from datetime import datetime
import pytz
import os
import uuid
import platformdirs
import shutil

# 1. DEFINE OLD AND NEW PATHS
old_app_data = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
OLD_BASE_DIR = os.path.join(old_app_data, "PASADA_DATA")
old_db_path = os.path.join(OLD_BASE_DIR, 'pasada_production.db')
old_jwt_path = os.path.join(OLD_BASE_DIR, 'jwt_secret.key')

# New cross-platform secure directory.
# PASADA_DATA_DIR override: point the whole app (db, jwt, backups, exports,
# templates) at a scratch folder. Used by the end-to-end test harness and for
# running a second, isolated instance on one machine without touching real
# office data. When unset, behaviour is exactly as before.
_data_dir_override = os.environ.get('PASADA_DATA_DIR', '').strip()
if _data_dir_override:
    NEW_BASE_DIR = os.path.abspath(_data_dir_override)
else:
    NEW_BASE_DIR = platformdirs.user_data_dir("PASADA", "LGU")
new_db_path = os.path.join(NEW_BASE_DIR, 'pasada_production.db')
new_jwt_path = os.path.join(NEW_BASE_DIR, 'jwt_secret.key')

if not os.path.exists(NEW_BASE_DIR):
    os.makedirs(NEW_BASE_DIR)

# 2. AUTO-MIGRATION: Rescues the old database and JWT secrets so no data or session is lost.
# Skipped when PASADA_DATA_DIR is set: an explicit scratch/test dir must stay
# hermetic (a test run must never inherit a real office database).
if not _data_dir_override:
    if os.path.exists(old_db_path) and not os.path.exists(new_db_path):
        shutil.copy2(old_db_path, new_db_path)

    if os.path.exists(old_jwt_path) and not os.path.exists(new_jwt_path):
        shutil.copy2(old_jwt_path, new_jwt_path)

# INCREASED TIMEOUT to 30 seconds (Restored from non-ISO) to allow queries to queue
SQLALCHEMY_DATABASE_URL = f"sqlite:///{new_db_path}"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30})

# ==============================================================================
# SQLITE WAL MODE ACTIVATION (CONCURRENCY FIX)
# ==============================================================================
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    # Restored from non-ISO: Enforce 30-second busy timeout at the pragma level
    cursor.execute("PRAGMA busy_timeout=30000") 
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_pht_now():
    return datetime.now(pytz.timezone('Asia/Manila'))

def generate_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String)
    last_name = Column(String)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String)
    # DEACTIVATION (not deletion): an Admin can switch an account off when its
    # person leaves the office. History, records, and audit entries stay; only
    # sign-in is blocked. Default 0 (active) so the schema upgrade leaves every
    # existing account exactly as it was.
    is_deactivated = Column(Boolean, default=False, nullable=True)
    # ACCOUNT EDIT TIMESTAMP (2026-10-24 role-flip fix): records WHEN this
    # account's password, role, or deactivation last changed. Older installs
    # have no timestamps, so every machine's pull won and roles ping-ponged
    # between computers ("Admin turned Clerk, Clerk turned Admin"). Merges
    # now only adopt a peer's change when its timestamp is newer.
    updated_at = Column(DateTime, nullable=True)
    # LAST SIGN-IN: roams with the account so "Last seen" agrees on every
    # computer (it used to be per-machine audit history only, which showed
    # "Never" for accounts that sign in on another computer).
    last_signin_at = Column(DateTime, nullable=True)
    # ACCOUNT OWNER (2026-10-25): machine fingerprint of the computer where
    # this account was CREATED. When a new or reinstalled computer registers
    # the same username, its fresh copy carries a different fingerprint, so
    # the pull merge REFUSES to let it overwrite an owner machine's live copy
    # (role, password, deactivation). A newly connected computer therefore
    # cannot change the office's existing accounts — it can only receive
    # them. Edits made on any computer keep the original fingerprint and
    # still propagate to everyone.
    create_origin = Column(String, nullable=True)
    # ACCOUNT RECOVERY: three office-friendly security questions answered at
    # signup or from Settings. Only the bcrypt hash of each answer is stored,
    # never the text, and the hashes never leave this machine through sync.
    security_q1 = Column(String, nullable=True)
    security_q2 = Column(String, nullable=True)
    security_q3 = Column(String, nullable=True)
    security_a1_hash = Column(String, nullable=True)
    security_a2_hash = Column(String, nullable=True)
    security_a3_hash = Column(String, nullable=True)

class FranchiseRecord(Base):
    __tablename__ = "franchise_records"
    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    sbn_no = Column(String, index=True)
    operator_name = Column(String, index=True)
    address = Column(String)
    motor_no = Column(String)
    chassis_no = Column(String)
    make = Column(String)
    plate_no = Column(String)
    route = Column(String, index=True)
    driving_route = Column(String) 
    issue_date = Column(DateTime)
    valid_until = Column(DateTime)
    is_active = Column(Boolean, default=True)
    processed_by = Column(String)
    updated_at = Column(DateTime, default=get_pht_now, onupdate=get_pht_now)
    # REQUIRED FOR ISO MAIN.PY COMPATIBILITY
    is_deleted = Column(Boolean, default=False, index=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    timestamp = Column(DateTime, default=get_pht_now)
    clerk_name = Column(String)
    action = Column(String)
    target_id = Column(String)
    target_route = Column(String)
    details = Column(String)
    # --- NEW STRUCTURED AUDIT FIELDS ---
    operator_name = Column(String, nullable=True)
    sbn_no = Column(String, nullable=True)
    field_changed = Column(String, nullable=True)
    old_value = Column(String, nullable=True)
    new_value = Column(String, nullable=True)
    secondary_value = Column(String, nullable=True)
    ip_or_source = Column(String, nullable=True)
    # EDIT SNAPSHOT (2026-10-25): every record edit stores the record's full
    # pre-edit values here as JSON text, so any edit — plain edit, change
    # motor, or renewal — can be undone button-by-button from the record's
    # History (and from the success toast right after saving). Plain text
    # JSON on purpose: no new table, heals on old databases, syncs as-is.
    before_values = Column(Text, nullable=True)

class SystemSettings(Base):
    __tablename__ = "system_settings"
    id = Column(Integer, primary_key=True, index=True)
    committee_chair = Column(String, default="HON. RODRIGO A. CASTILLO")
    enable_esignature = Column(Boolean, default=False)

class RouteData(Base):
    __tablename__ = "route_data"
    id = Column(Integer, primary_key=True, index=True)
    route_name = Column(String, unique=True, index=True)
    population = Column(Integer, default=5000)      
    road_length_km = Column(Float, default=5.0)     

class ApprovalTicket(Base):
    """ADMIN APPROVAL TICKETS.

    A clerk can ASK for the big, hard-to-undo actions (delete a whole route,
    rename a route, restore deleted records, restore the database from a
    backup) without ever being able to DO them alone. The request lands here
    as a ticket; the Admin approves or rejects it; the action runs only on
    approval. One row = one proposed action, with the payload it needs stored
    as JSON text. Rejected tickets stay for the record (AUDIT-ability) and are
    never re-run.
    """
    __tablename__ = "approval_tickets"
    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    created_at = Column(DateTime, default=get_pht_now)
    created_by = Column(String, index=True)          # full name of requester
    ticket_type = Column(String, index=True)         # route_delete | route_rename | record_restore | db_restore
    payload_json = Column(String)                    # arguments the action needs
    reason = Column(String, nullable=True)           # clerk's why, shown to admin
    status = Column(String, default="pending", index=True)  # pending | approved | rejected
    decided_by = Column(String, nullable=True)       # admin who decided
    decided_at = Column(DateTime, nullable=True)
    result_note = Column(String, nullable=True)      # what happened on execution

Base.metadata.create_all(bind=engine)

# --- UNIVERSAL DB MIGRATION HEALING ---
def ensure_schema_upgrades(engine):
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    
    with engine.begin() as conn:
        for table_name, model_class in [
            ("users", User),
            ("franchise_records", FranchiseRecord),
            ("audit_logs", AuditLog),
            ("system_settings", SystemSettings),
            ("route_data", RouteData),
            ("approval_tickets", ApprovalTicket)
        ]:
            if table_name in existing_tables:
                db_columns = [col['name'] for col in inspector.get_columns(table_name)]
                for column in model_class.__table__.columns:
                    if column.name not in db_columns:
                        col_type_str = str(column.type).upper()
                        
                        if "INT" in col_type_str:
                            sql_type = "INTEGER"
                            default_val = "0"
                        elif "BOOL" in col_type_str:
                            sql_type = "BOOLEAN"
                            default_val = "0"
                        elif "FLOAT" in col_type_str:
                            sql_type = "FLOAT"
                            default_val = "0.0"
                        elif "DATETIME" in col_type_str:
                            sql_type = "DATETIME"
                            default_val = "NULL"
                        else:
                            sql_type = "VARCHAR"
                            default_val = "''"
                            
                        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column.name} {sql_type} DEFAULT {default_val}"))

ensure_schema_upgrades(engine)

# Keep BASE_DIR pointing to the new cross-platform directory for backups, etc.
BASE_DIR = NEW_BASE_DIR