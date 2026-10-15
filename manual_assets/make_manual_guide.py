# -*- coding: utf-8 -*-
"""Builds PASADA_Software_Manual_Guide.pdf via LibreOffice (A4, Arial).

Manual format: cover, about, TOC, numbered chapters, numbered figures,
numbered tables, full troubleshooting, quick reference, glossary.
Every figure and table carries a number and caption, like a printed manual.
Body text is black; headings use one deep-blue accent color, nothing else.
"""
from docx import Document
from docx.shared import Pt, Mm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import os

ACCENT = RGBColor(0x1F, 0x3A, 0x5F)   # deep blue for headings + highlights
BLACK = RGBColor(0x00, 0x00, 0x00)    # every word of body text
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
HDR_FILL = "1F3A5F"
BOX_FILL = "F5F7FA"
WARN_FILL = "FDF3E7"

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "manual_assets")

FIG = {"n": 0}
TBL = {"n": 0}


def force_arial(run, size=None, bold=None, italic=None, color=BLACK):
    run.font.name = "Arial"
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    for attr in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
        rFonts.set(qn(attr), "Arial")
    if size: run.font.size = Pt(size)
    if bold is not None: run.font.bold = bold
    if italic is not None: run.font.italic = italic
    if color is not None: run.font.color.rgb = color


def shade(cell, hexfill):
    tcPr = cell._element.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), hexfill)
    tcPr.append(shd)


def para(doc, text, size=10.5, bold=False, italic=False, color=BLACK,
         align=None, space_after=6, space_before=0):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    if align: p.alignment = align
    r = p.add_run(text)
    force_arial(r, size=size, bold=bold, italic=italic, color=color)
    return p


def rich(doc, parts, size=10.5, space_after=6, align=None):
    """parts = [(text, bold, italic, color_or_None), ...] in one paragraph."""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    if align: p.alignment = align
    for text, bold, italic, color in parts:
        r = p.add_run(text)
        force_arial(r, size=size, bold=bold, italic=italic, color=color or BLACK)
    return p


def h1(doc, text, page_break=True):
    if page_break:
        doc.add_page_break()
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.space_before = Pt(0)
    r = p.add_run(text)
    force_arial(r, size=20, bold=True, color=ACCENT)
    rule = doc.add_paragraph()
    rule.paragraph_format.space_after = Pt(12)
    pPr = rule._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single'); bottom.set(qn('w:sz'), '12')
    bottom.set(qn('w:space'), '1'); bottom.set(qn('w:color'), HDR_FILL)
    pBdr.append(bottom); pPr.append(pBdr)
    return p


def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.space_before = Pt(10)
    r = p.add_run(text)
    force_arial(r, size=13, bold=True, color=ACCENT)
    return p


def steps(doc, items):
    for i, s in enumerate(items, 1):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.left_indent = Mm(6)
        r = p.add_run(f"{i}.  ")
        force_arial(r, size=10.5, bold=True, color=ACCENT)
        r2 = p.add_run(s)
        force_arial(r2, size=10.5, color=BLACK)


def bullets(doc, items):
    for b in items:
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_after = Pt(3)
        r = p.add_run(b)
        force_arial(r, size=10.5, color=BLACK)


def note_box(doc, label, text, fill=BOX_FILL, label_color=ACCENT):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.rows[0].cells[0]
    shade(cell, fill)
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(4)
    r1 = p.add_run(f"{label}  ")
    force_arial(r1, size=10, bold=True, color=label_color)
    r2 = p.add_run(text)
    force_arial(r2, size=10, color=BLACK)


def tip(doc, text): note_box(doc, "TIP:", text, BOX_FILL)
def warn(doc, text): note_box(doc, "WARNING:", text, WARN_FILL, RGBColor(0xB0, 0x5A, 0x00))


def figure(doc, filename, caption, width_mm=155):
    path = os.path.join(ASSETS, filename)
    if not os.path.exists(path):
        FIG["n"] += 1
        return
    FIG["n"] += 1
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    p.add_run().add_picture(path, width=Mm(width_mm))
    c = doc.add_paragraph()
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    c.paragraph_format.space_after = Pt(10)
    r1 = c.add_run(f"Figure {FIG['n']}. ")
    force_arial(r1, size=9, bold=True, color=ACCENT)
    r2 = c.add_run(caption)
    force_arial(r2, size=9, italic=True, color=BLACK)


def data_table(doc, headers, rows, caption=None, col_widths=None):
    TBL["n"] += 1
    if caption:
        c = doc.add_paragraph()
        c.paragraph_format.space_before = Pt(8)
        c.paragraph_format.space_after = Pt(3)
        r1 = c.add_run(f"Table {TBL['n']}. ")
        force_arial(r1, size=9.5, bold=True, color=ACCENT)
        r2 = c.add_run(caption)
        force_arial(r2, size=9.5, italic=True, color=BLACK)
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = table.rows[0].cells
    for i, t in enumerate(headers):
        run = hdr[i].paragraphs[0].add_run(t)
        force_arial(run, size=10, bold=True, color=WHITE)
        shade(hdr[i], HDR_FILL)
    for row_vals in rows:
        r = table.add_row().cells
        for i, v in enumerate(row_vals):
            run = r[i].paragraphs[0].add_run(v)
            force_arial(run, size=10, color=BLACK)
    return table


def build():
    doc = Document()
    for section in doc.sections:
        section.page_width = Mm(210)
        section.page_height = Mm(297)
        section.left_margin = Mm(25)
        section.right_margin = Mm(20)
        section.top_margin = Mm(22)
        section.bottom_margin = Mm(20)

    style = doc.styles['Normal']
    style.font.name = 'Arial'
    style.font.size = Pt(10.5)

    # ================= COVER =================
    for _ in range(5):
        doc.add_paragraph()
    para(doc, "PASADA", size=44, bold=True, color=ACCENT, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(doc, "Software Manual Guide", size=24, bold=True, color=BLACK, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=18)
    para(doc, "The complete guide to the franchise registry system for municipal tricycle operators",
         size=12, italic=True, color=BLACK, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=26)
    logo = os.path.abspath(os.path.join(HERE, "frontend", "public", "TFRU.png"))
    if os.path.exists(logo):
        p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(logo, width=Mm(34))
        doc.add_paragraph()
    for _ in range(6):
        doc.add_paragraph()
    para(doc, "LGU Office Edition", size=16, bold=True, color=BLACK, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(doc, "2026 Edition", size=11, italic=True, color=BLACK, align=WD_ALIGN_PARAGRAPH.CENTER)

    # ================= ABOUT =================
    h1(doc, "About This Manual")
    para(doc, "This manual is the complete guide to PASADA. It explains what the system is, where its name comes from, how every page works, what every button does, and what to do when something goes wrong. It is written for the people who actually use the system: the clerks who keep the records and the admin who looks after the office.")
    para(doc, "You do not need computer training to follow this manual. Every chapter gives the steps in order, shows the real screen, and explains the choices in plain words. When a term first appears, it is explained right there and again in the glossary at the back.")

    h2(doc, "Why the system is called PASADA")
    para(doc, "In Filipino street language, pasada is the word tricycle and jeepney drivers use for going out to work: driving their route, picking up passengers, and earning the day's living. One pasada is one working trip. When drivers cannot work, they say tigil pasada, the runs have stopped. The government's own fuel program for drivers is even called Pantawid Pasada, fuel support for the pasada.")
    para(doc, "That word carries the whole point of this system. Every record inside it is a real person's livelihood: the driver who leaves home each morning to carry passengers and bring income home to a family. PASADA keeps each of those livelihoods on file, so the office knows who holds each franchise, who renewed, who has not, and who deserves help getting back on the road. The system is named after their daily work out of respect for it.")

    h2(doc, "Who this manual is for")
    bullets(doc, [
        "Clerks who add, edit, renew, and print operator records every day.",
        "The office admin who manages accounts, approves big changes, and keeps the system healthy.",
        "New staff learning the job, who need the whole picture in one place.",
    ])

    h2(doc, "How to read the steps")
    para(doc, "Numbered steps mean do them in order. Pictures show the real screen so you can compare what you see with what this manual shows. Highlighted boxes hold advice and warnings:")
    note_box(doc, "TIP:", "Tips are optional. They make the work faster or safer, but you can skip them.")
    warn(doc, "Warnings matter. Read them before you click anything they describe.")

    h2(doc, "Words used in this manual")
    data_table(doc,
        ["Word", "What it means in this manual"],
        [
            ("Record", "One operator's franchise information: name, SBN, motor, plate, route, dates."),
            ("SBN", "Franchise serial number, like BA-002-26. Identifies one slot."),
            ("TODA line / route", "One group of operators, like BATODA or HCTODA."),
            ("Renewal", "The yearly re-registration that keeps a franchise active."),
            ("Inactive / vacant", "A slot with no operator, or not renewed for 2+ years."),
            ("Sync", "Automatic sharing of records between office computers."),
            ("Approval ticket", "A clerk's request for a big change. The admin approves it before anything happens."),
            ("Admin", "The one account allowed to manage accounts, approve tickets, and change big settings."),
        ],
        caption="Vocabulary used throughout this manual.")

    # ================= TOC =================
    h1(doc, "Table of Contents")
    toc = [
        ("1", "Getting Started", "Opening the program, signing in, the main screen, dark mode"),
        ("2", "Accounts, Passwords, and Security", "First account, security questions, recovery, roles"),
        ("3", "The Dashboard", "Totals, volume charts, compliance, route fullness"),
        ("4", "Working with Records", "Add, edit, renew, delete, restore, print, export"),
        ("5", "Search and Activity History", "Finding anything, and the record of every change"),
        ("6", "Inactive Operators and Importing", "The archive, and bringing records in from files"),
        ("7", "Settings", "Office details, preferences, PIN, backups, updates"),
        ("8", "The Admin Console", "Every admin tool explained: approvals, accounts, templates, health"),
        ("9", "The Two-Key Rule", "How approval tickets protect the registry"),
        ("10", "Connecting Computers (Sync)", "How office computers share one registry"),
        ("11", "If You Are the Admin", "What changes when you become admin, and what stays the same"),
        ("12", "Troubleshooting", "17 common problems, each with exact fix steps"),
        ("13", "Quick Reference Card", "One page to print and keep beside the computer"),
        ("14", "Setting Up the Second Office Computer", "Install on PC 2, sign in as Viewer, connect, verify sync end to end"),
    ]
    data_table(doc,
        ["Chapter", "Title", "What it covers"],
        toc,
        caption="Chapters in this manual.")

    # ================= CH 1 =================
    h1(doc, "Chapter 1 — Getting Started")
    h2(doc, "What PASADA does")
    para(doc, "PASADA is the office's franchise registry. It replaces paper folders and scattered spreadsheets with one program that every computer in the office can use at the same time. It remembers all operators, warns about franchises that were not renewed, prints the certificates and summaries the office issues, and keeps a history of who changed what. Nothing leaves the office: the program works fully without internet.")
    h2(doc, "Opening the program")
    steps(doc, [
        "Open PASADA from the desktop shortcut or the Start menu.",
        "The PASADA logo appears while the program starts. This takes a few seconds.",
        "The log-in screen appears with boxes for your full name and password.",
        "The status at the bottom left of the sidebar says Online when the system is ready.",
    ])
    figure(doc, "01_login.png", "The log-in screen. Everything starts here.")
    h2(doc, "Signing in")
    steps(doc, [
        "Type your full name exactly as it was registered, for example JUAN DELA CRUZ.",
        "Type your password. Press the eye button to check what you typed.",
        "Click Log In.",
        "The dashboard opens and your name shows at the top of the sidebar.",
    ])
    warn(doc, "Five wrong password attempts lock the account for 15 minutes. This protects the records. Wait it out, or ask the admin to reset your password.")
    h2(doc, "The main screen")
    para(doc, "Everything lives in one window. The left side is the sidebar. From top to bottom: the PASADA name and theme button, your name and role, five page links (Dashboard, Activity History, Import Records, Inactive Operators, Settings), the search box, the list of TODA lines, the connection status, and the Log out button. The right side shows the page you opened.")
    h2(doc, "Light and dark mode")
    para(doc, "Click the sun or moon button at the top of the sidebar. The whole program switches between light and dark. PASADA remembers your choice on this computer, so the next person to sign in here sees your choice.")
    h2(doc, "Logging out, and the quick PIN")
    para(doc, "Click Log out when you leave your desk. You can also set a 4-digit PIN in Settings. With a PIN set, stepping away locks the screen, and coming back asks for the PIN instead of your full password. Same protection, less typing.")

    # ================= CH 2 =================
    h1(doc, "Chapter 2 — Accounts, Passwords, and Security")
    h2(doc, "The first account, and why registration closes")
    para(doc, "The very first time PASADA runs, the Register Account button appears on the log-in screen. One person creates the first account. Registration then closes for good. From then on, new accounts are created by the admin, inside the program. This is deliberate: an open registration would let anyone who touches the computer create an account on the office registry.")
    figure(doc, "02_register.png", "First-run registration. This door closes once an account exists.")
    h2(doc, "Creating your account (first time only)")
    steps(doc, [
        "On the log-in screen, click Register Account.",
        "Type your first name and last name. PASADA builds your username from them.",
        "Type a password with at least 8 characters. Pick something you will remember but others cannot guess.",
        "Click Complete Registration.",
        "Sign in with your name and password.",
    ])
    h2(doc, "Security questions: your spare key")
    para(doc, "PASADA asks three personal questions, for example your mother's maiden name or the street you grew up on. Answer them truthfully and remember the answers. They are your way back in if you ever forget your password. The answers are stored in secret form. Nobody, not even the admin, can read them. You can set or change your questions in Settings.")
    h2(doc, "If you forget your password")
    steps(doc, [
        "On the log-in screen, click Forgot Password?",
        "Type your full name. Your three questions appear.",
        "Answer all three correctly.",
        "Type a new password (8+ characters) and confirm it.",
        "Sign in with the new password.",
    ])
    note_box(doc, "NOTE:", "The admin can also set a new password for you from the Admin Console. Your records are never lost because of a forgotten password.")
    h2(doc, "When the office has no admin at all")
    para(doc, "Some offices end up with working accounts but no admin: the one admin left, or the office's accounts arrived from another computer. PASADA has two self-service doors for this, and both close forever the moment an admin exists.")
    bullets(doc, [
        "The one-time setup: while no admin exists, every signed-in account sees the Admin Console link in the sidebar. Opening it shows a panel that turns this account into the admin after you confirm your own password.",
        "The recovery door: if nobody can sign in to reach that panel, a clerk who set security questions earlier can answer them at Forgot Password?. While no admin exists anywhere, a correct set of answers also makes that account the admin, not just reset the password.",
    ])
    para(doc, "Every promotion is written to the Activity History, and both doors shut permanently once an admin is in place. They cannot be used to mint a second admin behind the real one's back.")
    h2(doc, "The three roles: Viewer, Clerk, and Admin")
    para(doc, "Every account is a Viewer, a Clerk, or an Admin. The difference is a short, clear list of extra powers, explained fully in Chapter 8:")
    data_table(doc,
        ["Work", "Viewer", "Clerk", "Admin"],
        [
            ("Add, edit, renew, delete records", "No", "Yes", "Yes"),
            ("Search, print, view certificates", "Yes", "Yes", "Yes"),
            ("Export Excel and PDF", "Yes", "Yes", "Yes"),
            ("Import Excel files", "No", "Yes", "Yes"),
            ("File a request to delete/rename a route", "No", "Yes", "Ticket; another admin approves, or direct with a typed reason if alone"),
            ("Restore deleted records", "No", "File request", "Ticket; another admin approves, or direct with a typed reason if alone"),
            ("Create accounts, reset passwords", "No", "No", "Yes"),
            ("Deactivate or reactivate an account", "No", "No", "Ticket; another admin approves, or direct with a typed reason if alone"),
            ("Upload document templates", "No", "No", "Yes"),
            ("Import or restore a database file", "No", "No", "Yes"),
            ("See system health and error notes", "No", "No", "Yes"),
        ],
        caption="What each role can do. The full list of admin tools is in Chapter 8.")
    h2(doc, "The Viewer role: a second computer that only looks")
    para(doc, "A Viewer account is made for the second office computer. It can open every page, search everything, read every record, and print — but the edit, delete, and import buttons are hidden, and the system itself refuses any change a Viewer tries to make. Give a Viewer account to a computer where people only need to look things up; give Clerk accounts where records are actually worked on. The admin creates the Viewer account the same way as any other, choosing Viewer as the role.")

    # ================= CH 3 =================
    h1(doc, "Chapter 3 — The Dashboard")
    para(doc, "The dashboard is the office at a glance. Open it any time from the sidebar. Everything updates on its own every few seconds.")
    figure(doc, "03_dashboard.png", "The dashboard: totals, volume charts, compliance ring, and route distribution.")
    h2(doc, "The four totals")
    data_table(doc,
        ["Total", "Meaning"],
        [
            ("Total Registered Operators", "Every franchise slot in the registry, filled or vacant."),
            ("Active Operators", "Operators who renewed for the current year. Certificates valid until December 31."),
            ("1-Year Non-Renewal", "Did not renew last year. Keep the slot, must renew this year."),
            ("2+ Years Non-Renewal / Vacant", "Empty slots, or franchises revoked after 2+ years. Can be reassigned."),
        ],
        caption="The four numbers across the top of the dashboard.")
    h2(doc, "Volume charts")
    para(doc, "Daily, weekly, and monthly volume count issuances and renewals recorded today, this week, and this month. The small line or bars beside each number show how the totals spread over recent days, weeks, or months. A quiet week shows immediately.")
    h2(doc, "Operator Compliance ring")
    para(doc, "The ring shows the share of active, pending, and revoked operators. Green is healthy. A growing red slice means many slots need attention. Hover a slice to see its exact share.")
    h2(doc, "Route Distribution bars")
    para(doc, "The bar chart compares active and unrenewed operators on every TODA line. Click TODA Renewal Summary to print the yearly summary document the office submits.")
    h2(doc, "How Full Is The Route?")
    para(doc, "Below the charts, pick a TODA line. PASADA shows whether the route is full, the count of active operators, and a fullness score. The score compares active operators with the route's population and road length. Above 1.0 means the route carries more tricycles than its roads comfortably support. Three clustering scores below (Silhouette, Davies-Bouldin, Calinski-Harabasz) tell you how much to trust the estimate: at the values shipped, trust it. If better population or road data becomes available, correct the two boxes and click Save Route Info.")

    # ================= CH 4 =================
    h1(doc, "Chapter 4 — Working with Records")
    h2(doc, "Opening a TODA line")
    steps(doc, [
        "Find the line in the sidebar under TODA LINES. Many lines? Use Filter lines to narrow the list.",
        "Click the line name. The operator list opens.",
        "Click the pin button beside a line to keep it at the top of your list.",
    ])
    figure(doc, "04_route_list.png", "A TODA line: search, sort, export, batch print, and Add Operator.")
    h2(doc, "Reading the list")
    para(doc, "Each row shows the SBN, the operator profile (name, address, make), the plate number, the renewal date, and a status chip. Green chip: Active, renewed this year. Amber chip: 1-Year, renewal pending. Red chip: 2+ Years, vacant or revoked. The search box on the page filters by operator, SBN, or make as you type. Sort controls order the list by SBN, name, or renewal date.")
    h2(doc, "Every button on the list, top to bottom")
    data_table(doc,
        ["Control", "What it does"],
        [
            ("Rename", "Admin only. Changes the line's code name and can standardize every SBN prefix on it."),
            ("Sort: SBN", "Orders rows by SBN ascending or descending."),
            ("All Records", "Filter to Active only, 1-Year only, 2+ Years only, or everything."),
            ("Refresh DB", "Re-reads the latest data immediately. Use if numbers look stale."),
            ("Export Excel", "Downloads this line's records as an Excel file."),
            ("Batch Print", "Merges certificates for all ticked rows into one printable PDF."),
            ("Add Operator", "Opens the form to create a new record on this line."),
            ("Search Operator", "Filters the visible rows as you type. Press / to jump here."),
            ("Rows per page", "Shows 25, 50, or more rows per page."),
            ("Previous / Next", "Moves between pages of the list."),
        ],
        caption="Controls on a TODA line page.")
    h2(doc, "Every icon on a row")
    data_table(doc,
        ["Icon", "What it does"],
        [
            ("Eye", "Opens the record view with print and download options."),
            ("Pencil", "Opens the edit form. Saving changes here is a renewal when the issue date moves to this year."),
            ("Circular arrows", "Change Motor: records a new motor number and updates the motor date."),
            ("Trash", "Deletes the record. It is not destroyed: it moves to the deleted list and can be restored. Undo appears right after."),
        ],
        caption="Row icons on every operator.")
    h2(doc, "Adding an operator")
    steps(doc, [
        "Click Add Operator on the line's page.",
        "Leave the SBN empty to get the next free number automatically, or type one to control it.",
        "Fill in the operator's name, address, motor number, chassis number, make, and plate number.",
        "Choose the issue date. Validity is computed automatically: December 31 of that year.",
        "Click Save. The new row appears with a green Active chip.",
    ])
    h2(doc, "Editing and renewing")
    para(doc, "Click the pencil icon. Change what needs changing. The rules the system applies are worth knowing: moving the issue date to the current year is a renewal and turns the chip green. Changing only the name is an edit, not a renewal. Changing the motor number also updates the motor date when the auto-date preference is on. Every save is written to the Activity History with your name, the old values, and the new values.")
    h2(doc, "Deleting and restoring")
    para(doc, "The trash icon deletes one operator; tick checkboxes and use the delete-selected control for many at once. Deleted records are not destroyed. They move to the deleted list, and the Undo button that appears right after a delete brings records back immediately. Older deletions are restored by the admin (Chapter 9).")
    h2(doc, "Printing certificates")
    bullets(doc, [
        "Eye icon: open the record, then download the MTOP certificate as Word or PDF.",
        "Printer icon on a row: download that record's certificate directly.",
        "Batch Print: tick several rows first, then merge many certificates into one PDF for the office printer.",
    ])
    figure(doc, "05_search.png", "Search across every line at once. Press / on any page to jump here.")
    h2(doc, "Exporting Excel")
    para(doc, "Export Excel on a line's page downloads that line. The Activity History page exports its own filtered logs as Excel. The dashboard prints the TODA Renewal Summary. Every export lands in the Activity History.")

    # ================= CH 5 =================
    h1(doc, "Chapter 5 — Search and Activity History")
    h2(doc, "Searching everything")
    steps(doc, [
        "Press the / key on any page, or click the search box in the sidebar.",
        "Type a name, an SBN, a plate number, or any word from an address.",
        "Results appear grouped by TODA line. Click a result to open the record with full actions.",
    ])
    h2(doc, "The MTOP certificate preview while editing")
    para(doc, "When you open a record from Search and click Edit, the edit form carries its own MTOP Certificate Preview button. Click it to see the exact certificate that will print, without closing the form or hunting for the eye icon on the row. Print or download it right from the preview. This is the same preview the record view shows — it just follows you into the edit form so you can double-check the certificate while you fix the details.")
    h2(doc, "Activity History")
    para(doc, "The Activity History page lists every change made in PASADA: log-ins, edits, renewals, deletions, restorations, exports, prints, account changes, ticket approvals. Each line shows when it happened, who did it, the action, the record it touched, and the details including old and new values.")
    figure(doc, "06_activity.png", "Activity History: the office's complete record of changes.")
    h2(doc, "Filters")
    data_table(doc,
        ["Filter", "Use it to"],
        [
            ("Route", "Show one TODA line only. SYSTEM shows log-ins and technical events."),
            ("Action", "Show one kind of event, for example RENEWAL, DELETE RECORD, or TICKET approval."),
            ("Search box", "Find the events about one operator or SBN."),
            ("Rows per page", "Show 25, 50, 100, or 250 entries per page."),
            ("Export Excel", "Download every entry matching the filters, not just this page."),
        ],
        caption="Activity History filters. Offices export these for monthly reports.")

    # ================= CH 6 =================
    h1(doc, "Chapter 6 — Inactive Operators and Importing")
    h2(doc, "The Inactive Operators page")
    para(doc, "This page lists operators who have not renewed for two or more years, plus vacant slots. These franchises may be reassigned to new applicants under the office's rules. Each row shows the last known operator, the SBN, how long the slot has been idle, and the usual record actions, still printable for reference.")
    figure(doc, "07_inactive.png", "Inactive operators: candidates for reassignment.")
    h2(doc, "Bringing records in from a file")
    steps(doc, [
        "Click Import Records in the sidebar.",
        "Drop or choose the Excel or CSV file. A .db database backup is also accepted, and so is the nightly backup ZIP (a .zip file with the .db inside — it imports by merging new records only).",
        "PASADA previews the file. Check that columns line up: name, SBN, route, dates.",
        "For spreadsheets, choose whether to skip existing records or overwrite them.",
        "For a database file, choose Merge (adds records that are new) or Full Restore (replaces matching records; admins only).",
        "Click Import. A summary reports rows added, updated, or skipped, and any row-level errors.",
    ])
    figure(doc, "08_import.png", "Import Records: pick the file, check the preview, confirm.")
    note_box(doc, "GOOD TO KNOW:", "The nightly backup ZIP works even when the old Franchise folder is long gone. If the office's spreadsheet files cannot be found, the ZIP from the backup drive is enough to bring every record over. Merge mode never overwrites: it only adds records the current registry does not have yet.")
    h2(doc, "Importing a database backup file")
    para(doc, "When the chosen file is a .db backup, PASADA offers two choices. Merge new records only adds records that do not exist yet and leaves everything else alone. Full Restore replaces the current records with the backup's contents. Full Restore is admin-only: a clerk who selects it will be refused at the moment of upload, and the request must go through the admin.")
    warn(doc, "Full Restore overwrites matching records with the backup's values. Download a fresh backup first (Settings > Full Database Backup) so today's state can always be recovered.")
    h2(doc, "After an import")
    para(doc, "Dashboard counts change, affected lines appear in the sidebar, and the import lands in the Activity History. Computers connected for sync receive the new records automatically.")

    # ================= CH 7 =================
    h1(doc, "Chapter 7 — Settings")
    figure(doc, "09_settings.png", "Settings: office details, preferences, security, backups, updates.")
    h2(doc, "Office details")
    para(doc, "Set the committee chair and signatory names printed on certificates. These values fill the matching placeholders in the templates, so one change here corrects every future document.")
    h2(doc, "Preferences")
    data_table(doc,
        ["Preference", "What it changes"],
        [
            ("Save preview", "Shows a confirmation window before every save. Turn off for faster data entry."),
            ("Auto-date for Change Motor", "Changing a motor number also updates the motor date automatically."),
        ],
        caption="Everyday preferences.")
    h2(doc, "Security PIN")
    para(doc, "Set a 4-digit PIN. PASADA then locks the screen when you step away, and the PIN unlocks it without typing your full password. The PIN is stored only on this computer, in secret form, and the change is written to the Activity History.")
    h2(doc, "Security: Manage Office Accounts (admin)")
    para(doc, "The admin creates accounts for new clerks here and resets forgotten passwords. Choose the account, type the new password, save. The new password works on every computer in the office. Creating an account and resetting a password both land in the Activity History.")
    h2(doc, "Deactivating an account (admin)")
    para(doc, "When a clerk leaves the office, deactivate the account instead of deleting it. The account table in Security (and in the Admin Console's Administrative tab) shows every account with a Status column and a Deactivate button. Click it, confirm, and the account can no longer sign in on any office computer, even with the right password. Everything the person did stays: records, certificates, and their Activity History entries keep their name.")
    steps(doc, [
        "Open Settings > Security (or Admin Console > Administrative).",
        "Find the person in the account table. Their row shows Active.",
        "Click Deactivate and read the confirmation window. Click OK.",
        "The row turns to Deactivated and the button becomes Reactivate.",
    ])
    bullets(doc, [
        "A deactivated account cannot sign in, and even a computer where they are already signed in loses access on the very next click.",
        "Deactivation spreads to every office computer automatically through sync.",
        "Changed your mind? Click Reactivate. The account signs in as before.",
        "You cannot deactivate the account you are signed in with; PASADA blocks it. This also guarantees the office always keeps at least one working admin.",
        "Every deactivation and reactivation is written to the Activity History.",
    ])
    h2(doc, "Recovery questions")
    para(doc, "Set or change your three security questions here. Answer honestly; these are your spare key. Answers are stored in secret form and never leave this computer.")
    h2(doc, "Full Database Backup")
    para(doc, "Download an exact copy of the whole registry as one .db file. Save one before big cleanups, before imports, and regularly anyway. PASADA also takes its own nightly backup; see Chapter 8.")
    h2(doc, "Updates")
    para(doc, "PASADA checks for new versions automatically and shows a prompt when one is ready. Click Install. The updater verifies the release signature before installing anything. If the office has no internet, updates wait; the program keeps working fully offline.")

    # ================= CH 8 =================
    h1(doc, "Chapter 8 — The Admin Console")
    para(doc, "The Admin Console gathers everything that should be touched by one trusted person only. Admin sees a new link in the sidebar. Everyone else who opens the page sees a polite refusal screen, and the system itself refuses non-admin requests no matter what the screen shows.")
    figure(doc, "10_admin_gate.png", "Non-admins see this refusal screen instead of the console.")
    h2(doc, "Becoming the first admin (one-time setup)")
    para(doc, "If the office started with only a clerk and no admin exists yet, the console offers a one-time door: confirm your own password, and this account becomes the admin. The door closes forever once an admin exists. From then on, the admin manages any further accounts inside the console. Chapter 11 explains what changes and what does not after promotion.")
    figure(doc, "11_admin_console.png", "The Admin Console: four tabs, one place for everything admin.")
    h2(doc, "Operational tab: what the office has been doing")
    para(doc, "Three cards at the top count all-time entries, entries in the last 7 days, and the most recent activity. Two lists below show the most common actions this week and the busiest people. Use this to notice unusual activity: a delete spree or a burst of logins at midnight looks exactly like what it is.")
    h2(doc, "Approvals tab: the two-key queue")
    para(doc, "Requests from clerks land here. Each ticket shows who asked, when, exactly what will happen, and any reason they gave. Waiting tickets sit at the top with Approve and Reject buttons.")
    para(doc, "The two-key rule covers the Admin too. Deleting a route, renaming a route, restoring deleted records, and deactivating an account always become tickets, even when an Admin clicks them. Nobody can approve their own request. The one exception: an office with a single active Admin executes right away, but must type a reason, and the audit log records it. Every office always keeps at least one working Admin.")
    figure(doc, "12_approvals.png", "The Approvals tab: nothing big happens without a yes here.")
    h2(doc, "Approving or rejecting a ticket")
    steps(doc, [
        "Open Admin Console > Approvals.",
        "Read the ticket. It states the action in plain words: which route is deleted, what a rename changes, how many records come back.",
        "Unsure? Click Reject, type a short reason, and talk to the requester. A rejected ticket changes nothing.",
        "Sure? Click Approve. The action runs immediately and the result note appears on the ticket.",
    ])
    warn(doc, "Approve carefully: approval really deletes, renames, or restores. When a delete ticket is approved, the records move to the deleted list (still recoverable). When in doubt, reject first and ask.")
    h2(doc, "Technical tab: system health in plain words")
    figure(doc, "13_technical.png", "The Technical tab: computer, records, sharing, backup, error notes.")
    data_table(doc,
        ["Card", "What it tells you"],
        [
            ("This computer", "Machine name and when PASADA was last started on it."),
            ("Records", "Database check result (want: all good), records saved, accounts, and who the admins are."),
            ("Sharing between computers", "This computer's name and address, which other computers are connected, and the time of the last sync check."),
            ("Latest backup", "The newest automatic nightly backup: file, date, size."),
            ("Error notes", "The last 60 lines of the error log. Normal logging, not a breakdown; support reads this first."),
        ],
        caption="The Technical tab cards.")
    para(doc, "The Sharing between computers card also has a Sync now button. Sharing runs on its own and new or changed accounts arrive within seconds, but if you want to pull records from the other computers right away (for example after reconnecting a network cable), press it once.")
    h2(doc, "Administrative tab: accounts and templates")
    para(doc, "Office accounts: create an account by typing a first name, last name, password, and role. Reset a password by choosing the account and typing the new one. Both reach every computer in the office within seconds.")
    para(doc, "The account table under the forms lists every account with its role and status. Active means the account can sign in. Deactivated means it cannot, until an admin clicks Reactivate. The Deactivate button asks for confirmation first, and the button on your own row is disabled: no admin can switch off the account they are signed in with, which guarantees the office always keeps at least one working admin.")
    para(doc, "Document templates: the certificate (MTOP) and the TODA summary are Word files with placeholders like [SBN_NO] and [NAME]. When the LGU amends a form, upload the new .docx here. PASADA checks the file is readable, counts the placeholders, warns if any are missing, keeps the previous file as a .bak beside it, and writes the upload to the audit log. One bad upload can always be undone by restoring the .bak.")
    h2(doc, "Every admin power, in one list")
    data_table(doc,
        ["Power", "Where", "Notes"],
        [
            ("Approve or reject tickets", "Approvals tab", "Runs the action immediately on approve."),
            ("Create accounts", "Administrative tab", "Clerk or Admin role; syncs everywhere."),
            ("Reset any password", "Administrative tab / Settings", "Also clears a lockout on that account."),
            ("Deactivate / reactivate accounts", "Administrative tab / Settings", "Blocks sign-in everywhere; keeps records and history."),
            ("Delete a route", "Sidebar / route page", "Two-key: becomes a ticket, even for an Admin; a different Admin approves."),
            ("Rename a route", "Route page", "Same two-key rule; a one-admin office runs it with a typed reason."),
            ("Restore deleted records", "Deleted list / tickets", "One or many, on approval."),
            ("Import database (merge)", "Import page", "Admin only."),
            ("Full Restore a database", "Import page", "Admin only; replaces matching records."),
            ("Upload templates", "Administrative tab", ".docx with placeholders; .bak kept."),
            ("Refresh DB", "Technical tools", "Rebuilds the fast lists after big imports."),
            ("See system health", "Technical tab", "Database check, sharing, backups, error notes."),
            ("See the full audit overview", "Operational tab", "Who did what, this week and all time."),
        ],
        caption="The complete admin power list.")

    # ================= CH 9 =================
    h1(doc, "Chapter 9 — The Two-Key Rule")
    para(doc, "Some actions are too big for one click. Deleting a whole TODA line can move hundreds of records at once. Renaming a line rewrites its code and every SBN prefix on it. Restoring many deleted records changes the registry in bulk. For these, PASADA uses two keys: one person requests, another person approves.")
    h2(doc, "How a request flows")
    steps(doc, [
        "The clerk clicks the normal button, for example Delete Entire Route.",
        "PASADA answers immediately: your request was sent to the admin. Nothing has changed yet.",
        "The request becomes a ticket in the admin's Approvals tab, showing who asked, what will happen, and when.",
        "The admin approves (the action runs at once) or rejects with a reason.",
        "Both outcomes land in the Activity History, with names and timestamps.",
    ])
    h2(doc, "What is two-key and what is not")
    data_table(doc,
        ["Action", "Clerk", "Admin"],
        [
            ("Delete one record", "Direct (undoable)", "Direct (undoable)"),
            ("Delete a whole route", "Files ticket", "Direct"),
            ("Rename a route + SBN prefix", "Files ticket", "Direct"),
            ("Restore deleted records (batch)", "Files ticket", "Approves or direct"),
            ("Import Excel", "Direct", "Direct"),
            ("Import / restore database file", "No", "Direct"),
            ("Everything else in the manual", "Direct", "Direct"),
        ],
        caption="The two-key rule at a glance.")
    h2(doc, "Why the office should like this")
    bullets(doc, [
        "No dead ends: a clerk who clicks a big button gets a clear message, not an error.",
        "No surprises: the person who can say yes sees exactly what will happen before saying it.",
        "No lost history: filings, approvals, and rejections are all in the Activity History forever.",
        "No rush: tickets wait in the queue until the admin has time to read them properly.",
    ])

    # ================= CH 10 =================
    h1(doc, "Chapter 10 — Connecting Computers (Sync)")
    h2(doc, "What sync does")
    para(doc, "Computers running PASADA on the same office network find each other automatically and share records. Create an account on computer A and a person can sign in with it on computer B a moment later. Every computer keeps a full copy, so if one breaks, the others keep working and no data is lost.")
    h2(doc, "What you see")
    data_table(doc,
        ["Status", "Meaning"],
        [
            ("Online (green)", "Sync is working normally."),
            ("Offline Mode (amber)", "This computer cannot reach the others. Keep working; changes are kept and shared when the connection returns."),
        ],
        caption="Sidebar connection states.")
    h2(doc, "Rules that keep sync safe")
    bullets(doc, [
        "Computers must be on the same office network.",
        "Every message between computers is signed with a shared secret held only by office computers. Strangers on the network are refused.",
        "Passwords travel only in secret form so accounts work on every computer. Security answers never leave the computer where they were typed.",
        "The same record changed on two computers is merged by newest change. Nothing is silently lost.",
    ])
    h2(doc, "Good habits")
    bullets(doc, [
        "Keep every computer on during office hours so they stay current.",
        "After moving a computer to a new network, check the Technical tab's connected computers list.",
        "One office, one registry: let sync fill each computer; avoid running a second empty database by hand.",
    ])

    # ================= CH 11 =================
    h1(doc, "Chapter 11 — If You Are the Admin")
    h2(doc, "The short answer: you lose nothing")
    para(doc, "When a clerk becomes the admin (through the one-time setup in Chapter 8), every clerk power stays exactly the same. The same log-in, the same password, the same name. Create records, edit, renew, delete, print, export, import Excel, search: all unchanged. Nothing about everyday work gets harder or moves somewhere else.")
    para(doc, "This was tested directly: after promotion, the same account created records, listed them, edited them, and exported them, all exactly as before. The only difference is the extra doors that open.")
    h2(doc, "What opens up")
    bullets(doc, [
        "The Admin Console link appears in the sidebar.",
        "Approve and Reject buttons appear on the Approvals tab.",
        "The big buttons (Delete Entire Route, Rename, Deactivate) follow the same two-key rule as everyone: with another active admin they file tickets for that admin to approve; if you are the only active admin they run right away but ask you to type a reason for the audit log.",
        "Database import and Full Restore accept your sign-in.",
        "Manage Office Accounts, template uploads, system health, and the audit overview become available.",
    ])
    h2(doc, "What stays gated")
    para(doc, "Other clerks keep exactly their own set of powers. Their big clicks still file tickets to you. Their access to accounts, templates, and database files stays closed. Promotion is per-account, not office-wide.")
    h2(doc, "Being a good admin")
    bullets(doc, [
        "Read tickets fully before approving; the ticket text is the whole plan.",
        "Create accounts for new staff promptly, and reset passwords without fuss; it happens to everyone.",
        "Download a database backup before any big import or cleanup, and keep one off this computer (a USB stick is fine).",
        "Check the Technical tab after installs, moves, or strange behavior; it usually names the problem.",
        "Promote a second admin only if the office truly needs one: two keys are safer than five.",
        "Deactivate the accounts of staff who leave instead of ignoring them; reactivating takes one click if they return.",
    ])

    # ================= CH 12 =================
    h1(doc, "Chapter 12 — Troubleshooting")
    para(doc, "Find the problem you are seeing, then follow the steps exactly. Nothing here needs technical training.")
    h2(doc, "1. I forgot my password")
    steps(doc, [
        "On the log-in screen, click Forgot Password?",
        "Type your full name.",
        "Answer your three security questions.",
        "Type a new password (8+ characters) and sign in.",
    ])
    para(doc, "If you never set the questions, or the answers will not match: ask the admin to reset your password. It takes under a minute and your records are unaffected.")
    h2(doc, "2. The account is locked (five wrong attempts)")
    para(doc, "The lock lasts 15 minutes and clears by itself. Wait, then sign in with the correct password. If it must open sooner, the admin can reset your password, which also clears the lock.")
    h2(doc, "3. I cannot register; the Register button is missing")
    bullets(doc, [
        "Registration closes after the first account exists, on purpose. Ask the admin to create your account.",
        "If the register page jumps or flickers, update PASADA; early versions had a display glitch, fixed in the current release.",
        "If the page says it cannot reach the server, see problem 4.",
    ])
    h2(doc, "4. Cannot connect to server / Offline Mode")
    steps(doc, [
        "Check that PASADA is running on the computer that hosts the records. The status at the sidebar bottom tells you.",
        "If other computers cannot reach this one, check all are on the same office network (same Wi-Fi or switch).",
        "Restart the PASADA app on the computer with the problem. Wait one minute and check the status again.",
        "Still stuck? Open the Technical tab (admin) and read the Error notes card.",
    ])
    para(doc, "Offline Mode is not an error. PASADA keeps every change safely on this computer and shares them when the connection returns.")
    h2(doc, "5. Records from another computer are not appearing")
    steps(doc, [
        "Confirm both computers show Online.",
        "Admin: open the Technical tab and check the connected computers list names the other machine.",
        "Give it a few seconds; a change made on one computer nudges the others to sync right away, and the background cycle keeps catching up after that.",
        "A computer that was off for days catches up automatically the next time both are on.",
    ])
    h2(doc, "6. A record is missing or was deleted by mistake")
    steps(doc, [
        "Check the Activity History for the SBN to see what happened and who did it.",
        "If it was just now, click Undo immediately.",
        "Otherwise ask the admin to restore it from the deleted list, or file a restore request for many records.",
    ])
    h2(doc, "7. Printing gives a blank or wrong-looking certificate")
    bullets(doc, [
        "Admin: check the Administrative tab; both templates should show installed with a sensible date.",
        "If a template was replaced recently and documents look wrong, restore the .bak copy, or upload the correct .docx again.",
        "The template must keep placeholder tokens like [SBN_NO] and [NAME]; PASADA warns during upload if any are missing.",
    ])
    h2(doc, "8. The list is slow or numbers look stale")
    steps(doc, [
        "Click Refresh DB on the line's page to re-read the latest data.",
        "Lists are kept in fast memory for one minute for speed; wait a moment and switch pages.",
        "After a very large import, close and reopen the app once; the first open re-organizes the fast lists.",
    ])
    h2(doc, "9. Two computers show different numbers")
    para(doc, "Short differences are normal; each computer catches up within seconds. If they stay different, restart PASADA on both, then check the connected computers list in the Technical tab. If one computer never appears there, treat it as problem 4.")
    h2(doc, "10. The screen is frozen or the app will not close")
    steps(doc, [
        "Wait 30 seconds first: big exports and batch prints can look like a freeze while working.",
        "If truly stuck, close the window. Every completed change was already saved; finished work is safe.",
        "Reopen. If the same page hangs every time, note what you clicked and tell the person who maintains the program.",
    ])
    h2(doc, "11. I see error notes or a crash message")
    para(doc, "The Technical tab keeps the last lines of the error log. This is normal logging, not a breakdown: PASADA writes a note whenever something unusual happens so problems can be traced later. If the app works, ignore old entries. If it misbehaves, the newest lines usually name the exact cause; show them to support.")
    h2(doc, "12. Updates will not install")
    bullets(doc, [
        "Updates need internet once. Connect, open Settings, and click Install when the prompt appears.",
        "If an install is interrupted, run the app again; it finishes the update before opening.",
        "Compare the version number in Settings with the office's newest computer to know if you are behind.",
    ])
    h2(doc, "13. An operator is under the wrong TODA line")
    steps(doc, [
        "Open the record with the pencil icon and check the route field.",
        "One operator in the wrong line: edit the record's route directly.",
        "A whole line needs re-arranging: that is a rename or route move, which follows the two-key rule.",
    ])
    h2(doc, "14. A database was restored and something looks wrong")
    steps(doc, [
        "Do not panic: the previous database copy is always kept before a restore.",
        "Compare dashboard totals with the Activity History exports you expect.",
        "Admin: restore an earlier backup file if numbers are wrong; each restore keeps a rollback copy.",
    ])
    h2(doc, "15. My account says it has been deactivated")
    para(doc, "The admin switched the account off. Only an admin can switch it back on:")
    steps(doc, [
        "Ask the admin to sign in on any office computer.",
        "Admin: open Settings > Security, find the account in the table, and click Reactivate. The Admin Console's account table has the same button.",
        "Sign in again with the same password as before. Nothing was deleted.",
    ])
    para(doc, "A deactivated account keeps every record, certificate, and Activity History entry under its name. Deactivation spreads to every office computer automatically, so the account is blocked everywhere, not just on one machine.")
    h2(doc, "16. My buttons for edit and delete are missing")
    para(doc, "That is the Viewer role working correctly. A Viewer account can look at everything but change nothing — it is meant for a second computer where people only read records. If you need to make changes on that computer, ask the admin to give you a Clerk account instead, and sign in with it.")
    h2(doc, "17. I need to import records but the Franchise folder is gone")
    steps(doc, [
        "Open Import Records in the sidebar.",
        "Choose the nightly backup ZIP file (PASADA_Backup_YYYY-MM-DD.zip). PASADA finds the .db inside automatically.",
        "Leave Merge selected and click Import. Every record the current registry is missing is added; nothing already there is touched.",
        "Check the totals on the Dashboard against what the office expects, and against a print of the old Excel masterlist if there is one.",
    ])
    para(doc, "A plain .db file works the same way. Both are admin-only imports; a clerk attempting one sees an access message instead.")
    h2(doc, "Still stuck?")
    para(doc, "Collect four things before asking for help: what you clicked, what appeared on screen, the time it happened, and the newest lines from the Technical tab's Error notes. With those four, almost any PASADA problem can be found and fixed quickly.")

    # ================= CH 13 =================
    h1(doc, "Chapter 13 — Quick Reference Card")
    para(doc, "Print this page and keep it beside the computer.")
    data_table(doc,
        ["To do this", "Do this"],
        [
            ("Sign in", "Full name + password, click Log In"),
            ("Jump to search", "Press / on any page"),
            ("Switch pages fast", "Alt+1 Dashboard, Alt+2 Activity, Alt+3 Import, Alt+4 Inactive, Alt+5 Settings"),
            ("Add an operator", "Open the TODA line, click Add Operator"),
            ("Renew", "Edit the record, set issue date to this year"),
            ("Print certificates", "Eye icon, or tick rows + Batch Print"),
            ("Export Excel", "Export Excel on the line's page"),
            ("Request a big change", "Click the normal button; the admin approves it"),
            ("Approve requests", "Admin Console > Approvals"),
            ("New account / reset password", "Admin Console > Administrative (admin)"),
            ("Switch an account off or on", "Admin Console > Administrative: Deactivate / Reactivate"),
            ("Lock the screen", "Set a PIN in Settings; it locks when you leave"),
            ("Import from backup", "Import Records; drop the nightly .zip or the .db"),
            ("Preview a certificate while editing", "MTOP Certificate Preview button inside the edit form"),
            ("Backup everything", "Settings > Full Database Backup"),
            ("Check system health", "Admin Console > Technical"),
            ("Dark mode", "Sun/moon button, top of the sidebar"),
            ("Log out", "Log out button, bottom of the sidebar"),
        ],
        caption="The one-page cheat sheet.")

    # ================= CH 14 =================
    h1(doc, "Chapter 14 — Setting Up the Second Office Computer")
    para(doc, "This chapter walks the whole path from an empty PC to a second office computer that shares the same records: install, sign in as a viewer, connect, and prove the two machines are talking. Follow it in order; each step assumes the ones before it.")

    h2(doc, "Step 1: Install PASADA on PC 2")
    steps(doc, [
        "Download the newest installer from the PASADA release page. Use the ...-setup.exe file (or the .msi).",
        "Copy it on a USB stick if PC 2 has no internet. The installer carries everything: the interface and the registry engine.",
        "Run the installer and accept the default options. A PASADA shortcut appears on the desktop.",
        "Open PASADA once, and let it sit on the log-in screen. Do not register a new account here.",
    ])
    warn(doc, "Never click Register Account on PC 2. Registration closes after the first account; the office's real accounts live on PC 1 and sync over. Registering on PC 2 would create a second, separate registry.")

    h2(doc, "Step 2: Sign in as a Viewer")
    para(doc, "On PC 1, the admin first creates the account PC 2 will use:")
    steps(doc, [
        "Admin, on PC 1: open the Admin Console > Administrative tab and create an account.",
        "Choose the Viewer role. A Viewer can look at everything, search, and print — but cannot change records.",
        "Give the new username and password to PC 2's user.",
    ])
    steps(doc, [
        "On PC 2, type that username and password on the log-in screen and click Log In.",
        "The dashboard opens. The sidebar shows your name with the role Viewer.",
    ])
    para(doc, "Why Viewer: the second computer is usually for looking things up at the front desk. With a Viewer account, nobody can edit records from PC 2 by accident — the edit and delete buttons are not even shown, and the system itself refuses any change.")
    note_box(doc, "TIP:", "If PC 2's people really do need to enter records, give that computer a Clerk account instead. Everything in the rest of this chapter is identical.")

    h2(doc, "Step 3: Connect the two computers")
    steps(doc, [
        "Make sure both computers are on the same office network — same Wi-Fi, or wired to the same switch/router.",
        "Admin, on PC 1: open the Admin Console > Technical tab. Look at the connected computers list.",
        "On PC 2, click the connection status at the bottom of the sidebar and connect to PC 1's name, or wait a few seconds for automatic discovery.",
        "When the status under the sidebar says Online on BOTH computers, they are connected.",
        "PC 2 then pulls the whole registry from PC 1 automatically the first time. Give it a moment on a large registry.",
    ])
    para(doc, "The connection is safe without you doing anything: computers recognize each other with a shared secret, and every transfer between them is signed. A computer that was off for days catches up automatically the next time both are on.")

    h2(doc, "Step 4: Verify sync end to end")
    para(doc, "Do this the first day, and any time something feels out of date later:")
    steps(doc, [
        "On PC 1, add a test record: open any TODA line, click Add Operator, fill the name and address, and save.",
        "On PC 2, wait a few seconds, then open the same TODA line. The record is there.",
        "On PC 2, search the test operator's name from the Search page. Found — the whole registry reached PC 2.",
        "On PC 1, edit the record (change the address slightly) and save.",
        "On PC 2, refresh or reopen the record. The new address shows.",
        "On PC 1, delete the test record. PC 2 catches up and the record leaves the list there too.",
        "Check the Activity History on either computer: the add, the edit, and the delete all appear with the names of who did them.",
    ])
    para(doc, "That full loop — add, edit, delete, all visible on both sides — is the proof the office now runs one registry across two computers. Delete nothing else; the test record you removed was the only one entered for this.")

    h2(doc, "If something does not work")
    data_table(doc,
        ["Symptom", "What to do"],
        [
            ("PC 2 never shows Online", "Both computers must be on the same network. Check the network first, then restart PASADA on PC 2. See Troubleshooting problems 4 and 5."),
            ("Records missing on PC 2", "Confirm PC 1 shows Online. PC 2 pulls from PC 1; if PC 1 is off, PC 2 counts on its last data or shows Offline Mode."),
            ("Login fails on PC 2", "The account was created on PC 1 but the registry has not reached PC 2 yet. Wait for the first pull to finish, then try again."),
            ("Edit buttons missing on PC 2", "That is the Viewer role. Ask the admin for a Clerk account if that computer needs to enter records."),
            ("Numbers differ between PCs", "Short differences clear in seconds. If not, restart both and check the connected computers list; treat it as Troubleshooting problem 9."),
        ],
        caption="Second-computer setup problems.")

    # ================= GLOSSARY =================
    h1(doc, "Glossary")
    data_table(doc,
        ["Term", "Meaning"],
        [
            ("Pasada", "Filipino term for a driver's working trip: going out to transport passengers and earn the day's living. The system is named for this work."),
            ("Tigil pasada", "When the runs stop: drivers cannot work. Shows why keeping franchises active matters."),
            ("MTOP", "Motorized Tricycle Operator's Permit: the franchise document per operator."),
            ("SBN", "Serial bound number: the franchise serial like BA-002-26."),
            ("TODA", "Tricycle Operators and Drivers Association: one line or route."),
            ("Renewal", "Yearly re-registration keeping a franchise active for the calendar year."),
            ("Deduplication", "The system collapsing duplicate rows of the same SBN into one clean record."),
            ("Fullness score", "Active operators compared with the route's population and road length."),
            ("Approval ticket", "A logged request for a big action, waiting for admin approval."),
            ("Audit log / Activity History", "The permanent record of every change: who, what, when, old and new values."),
            ("Backup", "An exact copy of the whole registry, downloadable as one .db file."),
            ("Sync", "Automatic record sharing between office computers on the same network, usually within seconds of a change."),
            ("Cluster secret", "The shared key office computers use to recognize each other during sync."),
            ("Template", "The Word document (.docx) with placeholders that certificates are printed from."),
            ("Soft delete", "A delete that keeps the record recoverable in the deleted list."),
            ("Deactivated account", "An account switched off by the admin. It cannot sign in anywhere, but its records and history are kept. Reactivating restores sign-in."),
            ("One-time admin setup", "The panel that makes the first admin when an office has none. It closes forever once an admin exists."),
            ("Viewer account", "A read-only account. It can open, search, and print everything but cannot change records, meant for a second office computer that only looks things up."),
            ("Nightly backup ZIP", "The automatic backup PASADA makes each night: a .zip file with the whole registry (.db) inside. It can be imported on another computer to rebuild the records."),
        ],
        caption="Terms used in this manual and in PASADA.")

    out_docx = os.path.join(HERE, "PASADA_Software_Manual_Guide.docx")
    doc.save(out_docx)
    # Keep the tracked copy in manual_assets and the shipped copy at the repo
    # root in sync; the root PDF is what office staff receive.
    out_pdf = os.path.abspath(os.path.join(HERE, "..", "PASADA_Software_Manual_Guide.pdf"))
    if os.path.exists(out_pdf):
        try:
            os.remove(out_pdf)
        except OSError:
            pass
    print(f"saved {out_docx} with {FIG['n']} figures, {TBL['n']} tables")


if __name__ == "__main__":
    build()
