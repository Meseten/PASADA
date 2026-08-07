# 25010 Characteristic: Reliability

from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Float, event
from sqlalchemy.ext.declarative import declarative_base
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

NEW_BASE_DIR = platformdirs.user_data_dir("PASADA", "LGU")
new_db_path = os.path.join(NEW_BASE_DIR, 'pasada_production.db')

if not os.path.exists(NEW_BASE_DIR):
    os.makedirs(NEW_BASE_DIR)

# 2. AUTO-MIGRATION: Rescues the old database so no data is lost
if os.path.exists(old_db_path) and not os.path.exists(new_db_path):
    shutil.copy2(old_db_path, new_db_path)

SQLALCHEMY_DATABASE_URL = f"sqlite:///{new_db_path}"

# Database connection
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})

# CONCURRENCY FIX: Enable WAL mode and Busy Timeout to prevent "database is locked" errors
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
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

Base.metadata.create_all(bind=engine)

# --- LEGACY DB MIGRATION HEALING ---
def ensure_schema_upgrades(engine):
    inspector = inspect(engine)
    if "franchise_records" in inspector.get_table_names():
        columns = [col['name'] for col in inspector.get_columns("franchise_records")]
        if "is_deleted" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE franchise_records ADD COLUMN is_deleted BOOLEAN DEFAULT 0"))

ensure_schema_upgrades(engine)

# Keep BASE_DIR pointing to the new cross-platform directory for backups, etc.
BASE_DIR = NEW_BASE_DIR