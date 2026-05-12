import os
import platform
import subprocess
import re
from docx import Document
from docx.shared import Inches
from datetime import datetime
from database import BASE_DIR

def replace_text_in_paragraph(paragraph, mapping, sig_path=None):
    """
    Safely replaces placeholders in a paragraph.
    Forces the newly injected values to be BOLD while keeping labels normal.
    """
    full_text = paragraph.text
    
    # Check if there are variables to replace or signatures to process in this specific paragraph
    found_keys = [k for k in mapping.keys() if k in full_text]
    has_sig = "[E_SIGNATURE]" in full_text or "{{E_SIGNATURE}}" in full_text
    
    if not found_keys and not has_sig:
        return
        
    # Attempt to preserve the original font family and size from the template
    base_font_name = paragraph.runs[0].font.name if paragraph.runs else None
    base_font_size = paragraph.runs[0].font.size if paragraph.runs else None

    # Strip the signature placeholder out of the text string so it doesn't print literally
    clean_text = full_text.replace("[E_SIGNATURE]", "").replace("{{E_SIGNATURE}}", "")
    
    # Clear the existing XML runs to prevent Microsoft Word ghosting/artifacting
    for run in paragraph.runs:
        run.text = ""

    if found_keys:
        # Create a dynamic regex pattern to split the sentence exactly at the placeholders
        pattern = re.compile("|".join(map(re.escape, found_keys)))
        parts = pattern.split(clean_text)
        matches = pattern.findall(clean_text)
        
        # Rebuild the paragraph run-by-run
        for i in range(len(parts)):
            if parts[i]:
                # 1. Add the normal text (e.g., "Motor No: ")
                run = paragraph.add_run(parts[i])
                if base_font_name: run.font.name = base_font_name
                if base_font_size: run.font.size = base_font_size
                
            if i < len(matches):
                # 2. Add the injected value (e.g., "162FMKP5102230") and MAKE IT BOLD
                key = matches[i]
                val = str(mapping[key])
                run = paragraph.add_run(val)
                run.bold = True  # <--- THIS FORCES ALL EXTRACTED VALUES TO BE BOLD
                if base_font_name: run.font.name = base_font_name
                if base_font_size: run.font.size = base_font_size
    else:
        # If no variables but it had a signature, restore the normal text
        if clean_text:
            run = paragraph.add_run(clean_text)
            if base_font_name: run.font.name = base_font_name
            if base_font_size: run.font.size = base_font_size

    # Finally, append the E-Signature image to the end of the paragraph if enabled
    if has_sig and sig_path and os.path.exists(sig_path):
        run = paragraph.add_run()
        run.add_picture(sig_path, width=Inches(1.5))


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

    # Universal Mapper: Maps both [BRACKET] and {{CURLY}} syntax
    replacements = {
        "[SBN_NO]": data.get("sbn_no", ""),
        "{{SBN_NO}}": data.get("sbn_no", ""),
        "[NAME]": data.get("operator_name", "").upper(),
        "{{NAME}}": data.get("operator_name", "").upper(),
        "[ADDRESS]": data.get("address", "").upper(),
        "{{ADDRESS}}": data.get("address", "").upper(),
        "[MOTOR_NO]": data.get("motor_no", ""),
        "{{MOTOR_NO}}": data.get("motor_no", ""),
        "[CHASSIS_NO]": data.get("chassis_no", ""),
        "{{CHASSIS_NO}}": data.get("chassis_no", ""),
        "[MAKE]": data.get("make", "").upper(),
        "{{MAKE}}": data.get("make", "").upper(),
        "[PLATE_NO]": plate_val,
        "{{PLATE_NO}}": plate_val,
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

    # 1. Process standard paragraphs outside tables
    for paragraph in doc.paragraphs:
        replace_text_in_paragraph(paragraph, replacements, sig_path)

    # 2. Process paragraphs inside the invisible grid table
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    replace_text_in_paragraph(paragraph, replacements, sig_path)

    # Output file handling
    safe_name = data.get('operator_name', 'Unknown').replace(' ', '_').replace('/', '-')
    docx_path = os.path.abspath(os.path.join(out_path, f"MTOP_{safe_name}.docx"))
    pdf_path = os.path.abspath(os.path.join(out_path, f"MTOP_{safe_name}.pdf"))
    
    doc.save(docx_path)

    # Cross-Platform PDF Compilation
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