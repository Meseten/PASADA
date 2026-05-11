from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import pytz
import os
import uuid

# production-safe persistent storage directory
USER_HOME = os.path.expanduser("~")
BASE_DIR = os.path.join(USER_HOME, "Documents", "PASADA_DATA")

if not os.path.exists(BASE_DIR):
    os.makedirs(BASE_DIR)

SQLALCHEMY_DATABASE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'pasada_production.db')}"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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
    committee_chair = Column(String, default="RODRIGO A. CASTILLO")
    enable_esignature = Column(Boolean, default=False)

Base.metadata.create_all(bind=engine)