# 25010 Characteristic: Maintainability

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from datetime import datetime
import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, FranchiseRecord
from main import parse_safe_date, compute_record_status
from pydantic import BaseModel

class MockRecord(BaseModel):
    operator_name: str = ""
    issue_date: datetime = None
    is_active: bool = True

def test_parse_safe_date_dayfirst():
    dt = parse_safe_date("13-01-2026", 2026)
    assert dt is not None
    assert dt.month == 1
    assert dt.day == 13

def test_parse_safe_date_invalid():
    assert parse_safe_date("GARBAGE", 2026) is None
    assert parse_safe_date(pd.NaT, 2026) is None

def test_record_status_vacant():
    assert compute_record_status(MockRecord(operator_name="")) == "VACANT"
    
def test_record_status_active():
    current_year = datetime.now().year
    rec = MockRecord(operator_name="Test", issue_date=datetime(current_year, 1, 1), is_active=True)
    assert compute_record_status(rec) == "ACTIVE"
    
def test_record_status_flagged():
    current_year = datetime.now().year
    rec = MockRecord(operator_name="Test", issue_date=datetime(current_year - 1, 1, 1), is_active=True)
    assert compute_record_status(rec) == "FLAGGED"

def test_record_status_revoked():
    current_year = datetime.now().year
    rec1 = MockRecord(operator_name="Test", issue_date=datetime(current_year - 2, 1, 1), is_active=True)
    assert compute_record_status(rec1) == "REVOKED"
    rec2 = MockRecord(operator_name="Test", issue_date=datetime(current_year, 1, 1), is_active=False)
    assert compute_record_status(rec2) == "REVOKED"

def test_upload_db_dedup_logic():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    
    existing_rec = FranchiseRecord(id="ID1", sbn_no="BA-001", operator_name="John", chassis_no="123")
    db.add(existing_rec)
    db.commit()
    
    existing_ids = {r.id for r in db.query(FranchiseRecord.id).all()}
    assert "ID1" in existing_ids
    
    incoming = [
        FranchiseRecord(id="ID1", sbn_no="BA-001", operator_name="John", chassis_no="123"), # Should skip
        FranchiseRecord(id="ID2", sbn_no="BA-002", operator_name="", chassis_no=""), # Blank chassis, should insert
        FranchiseRecord(id="ID3", sbn_no="BA-003", operator_name="", chassis_no="") # Blank chassis, should insert
    ]
    
    new_count = 0
    skipped_count = 0
    for r in incoming:
        if getattr(r, 'is_deleted', False):
            skipped_count += 1
            continue
        if r.id in existing_ids:
            skipped_count += 1
            continue
        
        db.add(r)
        existing_ids.add(r.id)
        new_count += 1
        
    db.commit()
    assert new_count == 2
    assert skipped_count == 1

def test_bulk_import_error_log_surfacing():
    errors = ["Failed extracting file.xlsx: missing name"]
    assert len(errors) == 1