import requests
import json
from config import GEMINI_API_KEY

def call_ai(prompt):
    response = requests.post(
        url="https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {GEMINI_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "openai/gpt-oss-20b:free",
            "messages": [{"role": "user", "content": prompt}]
        },
        timeout=60
    )
    return response.json()["choices"][0]["message"]["content"]

def clean_json(raw):
    raw = raw.strip()
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()

def extract_criteria(tender_text):
    prompt = f"""You are a government procurement analyst for CRPF India.
Analyze this tender and extract eligibility criteria.
TENDER: {tender_text[:6000]}
Reply with ONLY this JSON, no extra text, no markdown:
{{
  "tender_title": "write title here",
  "tender_category": "Equipment",
  "criteria": [
    {{
      "id": "C1",
      "name": "criterion name",
      "description": "full description",
      "type": "mandatory",
      "threshold": "minimum value required",
      "clause_reference": "clause number if any"
    }}
  ],
  "summary": "brief summary of tender"
}}"""
    raw = call_ai(prompt)
    return json.loads(clean_json(raw))

def evaluate_bidder(tender_criteria, bidder_text, company_name):
    criteria_str = json.dumps(tender_criteria.get("criteria", []), indent=2)
    prompt = f"""You are a senior procurement officer for CRPF India.
Evaluate this bidder against the criteria below.
TENDER: {tender_criteria.get("tender_title", "")}
CRITERIA: {criteria_str}
BIDDER: {company_name}
DOCUMENTS: {bidder_text[:6000]}
Reply with ONLY this JSON, no extra text, no markdown:
{{
  "company_name": "{company_name}",
  "overall_verdict": "Eligible",
  "overall_score": 80,
  "confidence": 90,
  "summary": "brief summary",
  "criteria_results": [
    {{
      "criterion_id": "C1",
      "criterion_name": "name",
      "status": "Pass",
      "extracted_value": "what was found",
      "required_value": "what was needed",
      "explanation": "why pass or fail",
      "source_reference": "where found"
    }}
  ],
  "fraud_flags": [],
  "recommended_action": "what officer should do"
}}"""
    raw = call_ai(prompt)
    return json.loads(clean_json(raw))
