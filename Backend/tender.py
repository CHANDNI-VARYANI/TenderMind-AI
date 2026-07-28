from fastapi import APIRouter, UploadFile, File, HTTPException
from utils.extract import extract_text_from_file
from utils.ai import extract_criteria
from db import get_conn, log_action
import json

router = APIRouter()

@router.post("/upload")
async def upload_tender(file: UploadFile = File(...)):
    content = await file.read()
    text = extract_text_from_file(file.filename, content)
    if not text:
        raise HTTPException(400, "Could not read file")
    criteria = extract_criteria(text)
    conn = get_conn()
    c = conn.cursor()
    c.execute(
        "INSERT INTO tenders (filename, raw_text, criteria_json) VALUES (?,?,?)",
        (file.filename, text[:5000], json.dumps(criteria))
    )
    tender_id = c.lastrowid
    conn.commit()
    conn.close()
    log_action("TENDER_UPLOADED", "tender", tender_id, file.filename)
    return {"tender_id": tender_id, "criteria": criteria}

@router.get("/")
def list_tenders():
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT id, filename, created_at FROM tenders ORDER BY id DESC")
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.get("/id/{tender_id}")
def get_tender(tender_id: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM tenders WHERE id=?", (tender_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Not found")
    return {"id": row["id"], "filename": row["filename"], "criteria": json.loads(row["criteria_json"])}
