import os
import sys
import platform
import subprocess
import re
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from datetime import datetime
from database import BASE_DIR

def get_resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(os.path.dirname(__file__))
    return os.path.join(base_path, relative_path)

def replace_text_in_paragraph(paragraph, mapping, sig_path=None):
    full_text = paragraph.text
    
    found_keys = [k for k in mapping.keys() if k in full_text]
    has_sig = "[E_SIGNATURE]" in full_text or "{{E_SIGNATURE}}" in full_text
    
    if not found_keys and not has_sig:
        return
        
    base_font_name = paragraph.runs[0].font.name if paragraph.runs else None
    base_font_size = paragraph.runs[0].font.size if paragraph.runs else None

    clean_text = full_text.replace("[E_SIGNATURE]", "").replace("{{E_SIGNATURE}}", "")
    
    for run in paragraph.runs:
        run.text = ""

    if found_keys:
        pattern = re.compile("|".join(map(re.escape, found_keys)))
        parts = pattern.split(clean_text)
        matches = pattern.findall(clean_text)
        
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
    else:
        if clean_text:
            run = paragraph.add_run(clean_text)
            if base_font_name: run.font.name = base_font_name
            if base_font_size: run.font.size = base_font_size

    if has_sig and sig_path and os.path.exists(sig_path):
        # ABSOLUTE FIX: Break the template's strict line-height constraint so the image isn't sliced off
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
        
        # Strip all hidden template indents to guarantee absolute horizontal centering
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.right_indent = None
        paragraph.paragraph_format.first_line_indent = None
        
        # Pull text tightly together to simulate the wet-ink overlap
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        
        # Force dead-center alignment
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        run = paragraph.add_run()
        
        # Inject the signature at a massive 2.2 inches wide
        run.add_picture(sig_path, width=Inches(2.2))

def clean_val(v):
    if not v: return ""
    s = str(v).strip().upper()
    if s in ["NAN", "NONE", "N/A", "UNKNOWN", "NULL"]: return ""
    return s

def generate_certificate(data: dict, settings: dict, template_path: str = "template.docx", output_dir: str = "exports"):
    out_path = os.path.join(BASE_DIR, output_dir)
    if not os.path.exists(out_path):
        os.makedirs(out_path)

    actual_template_path = get_resource_path(template_path)
    
    try:
        doc = Document(actual_template_path)
    except Exception as e:
        raise FileNotFoundError(f"Template not found at {actual_template_path}. Error: {e}")

    issue_date_obj = data.get("issue_date", datetime.now())
    valid_until_obj = data.get("valid_until", datetime(issue_date_obj.year, 12, 31))
    enable_esign = settings.get("enable_esignature", False)

    replacements = {
        "[SBN_NO]": data.get("sbn_no", ""),
        "{{SBN_NO}}": data.get("sbn_no", ""),
        "[NAME]": data.get("operator_name", "").upper(),
        "{{NAME}}": data.get("operator_name", "").upper(),
        "[ADDRESS]": data.get("address", "").upper(),
        "{{ADDRESS}}": data.get("address", "").upper(),
        "[MOTOR_NO]": clean_val(data.get("motor_no")),
        "{{MOTOR_NO}}": clean_val(data.get("motor_no")),
        "[CHASSIS_NO]": clean_val(data.get("chassis_no")),
        "{{CHASSIS_NO}}": clean_val(data.get("chassis_no")),
        "[MAKE]": clean_val(data.get("make")),
        "{{MAKE}}": clean_val(data.get("make")),
        "[PLATE_NO]": clean_val(data.get("plate_no")),
        "{{PLATE_NO}}": clean_val(data.get("plate_no")),
        "[ROUTE]": data.get("driving_route", "").upper(),
        "{{ROUTE}}": data.get("driving_route", "").upper(),
        "[ISSUE_DATE]": issue_date_obj.strftime("%B %d, %Y"),
        "{{ISSUE_DATE}}": issue_date_obj.strftime("%B %d, %Y"),
        "[VALID_UNTIL]": valid_until_obj.strftime("%B %d, %Y"),
        "{{VALID_UNTIL}}": valid_until_obj.strftime("%B %d, %Y"),
        "[CHAIRMAN_NAME]": settings.get("committee_chair", "RODRIGO A. CASTILLO").upper(),
        "{{CHAIRMAN_NAME}}": settings.get("committee_chair", "RODRIGO A. CASTILLO").upper()
    }
    
    sig_path = os.path.join(BASE_DIR, "signature.png") if enable_esign else None

    for paragraph in doc.paragraphs:
        replace_text_in_paragraph(paragraph, replacements, sig_path)

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    replace_text_in_paragraph(paragraph, replacements, sig_path)

    safe_name = data.get('operator_name', 'Unknown').replace(' ', '_').replace('/', '-')
    docx_path = os.path.abspath(os.path.join(out_path, f"MTOP_{safe_name}.docx"))
    pdf_path = os.path.abspath(os.path.join(out_path, f"MTOP_{safe_name}.pdf"))
    
    doc.save(docx_path)

    try:
        if platform.system() == "Windows":
            import pythoncom
            import win32com.client
            pythoncom.CoInitialize() 
            word = win32com.client.DispatchEx("Word.Application")
            try:
                word.Visible = False
                word.DisplayAlerts = 0
                doc_obj = word.Documents.Open(docx_path, ReadOnly=True)
                doc_obj.SaveAs(pdf_path, FileFormat=17)
                doc_obj.Close()
            finally:
                word.Quit()
                pythoncom.CoUninitialize()
                
            if os.path.exists(pdf_path): return pdf_path, "application/pdf"
        else:
            subprocess.run(['libreoffice', '--headless', '--nologo', '--nofirststartwizard', '--convert-to', 'pdf', docx_path, '--outdir', out_path], check=True)
            if os.path.exists(pdf_path): return pdf_path, "application/pdf"
    except Exception as e:
        pass
        
    return docx_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"