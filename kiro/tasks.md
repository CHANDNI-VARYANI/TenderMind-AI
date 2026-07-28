# Implementation Plan: TenderMind AI

## Overview

This plan implements TenderMind AI as a Python (FastAPI) + TypeScript (React) monorepo. Tasks are ordered so each step builds on the previous, with the pipeline wired together at the end. Property-based tests (Hypothesis) cover all 21 correctness properties from the design. Tasks marked `*` are optional and can be skipped for a faster MVP.

---

## Tasks

- [ ] 1. Monorepo scaffolding and environment configuration
  - Create top-level directory layout: `backend/`, `frontend/`, `infra/`, `tests/`
  - Write `docker-compose.yml` with services: `api`, `celery-worker`, `postgres`, `redis`, `minio`, `ollama`, `frontend`
  - Write `.env.example` with all required variables: `DATABASE_URL`, `REDIS_URL`, `MINIO_ENDPOINT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_SECONDS`, `JWT_SECRET`, `DB_PASS`
  - Create `backend/pyproject.toml` (or `requirements.txt`) pinning: `fastapi`, `uvicorn`, `sqlalchemy[asyncio]`, `alembic`, `celery[redis]`, `redis`, `pydantic`, `pyjwt`, `bcrypt`, `pyotp`, `pytesseract`, `pdfplumber`, `python-docx`, `minio`, `weasyprint`, `jinja2`, `hypothesis`, `pytest`, `httpx`
  - Create `frontend/package.json` pinning: `react@18`, `typescript`, `vite`, `tailwindcss`, `@tanstack/react-query`, `zustand`, `axios`
  - _Requirements: 13.1, 13.7, 15.4_


- [ ] 2. Database schema and Alembic migrations
  - [ ] 2.1 Create SQLAlchemy ORM models for all 12 tables
    - Implement `backend/app/models/` with one module per table: `users`, `evaluation_sessions`, `documents`, `ocr_results`, `eligibility_criteria`, `bidder_profiles`, `annual_turnovers`, `certifications`, `evaluation_results`, `vprs_results`, `fraud_alerts`, `audit_log_entries`, `vprs_weights_config`
    - Apply all FK constraints, unique constraints, CHECK constraint on `vprs_weights_config.weights_sum_100`, and indexes on `audit_log_entries(occurred_at)` and `audit_log_entries(actor_id)`
    - _Requirements: 6.6, 10.2, 10.6_
  - [ ] 2.2 Create Alembic migration for initial schema
    - Run `alembic init` and write `env.py` to auto-detect all models
    - Generate and review `versions/0001_initial_schema.py` covering all 12 tables
    - Seed default `vprs_weights_config` row (25, 25, 20, 15, 15) in the migration
    - _Requirements: 6.2, 6.6_
  - [ ] 2.3 Write integration test: Alembic migration runs cleanly and DB constraints are enforced
    - Verify migration applies from scratch without errors
    - Verify `WEIGHTS_NOT_100` constraint fires when weight sum ≠ 100
    - _Requirements: 6.6_


- [ ] 3. Pydantic domain models and shared types
  - [ ] 3.1 Implement Pydantic models in `backend/app/schemas/`
    - `DocumentMetadata`, `EligibilityCriterion`, `BidderProfile`, `CriterionResult`, `VPRSResult`, `FraudAlert`, `AuditEvent`, `AuditLogEntry`, `VPRSWeights`, `TokenPair`, `TokenClaims`
    - Add `DocumentType`, `Verdict`, `AlertSeverity`, `HITLStatus` enums
    - Ensure all models implement `model_config = ConfigDict(from_attributes=True)` for ORM compatibility
    - _Requirements: 4.4, 14.1, 14.4_
  - [ ] 3.2 Write property test: serialization round-trip produces equivalent objects (Property 19)
    - **Property 19: Serialization round-trip produces equivalent objects**
    - **Validates: Requirements 14.3, 4.4, 8.5**
    - Use `st.one_of(metadata_st(), criterion_st(), bidder_st(), vprs_st())`
    - _File: `tests/property/test_properties_document.py`_


- [ ] 4. Auth_Service implementation
  - [ ] 4.1 Implement `backend/app/services/auth_service.py`
    - `login(username, password, totp_code)` → verify bcrypt hash (cost 12), verify TOTP if MFA enabled, return `TokenPair`
    - `refresh(refresh_token)` → validate against Redis, issue new `TokenPair`
    - `verify_token(token)` → decode JWT (HS256, 8-hour TTL), return `TokenClaims`
    - `check_permission(claims, required)` → raise HTTP 403 if role lacks permission
    - Account lockout: increment `failed_attempts`; lock after 5 failures and emit in-platform Admin alert
    - Password hashing: `bcrypt` cost factor 12
    - MFA enrollment: `pyotp.TOTP` (RFC 6238); mandatory for Admin role
    - Store refresh tokens in Redis with 7-day TTL; revoke on logout
    - _Requirements: 11.1–11.8_
  - [ ] 4.2 Implement FastAPI auth router at `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`
    - Return `{access_token, refresh_token}` on login
    - Return HTTP 423 with `ACCOUNT_LOCKED` on locked account
    - Return HTTP 401 with `TOKEN_EXPIRED` on expired JWT
    - _Requirements: 11.3, 11.4, 11.7_
  - [ ] 4.3 Implement Admin user-management router at `GET/POST /api/v1/users`, `PATCH/DELETE /api/v1/users/{user_id}`
    - Enforce Admin-only RBAC via `check_permission`
    - _Requirements: 11.5, 11.6_
  - [ ] 4.4 Write unit tests for Auth_Service
    - Account lockout after exactly 5 consecutive failures
    - MFA enforcement: Admin login without TOTP code is rejected
    - Token refresh flow: valid refresh token produces new access token
    - _Requirements: 11.2, 11.7, 11.8_
  - [ ] 4.5 Write property test: bcrypt round-trip is correct (Property 21)
    - **Property 21: bcrypt round-trip is correct**
    - **Validates: Requirements 11.2**
    - Use `st.text(min_size=1)`
    - _File: `tests/property/test_properties_auth.py`_


- [ ] 5. Document_Ingestion_Service implementation
  - [ ] 5.1 Implement `backend/app/services/document_ingestion_service.py`
    - `validate_format(filename, content)` → check MIME type against allowed set (`application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/jpeg`, `image/png`, `image/tiff`); raise `ValidationError` with descriptive message on failure
    - `validate_size(size_bytes)` → accept if `≤ 52_428_800`; raise `ValidationError` with size-limit message otherwise
    - `store(content, metadata)` → upload to MinIO with SSE-S3; return object key
    - `upload(file, doc_type, session_id, actor)` → orchestrate validate + store + DB insert; return `DocumentMetadata` with UUID v4 `id`
    - _Requirements: 1.1–1.7, 14.1, 14.4, 14.5_
  - [ ] 5.2 Implement FastAPI documents router: `POST /api/v1/documents/upload`, `GET /api/v1/documents/{doc_id}`, `GET /api/v1/documents/{doc_id}/download`
    - Enforce `Procurement_Officer` or `Admin` role for upload/download
    - Return HTTP 422 with `UNSUPPORTED_FILE_FORMAT` or `FILE_TOO_LARGE` error codes
    - _Requirements: 1.2, 1.3, 1.5_
  - [ ] 5.3 Write property tests: valid/invalid format acceptance and file size boundary (Properties 1, 2, 3)
    - **Property 1: Valid format files are accepted**
    - **Property 2: Invalid format files are rejected with a non-empty error message**
    - **Property 3: File size boundary is enforced correctly**
    - **Validates: Requirements 1.1–1.5**
    - Use `st.sampled_from(ALLOWED_MIME_TYPES)`, `st.text()` filtered, `st.integers(0, 200_000_000)`
    - _File: `tests/property/test_properties_document.py`_
  - [ ] 5.4 Write property test: all document IDs are globally unique (Property 4)
    - **Property 4: All document IDs are globally unique**
    - **Validates: Requirements 1.6**
    - Use `st.lists(valid_file_st(), min_size=2, max_size=20)`
    - _File: `tests/property/test_properties_document.py`_
  - [ ] 5.5 Write unit tests for Document_Ingestion_Service
    - Native PDF / DOCX text extraction path does not invoke OCR
    - Session-document association: one tender + multiple bidder submissions
    - Document metadata preserves filename, file size, MIME type, upload timestamp
    - _Requirements: 2.3, 1.7, 14.4_


- [ ] 6. OCR_Engine implementation
  - [ ] 6.1 Implement `backend/app/services/ocr_engine.py`
    - `detect_scan_pages(pdf_path)` → use `pdfplumber` to identify pages with no selectable text (scanned)
    - `extract(doc_id)` → dispatch per document type:
      - Image (JPEG, PNG, TIFF): run `pytesseract.image_to_data`; compute per-page confidence; preserve headings/tables/lists in output
      - PDF with scanned pages: run Tesseract on scanned pages; use `pdfplumber` for digital pages
      - Native PDF / DOCX: delegate to `pdfplumber` / `python-docx`; do not invoke Tesseract
    - Return `OCRResult` with list of `PageExtraction(text, confidence: float [0.0–1.0])`
    - Flag pages where `confidence < 0.75` and emit in-platform notification to `Procurement_Officer`
    - Write `ocr_results` rows to DB per page
    - _Requirements: 2.1–2.6_
  - [ ] 6.2 Write property test: OCR confidence is always in range and flagging is correct (Property 5)
    - **Property 5: OCR confidence is always in range and flagging is correct**
    - **Validates: Requirements 2.1, 2.4, 2.5**
    - Use `st.floats(0.0, 1.0)` to generate mock confidence values; verify `flagged` iff `confidence < 0.75`
    - _File: `tests/property/test_properties_ocr.py`_
  - [ ] 6.3 Write unit tests for OCR_Engine
    - Scanned page detection returns correct page indices for a mixed PDF
    - Multi-page PDF handling: each page produces a separate `PageExtraction`
    - Logical structure preservation: headings and numbered lists appear in extracted text
    - _Requirements: 2.2, 2.6_


- [ ] 7. NLP_Processor implementation
  - [ ] 7.1 Implement `backend/app/services/nlp_processor.py`
    - `_call_llm(prompt)` → POST to `OLLAMA_BASE_URL/api/generate` with model name; enforce `OLLAMA_TIMEOUT_SECONDS`; on `OllamaTimeoutError` or `OllamaUnavailableError`, raise for Celery retry; never log raw prompt content
    - `extract_criteria(tender_text)` → prompt LLM to extract `EligibilityCriterion` list; parse JSON response; classify `criterion_type` using keyword matching (`MANDATORY`/`required` → mandatory; `OPTIONAL`/`preference` → optional); set `flagged_for_review = True` if `confidence < 0.80`
    - `extract_bidder_data(submission_text)` → prompt LLM to extract `BidderProfile`; normalize monetary values to INR Crore (2 d.p.); set absent fields to null; return structured JSON
    - Support English and Hindi in same document
    - _Requirements: 3.1–3.6, 4.1–4.5, 12.1–12.6_
  - [ ] 7.2 Write property test: NLP low-confidence criteria are flagged (Property 6)
    - **Property 6: NLP low-confidence criteria are flagged**
    - **Validates: Requirements 3.5**
    - Use `st.floats(0.0, 1.0)` to generate criterion confidence; verify `flagged_for_review` iff `confidence < 0.80`
    - _File: `tests/property/test_properties_nlp.py`_
  - [ ] 7.3 Write property test: mandatory/optional classification by keywords (Property 7)
    - **Property 7: Mandatory/optional classification is determined by keywords**
    - **Validates: Requirements 3.2**
    - Use `st.text()` with injected keywords (`MANDATORY`, `required`, `OPTIONAL`, `preference`)
    - _File: `tests/property/test_properties_nlp.py`_
  - [ ] 7.4 Write unit tests for NLP_Processor
    - Criterion extraction from known English template tender document
    - Criterion extraction from known Hindi-mixed tender document
    - Null field handling when bidder document omits a field
    - _Requirements: 3.6, 4.2_


- [ ] 8. Eligibility_Evaluator implementation
  - [ ] 8.1 Implement `backend/app/services/eligibility_evaluator.py`
    - `evaluate(criteria, bidders)` → for every (criterion, bidder) pair, produce `CriterionResult` with `verdict` ∈ `{PASS, FAIL, PARTIAL}` and non-empty `evidence` string quoting source document text; no LLM calls (pure Python comparisons)
    - Apply scoring formula: `eligibility_score = (mandatory_pass_count / mandatory_total) * 70 + (optional_pass_count / optional_total) * 30`
    - Mark bidder `INELIGIBLE` and set `eligibility_score = 0` if any mandatory criterion fails
    - `compute_eligibility_score(results)` → return score in `[0.0, 100.0]`
    - Write `evaluation_results` rows to DB; write `bidder_profiles.status` update
    - Performance: 20 bidders × 30 criteria must complete within 120 s
    - _Requirements: 5.1–5.6_
  - [ ]* 8.2 Write property test: evaluation is total and produces valid verdicts (Property 8)
    - **Property 8: Eligibility evaluation is total and produces valid verdicts**
    - **Validates: Requirements 5.1, 5.2, 5.4**
    - Use `st.lists(criterion_st()), bidder_st()`
    - _File: `tests/property/test_properties_evaluation.py`_
  - [ ]* 8.3 Write property test: mandatory failure implies INELIGIBLE and zero score (Property 9)
    - **Property 9: Mandatory failure implies INELIGIBLE status and zero score**
    - **Validates: Requirements 5.3, 5.5, 6.4**
    - Use `criterion_results_st(with_mandatory_fail=True)`
    - _File: `tests/property/test_properties_evaluation.py`_
  - [ ]* 8.4 Write property test: eligibility score is always in range [0, 100] (Property 10)
    - **Property 10: Eligibility score is always in range [0, 100]**
    - **Validates: Requirements 5.5**
    - Use `st.lists(criterion_result_st())`
    - _File: `tests/property/test_properties_evaluation.py`_
  - [ ]* 8.5 Write unit tests for Eligibility_Evaluator
    - Specific compliance matrix: demo tender vs. 3 bidders (bidder1_apex, bidder2_cheap, bidder3_kaveri from demo files)
    - PARTIAL verdict edge cases (e.g., optional criterion partially met)
    - _Requirements: 5.2, 5.4_


- [ ] 9. VPRS_Calculator implementation
  - [ ] 9.1 Implement `backend/app/services/vprs_calculator.py`
    - `calculate(profile, weights)` → compute five component scores (financial stability 25%, relevant experience 25%, certification validity 20%, compliance completeness 15%, historical performance 15%); `vprs_score = sum(component_i * weight_i / 100)`; set `vprs_score = 0` and skip component calculation if bidder is `INELIGIBLE`
    - `rank(results)` → return list ordered by descending `vprs_score`; assign integer `rank` starting at 1
    - Include non-empty `explanation` string detailing each component's contribution
    - Load current weights from `vprs_weights_config` table; weights must sum to 100 (validated at write time by DB CHECK constraint)
    - Write `vprs_results` rows to DB
    - _Requirements: 6.1–6.6_
  - [ ]* 9.2 Write property test: VPRS score is in range and reflects weighted sum (Property 11)
    - **Property 11: VPRS score is always in range [0, 100] and reflects weighted components**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - Use `bidder_profile_st(), vprs_weights_st()`
    - _File: `tests/property/test_properties_vprs.py`_
  - [ ]* 9.3 Write property test: VPRS ranking is in descending order (Property 12)
    - **Property 12: VPRS ranking is in descending order**
    - **Validates: Requirements 6.5**
    - Use `st.lists(vprs_result_st(), min_size=1)`
    - _File: `tests/property/test_properties_vprs.py`_
  - [ ]* 9.4 Write property test: VPRS weight configuration requires sum of 100 (Property 13)
    - **Property 13: VPRS weight configuration requires weights summing to 100**
    - **Validates: Requirements 6.6**
    - Use `st.tuples` of 5 floats in [0, 100]; verify accept iff sum = 100
    - _File: `tests/property/test_properties_vprs.py`_
  - [ ] 9.5 Implement Admin system-config router: `GET/PUT /api/v1/config/vprs-weights`, `GET/PUT /api/v1/config/ollama`
    - `PUT /api/v1/config/vprs-weights` → reject with `WEIGHTS_NOT_100` (HTTP 422) if sum ≠ 100
    - _Requirements: 6.6, 12.2, 12.4_


- [ ] 10. Fraud_Detector implementation
  - [ ] 10.1 Implement `backend/app/services/fraud_detector.py`
    - Near-duplicate detection: compute MinHash signatures for each submission's extracted text; flag pairs with Jaccard similarity ≥ 0.85 across submissions within the same session
    - `validate_gst(s)` → return `True` iff `s` matches regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`; flag mismatches as format anomaly
    - Financial cross-validation: compare declared turnover against figures extracted from CA certificates / balance sheets in the same submission; flag discrepancies
    - Certification expiry: set `is_expired = True` iff `valid_until < eval_date`; set `near_expiry = True` iff `0 ≤ (valid_until - eval_date).days ≤ 90`; flag both conditions
    - Implausible financials: compare turnover against configurable industry benchmark ranges; flag statistical outliers
    - Duplicate submission hash: hash extracted text per submission within session; flag exact duplicates
    - Generate `FraudAlert` with severity `LOW | MEDIUM | HIGH`, description, and `evidence_fields`
    - HIGH severity alerts block finalization (flag in `evaluation_sessions` status)
    - Write `fraud_alerts` rows to DB
    - _Requirements: 7.1–7.7_
  - [ ]* 10.2 Write property test: GST format validation is correct for all inputs (Property 14)
    - **Property 14: GST format validation is correct for all inputs**
    - **Validates: Requirements 7.2**
    - Use `st.text(alphabet=st.characters())`; verify return matches regex truth
    - _File: `tests/property/test_properties_fraud.py`_
  - [ ]* 10.3 Write property test: certification expiry flags are correct (Property 15)
    - **Property 15: Certification expiry flags are correct**
    - **Validates: Requirements 7.6**
    - Use `st.dates(), st.dates()` for `valid_until` and `eval_date`
    - _File: `tests/property/test_properties_fraud.py`_
  - [ ]* 10.4 Write unit tests for Fraud_Detector
    - Near-duplicate detection threshold: two identical submissions produce HIGH alert; dissimilar docs produce no alert
    - Financial cross-validation: declared turnover vs. CA certificate discrepancy
    - Implausible financial figure detection
    - _Requirements: 7.1, 7.3, 7.7_


- [ ] 11. Audit_Log_Service implementation
  - [ ] 11.1 Implement `backend/app/services/audit_log_service.py`
    - `record(event)` → compute `payload_hash = SHA-256(canonical_json(event_payload))`; fetch last `chain_hash` from DB (genesis: `SHA-256("TENDERMIND_GENESIS")`); compute `chain_hash = SHA-256(prev_chain_hash_bytes + payload_hash_bytes)`; insert `AuditLogEntry` atomically; never log raw LLM prompt content
    - `verify_chain(from_date, to_date)` → re-compute hashes for all entries in range ordered by `id`; return `ChainVerificationResult(valid=True)` or `(valid=False, tampered_entry_id=...)` with reason
    - On verification failure: emit in-platform Admin tamper alert
    - `get_entries(filters, actor)` → enforce Auditor/Admin RBAC; query PostgreSQL hot partition; fall back to MinIO cold-storage archive for entries > 7 years
    - Log all event types: document upload, OCR complete, NLP extraction, eligibility evaluation, VPRS calculation, fraud alert, HITL action, report generation, user authentication, LLM invocation (token counts only)
    - _Requirements: 10.1–10.7_
  - [ ]* 11.2 Write property test: audit log entries contain all required fields (Property 16)
    - **Property 16: Audit log entries contain all required fields**
    - **Validates: Requirements 10.1, 10.2**
    - Use `audit_event_st()`
    - _File: `tests/property/test_properties_audit.py`_
  - [ ]* 11.3 Write property test: chain is always valid after sequential inserts (Property 17)
    - **Property 17: Audit log chain hash chain is always valid after sequential inserts**
    - **Validates: Requirements 10.3, 10.4**
    - Use `st.lists(audit_event_st(), min_size=1)`
    - _File: `tests/property/test_properties_audit.py`_
  - [ ]* 11.4 Write property test: modifying any audit log entry invalidates the chain (Property 18)
    - **Property 18: Modifying any audit log entry invalidates the chain**
    - **Validates: Requirements 10.3, 10.5**
    - Use `st.lists(audit_event_st(), min_size=2)` then mutate one entry's payload
    - _File: `tests/property/test_properties_audit.py`_
  - [ ] 11.5 Implement Audit Log router: `GET /api/v1/audit`, `GET /api/v1/audit/verify`
    - `GET /api/v1/audit` → paginated, filterable by `date_from`, `date_to`, `actor_id`, `event_type`; Auditor + Admin only
    - `GET /api/v1/audit/verify` → accepts `from_date`, `to_date` query params; returns `ChainVerificationResult`
    - _Requirements: 10.4, 10.7_


- [ ] 12. Checkpoint — core services complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. HITL_Workflow implementation
  - [ ] 13.1 Implement `backend/app/services/hitl_workflow.py`
    - State machine transitions: `PENDING_REVIEW → IN_REVIEW → (AWAITING_ALERT_ACK →) APPROVED | REJECTED`
    - `start_review(session_id, actor)` → transition to `IN_REVIEW`; record audit event
    - `override_result(session_id, result_id, officer_verdict, justification, actor)` → require `len(justification) >= 10`; write `evaluation_results.officer_verdict` and `.officer_justification`; record audit event
    - `acknowledge_alerts(session_id, actor)` → set `acknowledged_at` on all HIGH-severity `FraudAlert` rows; transition from `AWAITING_ALERT_ACK` to `IN_REVIEW`
    - `approve(session_id, actor)` → reject with HTTP 422 `REVIEW_PERIOD_NOT_ELAPSED` if `now() < evaluation_completed_at + 30 min`; reject with HTTP 422 `HIGH_ALERT_NOT_ACKNOWLEDGED` if any unacknowledged HIGH alert exists; transition to `APPROVED`; record audit event with approver identity and modification summary
    - `reject(session_id, reason, actor)` → transition to `REJECTED`; record audit event
    - Emit in-platform notification to assigned `Procurement_Officer` when `PENDING_REVIEW` is entered
    - _Requirements: 9.1–9.7_
  - [ ] 13.2 Implement HITL router under `/api/v1/sessions/{session_id}/review/`
    - `POST /review/start`, `PATCH /review/results/{result_id}`, `POST /review/acknowledge-alerts`, `POST /review/approve`, `POST /review/reject`
    - _Requirements: 9.2, 9.3, 9.4_
  - [ ]* 13.3 Write property test: HITL 30-minute gate and HIGH alert gate are enforced (Property 20)
    - **Property 20: HITL 30-minute gate and HIGH alert gate are enforced for all sessions**
    - **Validates: Requirements 9.4, 9.6**
    - Use `session_st(), timedelta_st()`; verify both gates independently
    - _File: `tests/property/test_properties_hitl.py`_
  - [ ]* 13.4 Write unit tests for HITL_Workflow
    - State machine transitions: full happy path `PENDING_REVIEW → IN_REVIEW → APPROVED`
    - Modification justification requirement: justification shorter than 10 characters is rejected
    - HIGH alert blocks approval until acknowledged
    - _Requirements: 9.2, 9.3, 9.4_


- [ ] 14. Report_Generator implementation
  - [ ] 14.1 Implement `backend/app/services/report_generator.py`
    - `generate_pdf(session)` → render Jinja2 HTML template with all required sections: bidder summary table (VPRS + eligibility status), per-bidder compliance detail with evidence quotes, VPRS component breakdowns, fraud alerts list, AI confidence levels, top-ranked bidder justification, approving officer name and role; convert to PDF bytes via WeasyPrint
    - `generate_json(session)` → serialize `EvaluationSession` to dict matching the same structure as PDF; include all fields
    - Record SHA-256 hash of PDF bytes in `Audit_Log_Service.record()` at generation time
    - Report is only accessible post-HITL `APPROVED` status
    - _Requirements: 8.1–8.6, 14.2_
  - [ ] 14.2 Implement Reports router: `GET /api/v1/sessions/{session_id}/report/pdf`, `GET /api/v1/sessions/{session_id}/report/json`
    - Return HTTP 403 if session is not in `APPROVED` state
    - _Requirements: 8.1, 8.5_
  - [ ]* 14.3 Write unit tests for Report_Generator
    - PDF generation completeness: all required sections present (bidder table, VPRS breakdown, fraud alerts, officer details)
    - JSON structure validation: JSON report has same top-level keys as internal `EvaluationSession` data model
    - Audit log event fires with SHA-256 hash when report is generated
    - _Requirements: 8.2, 8.3, 8.6_


- [ ] 15. Celery task queue and pipeline wiring
  - [ ] 15.1 Implement Celery app in `backend/app/worker.py`
    - Define queues: `default`, `ocr`, `nlp`, `evaluation`, `report`
    - Implement tasks: `ingest_document`, `ocr_extract`, `nlp_extract`, `evaluate_eligibility`, `calculate_vprs`, `detect_fraud`, `notify_review_ready`, `generate_report`
    - Wire Celery chain: `ingest_document.s() | ocr_extract.s() | nlp_extract.s() | evaluate_eligibility.s() | calculate_vprs.s() | detect_fraud.s() | notify_review_ready.s()`
    - Per-task retry config with exponential backoff:
      - `ingest_document`: max 3, backoff 5s/25s/125s
      - `ocr_extract`: max 3, backoff 10s/50s/250s
      - `nlp_extract`: max 3, backoff 15s/75s/375s
      - `evaluate_eligibility`, `calculate_vprs`, `detect_fraud`, `generate_report`: max 2, backoff 10s/60s
    - On Ollama timeout/unavailable in `nlp_extract`: re-queue with backoff; surface error after 3 failures
    - _Requirements: 12.3, 15.1, 15.2_
  - [ ] 15.2 Implement SSE progress endpoint `GET /api/v1/sessions/{session_id}/status`
    - Workers write `PipelineEvent` JSON to Redis pub/sub channel keyed by `session_id`
    - FastAPI SSE handler subscribes and streams events to browser
    - Workers emit heartbeat event at least every 5 seconds if no other event occurs
    - _Requirements: 13.3, 15.5_
  - [ ] 15.3 Implement evaluation sessions router
    - `POST /api/v1/sessions`, `GET /api/v1/sessions`, `GET /api/v1/sessions/{session_id}`, `POST /api/v1/sessions/{session_id}/bidders`, `POST /api/v1/sessions/{session_id}/start`
    - `POST /start` enqueues the Celery pipeline chain and sets session status to `processing`
    - _Requirements: 1.7, 13.3, 15.2_
  - [ ] 15.4 Implement evaluation results routers
    - `GET /api/v1/sessions/{session_id}/criteria`, `PATCH /api/v1/sessions/{session_id}/criteria/{criterion_id}`, `GET /api/v1/sessions/{session_id}/evaluation`, `GET /api/v1/sessions/{session_id}/vprs`, `GET /api/v1/sessions/{session_id}/fraud-alerts`
    - _Requirements: 5.4, 6.5, 7.4_
  - [ ]* 15.5 Write unit tests for Celery task chain
    - Verify tasks execute in correct order given a mock pipeline
    - Verify `PipelineEvent` status events are emitted to Redis for each stage
    - _Requirements: 15.2, 15.5_


- [ ] 16. Checkpoint — backend pipeline complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. React frontend — project scaffold and shared infrastructure
  - [ ] 17.1 Scaffold Vite + React 18 + TypeScript project in `frontend/`
    - Configure TailwindCSS, ESLint, and TypeScript strict mode
    - Set up React Router v6 for page routing
    - Configure React Query (`QueryClientProvider`) and Zustand (`authStore`)
    - Create `frontend/src/api/` modules: `auth.ts`, `sessions.ts`, `documents.ts`, `evaluation.ts`, `auditLog.ts` with typed Axios wrappers for all `/api/v1/` endpoints
    - Implement `useAuth.ts` hook: JWT storage, role-based guard, auto-logout on 401
    - Implement `useSSE.ts` hook: subscribe to SSE stream; reconnect on error; dispatch `PipelineEvent` typed events
    - _Requirements: 13.1, 13.7_
  - [ ] 17.2 Implement shared UI components in `frontend/src/components/common/`
    - `Button`, `Modal`, `Badge` (text + colour, never colour alone), `Spinner`, `Notification`
    - All components must pass WCAG 2.1 AA: `<label>` for inputs, ARIA roles, minimum contrast 4.5:1, keyboard navigation, `aria-live` regions for dynamic updates
    - _Requirements: 13.6_


- [ ] 18. React frontend — pages and feature components
  - [ ] 18.1 Implement `LoginPage.tsx`
    - Username + password form; optional TOTP code field shown when MFA required
    - On 423 response: display account-locked message
    - On 401: display invalid credentials message
    - _Requirements: 11.2, 11.7, 11.8_
  - [ ] 18.2 Implement document upload components (`frontend/src/components/upload/`)
    - `DocumentUploadZone`: drag-and-drop and file browser; accept PDF, DOCX, JPEG, PNG, TIFF; client-side size guard (50 MB)
    - Show upload progress bar; display server-side validation errors (unsupported format, size exceeded)
    - _Requirements: 13.2_
  - [ ] 18.3 Implement session and pipeline progress components (`frontend/src/components/session/`)
    - `SessionDashboard`: list of sessions with status badges
    - `PipelineProgress`: subscribe via `useSSE`; render per-stage status (INGESTION, OCR, NLP, EVALUATION, VPRS, FRAUD, READY_FOR_REVIEW); update at ≤ 5-second intervals
    - _Requirements: 13.3, 15.5_
  - [ ] 18.4 Implement evaluation dashboard components (`frontend/src/components/evaluation/`)
    - `ComplianceMatrix`: sortable table — rows = criteria, columns = bidders, cells show PASS/FAIL/PARTIAL badges with evidence tooltip
    - `VPRSScoreCard`: per-bidder VPRS with component breakdown bar chart; ranked list in descending order
    - `FraudAlertPanel`: list of fraud alerts with severity badge, description, and evidence fields; highlight HIGH-severity alerts
    - _Requirements: 13.4, 5.4, 6.5, 7.4_
  - [ ] 18.5 Implement HITL review components and page (`frontend/src/components/hitl/`, `HITLReviewPage.tsx`)
    - `HITLReviewPanel`: display AI reasoning per criterion; allow override (verdict select + justification textarea ≥ 10 chars)
    - `CriterionOverride`: inline edit for individual criterion result
    - `ApprovalGate`: show remaining review time countdown; disable Approve button until 30 min elapsed and HIGH alerts acknowledged
    - `HITLReviewPage`: orchestrate all HITL components; POST to `/review/approve` or `/review/reject`
    - _Requirements: 9.1–9.7, 13.5_
  - [ ] 18.6 Implement `AuditPage.tsx` and audit components (`frontend/src/components/audit/`)
    - `AuditLogTable`: paginated log entries filterable by date, actor, event type; Auditor and Admin roles only
    - `ChainVerificationResult`: trigger `GET /api/v1/audit/verify`; display pass/fail with tampered entry detail
    - _Requirements: 10.4, 10.7, 13.4_
  - [ ] 18.7 Implement `DashboardPage.tsx`, `SessionDetailPage.tsx`, `ReportsPage.tsx`
    - `DashboardPage`: session list, create-session button, quick stats
    - `SessionDetailPage`: aggregates pipeline progress, compliance matrix, VPRS, fraud alerts, HITL controls
    - `ReportsPage`: download PDF and JSON report buttons (shown only for approved sessions)
    - _Requirements: 13.4, 13.5, 8.1, 8.5_


- [ ] 19. Integration tests
  - [ ]* 19.1 Write end-to-end pipeline integration test
    - Upload demo tender (`demo_tender.txt`) + 3 bidder submissions (`bidder1_apex.txt`, `bidder2_cheap.txt`, `bidder3_kaveri.txt`) via API
    - Trigger pipeline; poll session status until `PENDING_REVIEW`
    - Officer performs HITL review; approves after 30-minute gate (mock clock)
    - Download and validate PDF and JSON reports
    - Verify audit log chain is valid after full session
    - _Requirements: 5.6, 8.1, 9.1, 10.3, 15.1_
  - [ ]* 19.2 Write Ollama timeout and retry integration test
    - Mock Ollama service as unavailable; verify task is retried up to 3 times with correct backoff
    - Verify `OLLAMA_TIMEOUT` error is surfaced to session status after 3 failures
    - _Requirements: 12.3, 12.5_
  - [ ]* 19.3 Write RBAC integration test
    - Auditor: cannot upload documents (403), cannot start session (403), can read audit logs (200), can download finalized report (200)
    - Procurement_Officer: cannot access admin config endpoints (403)
    - _Requirements: 11.5, 11.6_
  - [ ]* 19.4 Write audit log integrity integration test
    - Full session creates a verifiable chain: `GET /api/v1/audit/verify` returns `valid=True`
    - Manually corrupt one entry's payload in DB; verify endpoint returns `valid=False` with correct `tampered_entry_id`
    - _Requirements: 10.3, 10.4, 10.5_


- [ ] 20. Kubernetes deployment configuration
  - [ ] 20.1 Write Kubernetes manifests in `infra/k8s/`
    - `Deployment` + `HPA` for `api` (min 2, max 10 replicas; scale at CPU 70%)
    - `Deployment` (one per queue) for `celery-worker`: `default`, `ocr`, `nlp`, `evaluation`, `report`
    - `Deployment` for `frontend` (min 2 replicas)
    - `StatefulSet` for `postgres` with `PersistentVolumeClaim` (ReadWriteOnce); `CronJob` for `pg_basebackup`
    - `StatefulSet` for `redis` with PVC; optional Sentinel config for HA
    - `StatefulSet` for `minio` with PVC; distributed mode for HA
    - `StatefulSet` for `ollama` with PVC; `nodeSelector` for GPU node pool; `initContainer` to preload model
    - `Ingress` (nginx) with TLS termination routing `/` → frontend, `/api/v1/` → api
    - `Secret` resources for `DB_PASS`, `JWT_SECRET`, `MINIO_ROOT_PASSWORD`
    - `ConfigMap` for Ollama model name, timeout, feature flags
    - _Requirements: 15.4_
  - [ ] 20.2 Write `infra/k8s/namespace.yaml` and `kustomization.yaml` for environment overlays (dev / prod)
    - _Requirements: 15.4_

- [ ] 21. Final checkpoint — full stack wired and all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for full traceability
- Checkpoints at tasks 12, 16, and 21 ensure incremental validation across backend, full pipeline, and full stack
- All 21 correctness properties from the design are covered by property-based tests (Hypothesis `@given` with `@settings(max_examples=100)`)
- Unit tests cover specific examples, edge cases, and infrastructure wiring where PBT does not apply
- Integration tests use testcontainers for real PostgreSQL, Redis, and MinIO
- The Celery pipeline chain is the backbone: each downstream task receives the output of its predecessor
- Kubernetes manifests are structured with Kustomize overlays for dev/prod parity
- All property test files live under `tests/property/`; unit tests under `tests/unit/`; integration tests under `tests/integration/`
- The FastAPI app must be started with `uvicorn app.main:app`; the Celery worker with `celery -A app.worker worker -Q default,ocr,nlp,evaluation,report`


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["2.1", "3.1", "17.1"]
    },
    {
      "id": 1,
      "tasks": ["2.2", "3.2", "17.2"]
    },
    {
      "id": 2,
      "tasks": ["2.3", "4.1", "5.1", "6.1", "7.1", "8.1", "9.1", "10.1", "11.1", "13.1", "14.1"]
    },
    {
      "id": 3,
      "tasks": ["4.2", "4.3", "5.2", "6.2", "7.2", "7.3", "8.2", "8.3", "8.4", "9.2", "9.3", "9.4", "10.2", "10.3", "11.2", "11.3", "11.4", "13.2", "13.3", "14.2"]
    },
    {
      "id": 4,
      "tasks": ["4.4", "4.5", "5.3", "5.4", "5.5", "6.3", "7.4", "8.5", "9.5", "10.4", "11.5", "13.4", "14.3"]
    },
    {
      "id": 5,
      "tasks": ["15.1", "15.2", "15.3", "15.4", "18.1", "18.2"]
    },
    {
      "id": 6,
      "tasks": ["15.5", "18.3", "18.4", "18.5", "18.6", "18.7"]
    },
    {
      "id": 7,
      "tasks": ["19.1", "19.2", "19.3", "19.4", "20.1"]
    },
    {
      "id": 8,
      "tasks": ["20.2"]
    }
  ]
}
```
