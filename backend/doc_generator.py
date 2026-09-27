# 25010 Characteristic: Reliability

import os
import sys
import platform
import subprocess
import re
import copy
from docx import Document
from docx.shared import Pt, Twips
from docx.oxml.ns import qn
from docx.table import _Row
from datetime import datetime
from database import BASE_DIR

# Times-metric-compatible bold fonts to try for text measurement, best first.
# Tinos is metrically identical to Times New Roman; Liberation Serif likewise.
_MEASURE_FONT_FILES = [
    "/usr/share/fonts/truetype/croscore/Tinos-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "C:/Windows/Fonts/times.ttf",
    "C:/Windows/Fonts/timesbd.ttf",
]

def _measure_times_bold_pt(text: str, size_pt: float):
    """Width of `text` in points when set in Times New Roman Bold at `size_pt`.
    Returns None when no metric-compatible font file is available (dev boxes).
    Tinos/Liberation Serif share Times New Roman's advance widths, so the
    measurement carries over to Word on Windows unchanged."""
    for path in _MEASURE_FONT_FILES:
        if not os.path.exists(path):
            continue
        try:
            from PIL import ImageFont
            font = ImageFont.truetype(path, int(round(size_pt * 64)))
            width = font.getlength(text) / 64.0
            return width
        except Exception as e:
            log_conversion_error(f"font measure failed for {path}: {e}")
    return None

def log_conversion_error(msg):
    try:
        log_path = os.path.join(BASE_DIR, "PASADA_CRASH_LOG.txt")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now()}] DOC_GEN ERROR: {msg}\n")
    except:
        pass

def get_resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(os.path.dirname(__file__))
    return os.path.join(base_path, relative_path)

def replace_text_in_paragraph(paragraph, mapping):
    full_text = paragraph.text
    found_keys = [k for k in mapping.keys() if k in full_text]
    
    if not found_keys:
        return
        
    base_font_name = paragraph.runs[0].font.name if paragraph.runs else None
    base_font_size = paragraph.runs[0].font.size if paragraph.runs else None

    for run in paragraph.runs:
        run.text = ""

    pattern = re.compile("|".join(map(re.escape, found_keys)))
    parts = pattern.split(full_text)
    matches = pattern.findall(full_text)
    
    for i in range(len(parts)):
        if parts[i]:
            run = paragraph.add_run(parts[i])
            if base_font_name: run.font.name = base_font_name
            if base_font_size: run.font.size = base_font_size
            
        if i < len(matches):
            key = matches[i]
            val = str(mapping[key])
            run = paragraph.add_run(val)
            run.bold = True 
            
            if key in ["[SBN_NO]", "{{SBN_NO}}"]:
                run.font.size = Pt(12)
            elif base_font_size: 
                run.font.size = base_font_size
                
            if base_font_name: run.font.name = base_font_name

def clean_val(v):
    if not v: return ""
    s = str(v).strip().upper()
    if s in ["NAN", "NONE", "N/A", "UNKNOWN", "NULL"]: return ""
    return s

def generate_certificate(data: dict, settings: dict, template_path: str = "template.docx", output_dir: str = "exports", return_format: str = "pdf"):
    out_path = os.path.join(BASE_DIR, output_dir)
    if not os.path.exists(out_path):
        os.makedirs(out_path, exist_ok=True)

    actual_template_path = get_resource_path(template_path)
    
    try:
        doc = Document(actual_template_path)
    except Exception as e:
        raise FileNotFoundError(f"Template not found at {actual_template_path}. Error: {e}")

    issue_date_obj = data.get("issue_date") or datetime.now()
    valid_until_obj = data.get("valid_until") or datetime(issue_date_obj.year, 12, 31)

    issue_date_str = f"{issue_date_obj.strftime('%B')} {issue_date_obj.day}, {issue_date_obj.year}"
    valid_until_str = f"{valid_until_obj.strftime('%B')} {valid_until_obj.day}, {valid_until_obj.year}"

    replacements = {
        "[SBN_NO]": data.get("sbn_no", ""),
        "{{SBN_NO}}": data.get("sbn_no", ""),
        "[NAME]": (data.get("operator_name") or "").upper(),
        "{{NAME}}": (data.get("operator_name") or "").upper(),
        "[ADDRESS]": (data.get("address") or "").upper(),
        "{{ADDRESS}}": (data.get("address") or "").upper(),
        "[MOTOR_NO]": clean_val(data.get("motor_no")),
        "{{MOTOR_NO}}": clean_val(data.get("motor_no")),
        "[CHASSIS_NO]": clean_val(data.get("chassis_no")),
        "{{CHASSIS_NO}}": clean_val(data.get("chassis_no")),
        "[MAKE]": clean_val(data.get("make")),
        "{{MAKE}}": clean_val(data.get("make")),
        "[PLATE_NO]": clean_val(data.get("plate_no")),
        "{{PLATE_NO}}": clean_val(data.get("plate_no")),
        "[ROUTE]": (data.get("driving_route") or "").upper(),
        "{{ROUTE}}": (data.get("driving_route") or "").upper(),
        "[ISSUE_DATE]": issue_date_str,
        "{{ISSUE_DATE}}": issue_date_str,
        "[VALID_UNTIL]": valid_until_str,
        "{{VALID_UNTIL}}": valid_until_str,
        "[CHAIRMAN_NAME]": (settings.get("committee_chair") or "RODRIGO A. CASTILLO").upper(),
        "{{CHAIRMAN_NAME}}": (settings.get("committee_chair") or "RODRIGO A. CASTILLO").upper()
    }

    for paragraph in doc.paragraphs:
        replace_text_in_paragraph(paragraph, replacements)

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    replace_text_in_paragraph(paragraph, replacements)

    # --- Vehicle-table geometry + route fitting -----------------------------
    # The template's vehicle table (Motor No./Chassis/Make + Plate No./Route)
    # was widened past the printable column: 9800 twips + 1440 indent vs
    # 9893 twips of text column. Word renders the overhang by pushing the
    # table's right border off the paper edge; LibreOffice silently
    # compresses instead, so the two disagree. Normalize here at generation
    # time: scale the table to end exactly at the text-area right margin and
    # shift the reclaimed width into the Route column, then size the route
    # value with real font metrics (Tinos Bold ≙ Times New Roman Bold) so it
    # stays on one line inside the printable area.
    route_value = str(replacements.get("[ROUTE]", ""))
    sec = doc.sections[0]
    text_tw = sec.page_width.twips - sec.left_margin.twips - sec.right_margin.twips
    LABEL_OFFSET_PT = 50.0   # measured: "Route :" label + tab stop before the value
    PAD_PT = 6.0             # printer-safety pad

    for table in doc.tables:
        cells_text = " ".join(c.text for r in table.rows for c in r.cells)
        has_route = "[ROUTE]" in cells_text or "{{ROUTE}}" in cells_text or (route_value and route_value in cells_text)
        if not has_route:
            continue
        grid = table._tbl.tblGrid
        cols = [int(gc.get(qn("w:w"))) for gc in grid]
        indent_el = table._tbl.tblPr.find(qn("w:tblInd"))
        indent_tw = int(indent_el.get(qn("w:w"))) if indent_el is not None else 0
        budget_tw = text_tw - indent_tw
        if len(cols) == 2 and sum(cols) > budget_tw:
            # Two-column vehicle table: fix the left (Motor/Chassis/Make)
            # column at 190pt — its longest line still fits — and give the
            # Route column everything up to the right margin.
            cols = [3800, budget_tw - 3800]
            for gc, w in zip(grid, cols):
                gc.set(qn("w:w"), str(w))
            tbl_w = table._tbl.tblPr.find(qn("w:tblW"))
            if tbl_w is not None:
                tbl_w.set(qn("w:w"), str(budget_tw))
            for row in table.rows:
                row_cells = row.cells
                if len(row_cells) == 2:
                    row_cells[0].width = Twips(cols[0])
                    row_cells[1].width = Twips(cols[1])

        if route_value:
            left_cell_pt = cols[0] / 20.0
            usable_pt = max(text_tw / 20.0 - indent_tw / 20.0 - left_cell_pt - LABEL_OFFSET_PT - PAD_PT, 60.0)
            for row in table.rows:
                for cell in row.cells:
                    if route_value not in cell.text:
                        continue
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            if run.text != route_value:
                                continue
                            w12 = _measure_times_bold_pt(route_value, 12.0)
                            if w12:
                                fit = 12.0 * usable_pt / w12
                                # Floor at 8pt for legibility: anything longer
                                # wraps to a second line rather than printing
                                # microscopic text.
                                size = max(8.0, min(12.0, int(fit * 2) / 2.0))
                            else:
                                # No font metrics available: conservative estimate.
                                size = 8.0
                                for candidate in (12.0, 11.5, 11.0, 10.5, 10.0, 9.5, 9.0, 8.5, 8.0):
                                    size = candidate
                                    if len(route_value) * 0.65 * candidate <= usable_pt:
                                        break
                            run.font.size = Pt(size)

    raw_name = data.get('operator_name', 'Unknown')
    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '', str(raw_name).replace(' ', '_'))
    
    docx_path = os.path.abspath(os.path.join(out_path, f"MTOP_{safe_name}.docx"))
    doc.save(docx_path)

    if return_format == "docx":
        return docx_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    pdf_path = os.path.abspath(os.path.join(out_path, f"MTOP_{safe_name}.pdf"))
    
    try:
        if platform.system() == "Windows":
            word = None
            try:
                import pythoncom
                import win32com.client
                pythoncom.CoInitialize() 
                word = win32com.client.DispatchEx("Word.Application")
                word.Visible = False
                word.DisplayAlerts = 0
                doc_obj = word.Documents.Open(docx_path, ReadOnly=True)
                doc_obj.SaveAs(pdf_path, FileFormat=17)
                doc_obj.Close()
                if os.path.exists(pdf_path): return pdf_path, "application/pdf"
            except Exception as e:
                log_conversion_error(f"Windows COM PDF conversion failed: {e}. Trying LibreOffice...")
            finally:
                if word is not None:
                    word.Quit()
                try:
                    pythoncom.CoUninitialize()
                except:
                    pass

        subprocess.run(
            ['libreoffice', '--headless', '--nologo', '--nofirststartwizard', '--convert-to', 'pdf', docx_path, '--outdir', out_path],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        if os.path.exists(pdf_path): 
            return pdf_path, "application/pdf"
            
    except subprocess.CalledProcessError as e:
        log_conversion_error(f"LibreOffice PDF conversion failed: {e}. Falling back to .docx.")
    except FileNotFoundError as e:
        log_conversion_error(f"LibreOffice not found: {e}. Falling back to .docx.")
    except Exception as e:
        log_conversion_error(f"Unexpected PDF conversion error: {e}. Falling back to .docx.")
        
    return docx_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def generate_toda_summary(summary: dict, settings: dict, template_path: str = "dashboard_template.docx", output_dir: str = "exports", return_format: str = "docx"):
    out_path = os.path.join(BASE_DIR, output_dir)
    if not os.path.exists(out_path):
        os.makedirs(out_path, exist_ok=True)

    actual_template_path = get_resource_path(template_path)
    
    try:
        doc = Document(actual_template_path)
    except Exception as e:
        raise FileNotFoundError(f"Template not found at {actual_template_path}. Error: {e}")

    as_of_date = str(summary.get("as_of_date", datetime.now().strftime("%B %d, %Y")))
    year = summary.get("year", datetime.now().year)
    
    header_replacements = {
        "[AS_OF_DATE]": as_of_date,
        "{{AS_OF_DATE}}": as_of_date,
        "[TOTAL_TODA]": str(summary.get("total_toda", 0)),
        "{{TOTAL_TODA}}": str(summary.get("total_toda", 0)),
        "[GRAND_TOTAL]": str(summary.get("grand_total", 0)),
        "{{GRAND_TOTAL}}": str(summary.get("grand_total", 0)),
        "[GRAND_RENEWED]": str(summary.get("grand_renewed", 0)),
        "{{GRAND_RENEWED}}": str(summary.get("grand_renewed", 0)),
        "[CHAIRMAN_NAME]": (settings.get("committee_chair") or "RODRIGO A. CASTILLO").upper(),
        "{{CHAIRMAN_NAME}}": (settings.get("committee_chair") or "RODRIGO A. CASTILLO").upper()
    }

    # Replace headers in paragraphs
    for paragraph in doc.paragraphs:
        replace_text_in_paragraph(paragraph, header_replacements)

    # Find the row containing the [ROUTE_NAME] token
    marker_row = None
    marker_table = None
    for table in doc.tables:
        for row in table.rows:
            row_text = "".join(c.text for c in row.cells)
            if "[ROUTE_NAME]" in row_text or "{{ROUTE_NAME}}" in row_text:
                marker_row = row
                marker_table = table
                break
        if marker_row:
            break

    # Clone the row and insert the data
    if marker_table and marker_row:
        for i, r_data in enumerate(summary.get("rows", []), start=1):
            new_tr = copy.deepcopy(marker_row._tr)
            # FIX: Insert BEFORE the marker row so it stays above the "TOTAL" row
            marker_row._tr.addprevious(new_tr)
            new_row = _Row(new_tr, marker_table)
            
            row_reps = {
                "[ROW_NO]": str(i),
                "{{ROW_NO}}": str(i),
                "[ROUTE_NAME]": str(r_data.get("route", "")),
                "{{ROUTE_NAME}}": str(r_data.get("route", "")),
                "[ROUTE_TOTAL]": str(r_data.get("total", 0)),
                "{{ROUTE_TOTAL}}": str(r_data.get("total", 0)),
                "[ROUTE_RENEWED]": str(r_data.get("renewed", 0)),
                "{{ROUTE_RENEWED}}": str(r_data.get("renewed", 0))
            }
            
            for cell in new_row.cells:
                for paragraph in cell.paragraphs:
                    replace_text_in_paragraph(paragraph, row_reps)

        # Delete the original placeholder row
        marker_table._tbl.remove(marker_row._tr)
        
    # Final pass to catch [GRAND_TOTAL] and other header replacements inside the table
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    replace_text_in_paragraph(paragraph, header_replacements)

    base_filename = f"TOTAL RENEWAL {year}"
    docx_path = os.path.abspath(os.path.join(out_path, f"{base_filename}.docx"))
    doc.save(docx_path)

    if return_format == "docx":
        return docx_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    pdf_path = os.path.abspath(os.path.join(out_path, f"{base_filename}.pdf"))
    
    # PDF Conversion fallback matching MTOP
    try:
        if platform.system() == "Windows":
            word = None
            try:
                import pythoncom
                import win32com.client
                pythoncom.CoInitialize() 
                word = win32com.client.DispatchEx("Word.Application")
                word.Visible = False
                word.DisplayAlerts = 0
                doc_obj = word.Documents.Open(docx_path, ReadOnly=True)
                doc_obj.SaveAs(pdf_path, FileFormat=17)
                doc_obj.Close()
                if os.path.exists(pdf_path): return pdf_path, "application/pdf"
            except Exception as e:
                log_conversion_error(f"Windows COM PDF conversion failed: {e}. Trying LibreOffice...")
            finally:
                if word is not None:
                    word.Quit()
                try:
                    pythoncom.CoUninitialize()
                except:
                    pass

        subprocess.run(
            ['libreoffice', '--headless', '--nologo', '--nofirststartwizard', '--convert-to', 'pdf', docx_path, '--outdir', out_path],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        if os.path.exists(pdf_path): 
            return pdf_path, "application/pdf"
            
    except subprocess.CalledProcessError as e:
        log_conversion_error(f"LibreOffice PDF conversion failed: {e}. Falling back to .docx.")
    except FileNotFoundError as e:
        log_conversion_error(f"LibreOffice not found: {e}. Falling back to .docx.")
    except Exception as e:
        log_conversion_error(f"Unexpected PDF conversion error: {e}. Falling back to .docx.")
        
    return docx_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"