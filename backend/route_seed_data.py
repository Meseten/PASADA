# PASADA route facts — from PASADA_Route_Data_Worksheet.pdf (FINAL VERIFIED edition,
# figures verified September 17, 2026). Sources inside that document: PSA 2020 census
# per-barangay (PhilAtlas), OpenStreetMap drivable roads clipped to NAMRIA/PSA barangay
# boundaries (naic_roadlengths.py), HDX COD-AB polygons (phl_admin4).
#
# HOW THE NUMBERS WERE BUILT (documented in the worksheet):
#   Population = sum of PSA 2020 barangay populations of the barangays each TODA
#   serves; barangays shared by two TODAs are split half, by three TODAs split thirds.
#   Road km = OpenStreetMap drivable network clipped to official barangay polygons
#   (includes private subdivision streets; worksheet documents this openly).
#
# Format: (route_name_stored_in_db, population, road_length_km)
#
# MEMBER CONFIRMED (Oct 2026): the office calls the Muzon TODA "DOMMSATODA"
# or just "DOMMSA". That spelling is canonical in the app; the worksheet's
# "DOMMSATODA" row label uses the same name. Older filings as "DOMSA" also redirect.

ROUTES = [
    ("BATODA",     5542,   5.73),   # Bancaan + 0.5xSapa (Sapa shared with BBSTODA)
    ("BBSTODA",    4129,   4.87),   # Bagong Karsada + Bucana Malaki + 0.5xSapa
    ("CNTODA",     6060,  43.97),   # 1/3 of Timalan Balsahan (shared with CO1, HVR)
    ("CO1TODA",    6060,  43.97),   # 1/3 of Timalan Balsahan (incl. Hillsview sitio)
    ("DOMMSATODA", 2161,  24.03),   # Muzon — office spelling DOMMSATODA / DOMMSA
    ("HCTODA",    31586,  93.76),   # Halang + Calubcob (Dorothea Homes spans both)
    ("HMTODA",     1472,   7.65),   # Humbac + Makina
    ("HVRTODA",    6060,  43.97),   # 1/3 of Timalan Balsahan — same territory as CO1TODA
    ("MALATODA",  11137,  50.52),   # Mabolo + Labac
    ("MMTODA",     5136,  55.32),   # Malainen Luma + Molino
    ("MMGTODA",    5443,  13.68),   # Munting Mapino
    ("NPTODA",    21127,  33.68),   # Poblacion barangays + all unassigned (incl. whole Ibayo Silangan, disclosed overlap with VASTODA)
    ("PAL1TODA",   4409,  30.46),   # Palangue 1 ("Palangue Central" official name)
    ("PAL2TODA",   3700,  44.48),   # Palangue 2 & 3 (one official barangay)
    ("SABANGTODA",21938,  92.86),   # Sabang (also hosts CN Phases 1/2/5 on OSM — documented, not deducted)
    ("SMSTODA",   14505,  88.05),   # San Roque + Malainen Bago + Santulan
    ("TCTODA",     4563,  20.62),   # Timalan Concepcion
    ("VASTODA",   10541,  19.88),   # Ibayo Silangan as subdivision host (client-verified)
    ("VISTODA",    5960,   7.13),   # Bucana Sasahan (Freedom Ville, client-confirmed Sept 17)
]

# Spelling variants the office types that must resolve to the same row.
# alias_route() in main.py already maps NCTODA -> NPTODA; this adds the
# worksheet's own variants so seeding stays idempotent regardless of input.
ALIASES = {
    "DOMSA":      "DOMMSATODA",  # older spelling, office confirmed DOMMSA/DOMMSATODA canonical
    "DOMSATODA":  "DOMMSATODA",
    "DOMMSA":     "DOMMSATODA",  # already canonical
    "BBS":        "BBSTODA",
    "BATO":       "BATODA",
    "CNT":        "CNTODA",
    "CO1":        "CO1TODA",
    "HVR":        "HVRTODA",
    "HVRT":       "HVRTODA",
    "HILLSVIEW":  "HVRTODA",
    "MALA":       "MALATODA",
    "PAL1":       "PAL1TODA",
    "PAL2":       "PAL2TODA",
    "SABANG":     "SABANGTODA",
    "SMS":        "SMSTODA",
    "TC":         "TCTODA",
    "VAS":        "VASTODA",
    "VAST":       "VASTODA",
    "VIS":        "VISTODA",
    "VIST":       "VISTODA",
}
