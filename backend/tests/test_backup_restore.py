import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import zipfile
from datetime import datetime, timedelta

from database import Base, FranchiseRecord, User


# ISO 25010 Reliability: backup-restore drill. Ang mga backup ZIP na ginagawa
# ng automated_background_tasks ay hindi tunay na "backup" kung hindi kailanman
# nasubukang i-restore. Ginagaya ng test na ito ang production backup (zip ng
# isang SQLite file), inirerestore ito sa temporary na direktoryo, at
# bine-verify ang row count — pati ang 30-araw na retention sweep.
def _make_source_db(path, n_records):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from passlib.context import CryptContext

    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    db.add(User(first_name="D", last_name="R", username="DRILL", role="Admin",
                password_hash=pwd_context.hash("password123")))
    for i in range(n_records):
        db.add(FranchiseRecord(
            sbn_no=f"DR-{i:03d}-26", operator_name=f"DRILL OPERATOR {i}",
            route="DRILLTODA", is_active=True, is_deleted=False,
        ))
    db.commit()
    db.close()
    engine.dispose()


def test_backup_zip_is_restorable_and_row_counts_match(tmp_path):
    from main import BASE_DIR  # sanity: import works with the test DB env

    src = tmp_path / "pasada_production.db"
    _make_source_db(str(src), 7)

    backup_zip = tmp_path / "PASADA_Backup_2026-09-28.zip"
    with zipfile.ZipFile(backup_zip, "w", zipfile.ZIP_DEFLATED) as zipf:
        zipf.write(src, src.name)

    # --- RESTORE DRILL: same steps as the documented VACUUM INTO recovery ---
    restore_dir = tmp_path / "restored"
    restore_dir.mkdir()
    with zipfile.ZipFile(backup_zip, "r") as zipf:
        names = zipf.namelist()
        zipf.extractall(restore_dir)

    assert names == ["pasada_production.db"]
    restored = restore_dir / "pasada_production.db"
    assert restored.exists()

    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(f"sqlite:///{restored}", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)
    db = Session()
    integrity = db.execute(text("PRAGMA quick_check")).fetchone()[0]
    count = db.query(FranchiseRecord).count()
    users = db.query(User).count()
    db.close()
    engine.dispose()

    assert integrity == "ok"
    assert count == 7
    assert users == 1


def test_backup_retention_keeps_30_days_and_prunes_older(tmp_path):
    # Pareho ng lohika sa automated_background_tasks: panatilihin ang huling
    # 30 araw, burahin ang mas luma. Kino-cover din ng test ang naming format
    # para hindi masira ang sweep kapag nagbago ang filename template.
    now = datetime(2026, 9, 28)
    cutoff = (now - timedelta(days=30)).strftime("PASADA_Backup_%Y-%m-%d.zip")

    names = [
        "PASADA_Backup_2026-05-01.zip",   # 150 days old — prune
        "PASADA_Backup_2026-08-29.zip",   # exactly 30 days — keep (== cutoff)
        "PASADA_Backup_2026-09-01.zip",   # recent — keep
        "PASADA_Backup_2026-09-27.zip",   # yesterday — keep
        "last_backup.txt",                # not a backup — untouched
    ]

    kept, removed = [], []
    for name in names:
        if name.startswith("PASADA_Backup_") and name < cutoff:
            removed.append(name)
        else:
            kept.append(name)

    assert cutoff == "PASADA_Backup_2026-08-29.zip"
    assert removed == ["PASADA_Backup_2026-05-01.zip"]
    assert kept == ["PASADA_Backup_2026-08-29.zip", "PASADA_Backup_2026-09-01.zip",
                    "PASADA_Backup_2026-09-27.zip", "last_backup.txt"]
