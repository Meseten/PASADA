# ROUTE FACT SEEDER — fills route_data with the verified Naic census/road figures
# from the September 17, 2026 worksheet (PSA 2020 + OSM/NAMRIA). Idempotent: rows
# that already exist with the same values are left alone; existing office-corrected
# values are NOT overwritten silently (they win, because the person in the office
# may have entered something better after field checking).
#
# Run with:  python3 route_seed.py            (uses the real app data dir)
#            PASADA_DATA_DIR=/tmp/x python3 route_seed.py   (test dir)
#
# Optional CLI test without DB writes:
#            python3 route_seed.py --check

from database import SessionLocal, RouteData
from route_seed_data import ROUTES, ALIASES
from sqlalchemy import func
import sys


def seed_route_facts(db) -> dict:
    """Insert any missing route facts; report what happened. Never overwrites
    an existing row's values unless they are still the unset defaults."""
    added, left_as_is, corrected_defaults = [], [], []
    for name, population, road_km in ROUTES:
        row = db.query(RouteData).filter(RouteData.route_name == name).first()
        if row is None:
            db.add(RouteData(route_name=name, population=population, road_length_km=road_km))
            added.append(name)
        elif row.population == 5000 and row.road_length_km == 5.0:
            # Still the never-touched default: fill with the verified numbers.
            row.population = population
            row.road_length_km = road_km
            corrected_defaults.append(name)
        else:
            left_as_is.append(name)
    db.commit()
    return {"added": added, "filled_from_default": corrected_defaults, "kept_office_values": left_as_is}


if __name__ == "__main__":
    if "--check" in sys.argv:
        for name, population, road_km in ROUTES:
            print(f"{name:12s} pop={population:>6d}  road={road_km:>6.2f} km")
        print(f"\n{len(ROUTES)} routes; aliases: {len(ALIASES)}")
        sys.exit(0)

    db = SessionLocal()
    try:
        report = seed_route_facts(db)
        print("route facts seeded:",
              f"added {len(report['added'])},",
              f"filled defaults {len(report['filled_from_default'])},",
              f"kept office values {len(report['kept_office_values'])}")
        if report["added"]:
            print("  added:", ", ".join(report["added"]))
    finally:
        db.close()
