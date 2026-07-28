from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from utils.extract import extract_text_from_file
from utils.ai import evaluate_bidder
from db import get_conn, log_action
import json

router = APIRouter()

@router.post("/evaluate")
async def evaluate(
    tender_id: int = Form(...),
    company_name: str = Form(...),
    file: UploadFile = File(...)
):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT criteria_json FROM tenders WHERE id=?", (tender_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Tender not found")
    criteria = json.loads(row["criteria_json"])
    content = await file.read()
    bidder_text = extract_text_from_file(file.filename, content)
    result = evaluate_bidder(criteria, bidder_text, company_name)
    conn = get_conn()
    c = conn.cursor()
    c.execute(
        "INSERT INTO bidders (tender_id, company_name, filename, raw_text, verdict, score, evaluation_json) VALUES (?,?,?,?,?,?,?)",
        (tender_id, company_name, file.filename, bidder_text[:3000],
         result["overall_verdict"], result["overall_score"], json.dumps(result))
    )
    bidder_id = c.lastrowid
    conn.commit()
    conn.close()
    log_action("BIDDER_EVALUATED", "bidder", bidder_id, f"{company_name}|{result['overall_verdict']}")
    return {"bidder_id": bidder_id, "result": result}

@router.get("/tender/{tender_id}")
def get_bidders(tender_id: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM bidders WHERE tender_id=? ORDER BY score DESC", (tender_id,))
    rows = c.fetchall()
    conn.close()
    return [{"id": r["id"], "company_name": r["company_name"],
             "verdict": r["verdict"], "score": r["score"],
             "evaluation": json.loads(r["evaluation_json"])} for r in rows]
