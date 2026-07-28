import pdfplumber
import io
from docx import Document

def extract_text_from_file(filename, content):
    ext = filename.lower().split(".")[-1]
    if ext == "pdf":
        text = ""
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"
        return text.strip()
    elif ext in ("docx", "doc"):
        doc = Document(io.BytesIO(content))
        return "\n".join([p.text for p in doc.paragraphs]).strip()
    elif ext == "txt":
        return content.decode("utf-8", errors="ignore").strip()
    return ""
