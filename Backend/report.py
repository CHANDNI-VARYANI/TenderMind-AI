from fastapi import APIRouter, HTTPException
from db import get_conn
import json

router = APIRouter()

@router.get("/audit")
def get_audit_log():
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 50")
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.get("/summary/{tender_id}")
def get_summary(tender_id: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM tenders WHERE id=?", (tender_id,))
    tender = c.fetchone()
    if not tender:
        raise HTTPException(404, "Not found")
    c.execute("SELECT * FROM bidders WHERE tender_id=?", (tender_id,))
    bidders = c.fetchall()
    conn.close()
    return {
        "tender": {"id": tender["id"], "filename": tender["filename"],
                   "criteria": json.loads(tender["criteria_json"])},
        "stats": {
            "total": len(bidders),
            "eligible": sum(1 for b in bidders if b["verdict"] == "Eligible"),
            "not_eligible": sum(1 for b in bidders if b["verdict"] == "Not Eligible"),
            "needs_review": sum(1 for b in bidders if b["verdict"] == "Needs Manual Review")
        },
        "bidders": [{"id": b["id"], "company_name": b["company_name"],
                     "verdict": b["verdict"], "score": b["score"],
                     "evaluation": json.loads(b["evaluation_json"])} for b in bidders]
    }
