import os
import platform
import subprocess
from docx import Document
from docx.shared import Inches
from datetime import datetime
from database import BASE_DIR

def process_runs(paragraph, replacements, enable_esign):
    for i, run in enumerate(paragraph.runs):
        if "[E_SIGNATURE]" in run.text:
            run.text = run.text.replace("[E_SIGNATURE]", "")
            sig_path = os.path.join(BASE_DIR, "signature.png")
            if enable_esign and os.path.exists(sig_path):
                run.add_picture(sig_path, width=Inches(1.5))
                
        for key, value in replacements.items():
            if key in run.text:
                run.text = run.text.replace(key, str(value))
                
                if key == "[MOTOR_NO]":
                    val_len = len(str(value))
                    if val_len >= 15:
                        for j in range(i, len(paragraph.runs)):
                            if '\t' in paragraph.runs[j].text:
                                paragraph.runs[j].text = paragraph.runs[j].text.replace('\t', '', 1)
                                break
                    elif val_len > 0 and val_len < 8:
                        run.text += '\t'
                        
                if key == "[CHASSIS_NO]":
                    val_len = len(str(value))
                    if val_len >= 18:
                        for j in range(i, len(paragraph.runs)):
                            if '\t' in paragraph.runs[j].text:
                                paragraph.runs[j].text = paragraph.runs[j].text.replace('\t', '', 1)
                                break
                    elif val_len > 0 and val_len < 12:
                        run.text += '\t'

def generate_certificate(data: dict, settings: dict, template_path: str = "template.docx", output_dir: str = "exports"):
    out_path = os.path.join(BASE_DIR, output_dir)
    if not os.path.exists(out_path):
        os.makedirs(out_path)

    try:
        doc = Document(template_path)
    except Exception:
        raise FileNotFoundError(f"Template not found at {template_path}")

    issue_date_obj = data.get("issue_date", datetime.now())
    valid_until_obj = data.get("valid_until", datetime(issue_date_obj.year, 12, 31))
    enable_esign = settings.get("enable_esignature", False)

    plate_val = data.get("plate_no", "").strip()
    if not plate_val: plate_val = "      " 

    replacements = {
        "[SBN_NO]": data.get("sbn_no", ""),
        "[NAME]": data.get("operator_name", "").upper(),
        "[ADDRESS]": data.get("address", "").upper(),
        "[MOTOR_NO]": data.get("motor_no", ""),
        "[CHASSIS_NO]": data.get("chassis_no", ""),
        "[MAKE]": data.get("make", "").upper(),
        "[PLATE_NO]": plate_val,
        "[ROUTE]": data.get("driving_route", "").upper(),
        "[ISSUE_DATE]": issue_date_obj.strftime("%B %d, %Y"),
        "[VALID_UNTIL]": valid_until_obj.strftime("%B %d, %Y"),
        "[CHAIRMAN_NAME]": settings.get("committee_chair", "RODRIGO A. CASTILLO").upper()
    }

    for paragraph in doc.paragraphs:
        process_runs(paragraph, replacements, enable_esign)

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    process_runs(paragraph, replacements, enable_esign)

    safe_name = data.get('operator_name', 'Unknown').replace(' ', '_').replace('/', '-')
    docx_path = os.path.abspath(os.path.join(out_path, f"MTOP_{safe_name}.docx"))
    pdf_path = os.path.abspath(os.path.join(out_path, f"MTOP_{safe_name}.pdf"))
    
    doc.save(docx_path)

    try:
        if platform.system() == "Windows":
            from docx2pdf import convert
            convert(docx_path, pdf_path)
            if os.path.exists(pdf_path): return pdf_path, "application/pdf"
        else:
            subprocess.run(['libreoffice', '--headless', '--nologo', '--nofirststartwizard', '--convert-to', 'pdf', docx_path, '--outdir', out_path], check=True)
            if os.path.exists(pdf_path): return pdf_path, "application/pdf"
    except Exception:
        pass
        
    return docx_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"