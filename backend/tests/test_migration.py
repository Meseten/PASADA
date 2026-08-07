# 25010 Characteristic: Reliability

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import sqlite3
from sqlalchemy import create_engine, inspect
from database import ensure_schema_upgrades

def test_legacy_db_migration():
    test_db = "test_legacy.db"
    if os.path.exists(test_db):
        os.remove(test_db)
    
    conn = sqlite3.connect(test_db)
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE franchise_records (id TEXT PRIMARY KEY, sbn_no TEXT)''')
    conn.commit()
    conn.close()
    
    engine = create_engine(f"sqlite:///{test_db}")
    ensure_schema_upgrades(engine)
    
    inspector = inspect(engine)
    columns = [c['name'] for c in inspector.get_columns("franchise_records")]
    
    assert "is_deleted" in columns, "Migration failed to add is_deleted column"
    
    if os.path.exists(test_db):
        os.remove(test_db)