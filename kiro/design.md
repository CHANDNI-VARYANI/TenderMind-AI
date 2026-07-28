# Design Document: TenderMind AI

## Overview

TenderMind AI is an AI-powered government procurement intelligence platform. It accepts tender documents and bidder submissions, extracts structured data via OCR and NLP, evaluates vendor eligibility, calculates a Vendor Performance and Reliability Score (VPRS), detects potential fraud, and generates explainable evaluation reports—all behind a Human-in-the-Loop (HITL) approval gate. Every action is recorded in a cryptographically chained, tamper-evident audit log.

**Technology Stack**

| Layer | Technology |
|---|---|
| Frontend | React 18 (TypeScript), Vite, TailwindCSS, React Query |
| Backend | FastAPI (Python 3.11), SQLAlchemy 2.x, Alembic |
| Task Queue | Celery + Redis |
| LLM Inference | Ollama (self-hosted, configurable model) |
| OCR | Tesseract 5 via `pytesseract`; `pdfplumber` for native PDFs |
| Database | PostgreSQL 15 (primary), Redis 7 (cache + queue) |
| Object Storage | MinIO (S3-compatible, self-hosted) |
| Authentication | JWT (PyJWT), bcrypt (cost 12), TOTP MFA |
| Containerisation | Docker Compose (dev/single-node), Kubernetes (multi-node) |
| PDF Generation | WeasyPrint |
| API Docs | FastAPI auto-generated OpenAPI at `/api/v1/docs` |


---

## Architecture

### High-Level System Diagram

```mermaid
graph TB
    subgraph Browser["Browser (React SPA)"]
        UI[React UI]
    end

    subgraph API["API Layer (FastAPI)"]
        GW[API Gateway /api/v1/]
        Auth[Auth_Service]
    end

    subgraph Workers["Async Workers (Celery)"]
        W1[Document Worker]
        W2[OCR Worker]
        W3[NLP Worker]
        W4[Evaluation Worker]
        W5[Report Worker]
    end

    subgraph AI["AI Services"]
        OCR[OCR_Engine\nTesseract / pdfplumber]
        LLM[Ollama_LLM\nself-hosted]
    end

    subgraph Storage["Storage"]
        PG[(PostgreSQL 15)]
        RD[(Redis 7)]
        MN[(MinIO\nObject Storage)]
    end

    UI -->|HTTPS REST / SSE| GW
    GW --> Auth
    GW -->|Enqueue tasks| RD
    RD -->|Dequeue| Workers
    W2 --> OCR
    W3 --> LLM
    Workers --> PG
    Workers --> MN
    GW --> PG
```

### Request / Response Flow

1. The React SPA sends authenticated HTTPS requests to `/api/v1/`.
2. FastAPI validates JWT, checks RBAC, then either responds directly or enqueues a Celery task via Redis.
3. Long-running tasks (OCR, NLP, evaluation) execute on Celery workers; status is streamed to the browser via Server-Sent Events (SSE).
4. All database writes go to PostgreSQL. Raw document binaries are stored in MinIO.
5. Every significant operation produces an audit log entry via `Audit_Log_Service` before the response is returned.


---

## Components and Interfaces

### Document_Ingestion_Service

**Responsibility**: Receive, validate, store, and coordinate processing of uploaded documents.

**Interfaces**

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/documents/upload` | Upload a document (multipart/form-data) |
| GET | `/api/v1/documents/{doc_id}` | Retrieve document metadata |
| GET | `/api/v1/sessions/{session_id}/documents` | List documents in a session |

**Internal Contract**

```python
class DocumentIngestionService:
    def upload(self, file: UploadFile, doc_type: DocumentType,
               session_id: UUID, actor: User) -> DocumentMetadata: ...
    def validate_format(self, filename: str, content: bytes) -> None: ...  # raises ValidationError
    def validate_size(self, size_bytes: int) -> None: ...                  # raises ValidationError
    def store(self, content: bytes, metadata: DocumentMetadata) -> str: ...  # returns MinIO key
```

**Validation Rules**
- Allowed MIME types: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/jpeg`, `image/png`, `image/tiff`
- Maximum file size: 50 MB (52,428,800 bytes)
- Document ID uniqueness enforced by UUID v4 generation and DB primary key constraint

---

### OCR_Engine

**Responsibility**: Extract text from scanned images and scanned-page PDFs.

**Interfaces**

```python
class OCREngine:
    def extract(self, doc_id: UUID) -> OCRResult: ...
    def detect_scan_pages(self, pdf_path: str) -> list[int]: ...  # page indices
```

**Processing Logic**
- Native digital PDF / DOCX → `pdfplumber` / `python-docx` (no OCR invoked)
- Image files (JPEG, PNG, TIFF) → Tesseract 5 (`pytesseract.image_to_data`)
- PDFs with scanned pages → per-page detection; scanned pages go through Tesseract; digital pages use pdfplumber
- Each page yields a `PageExtraction` with `text: str` and `confidence: float` (0.0–1.0)
- Pages with confidence < 0.75 are flagged; in-platform notification sent to Procurement_Officer

---

### NLP_Processor

**Responsibility**: Parse eligibility criteria from tenders and extract structured vendor fields from bidder submissions using the self-hosted Ollama LLM.

**Interfaces**

```python
class NLPProcessor:
    def extract_criteria(self, tender_text: str) -> list[EligibilityCriterion]: ...
    def extract_bidder_data(self, submission_text: str) -> BidderProfile: ...
    def _call_llm(self, prompt: str) -> str: ...  # internal; calls Ollama REST API
```

**Ollama Integration**
- Endpoint: configurable via `OLLAMA_BASE_URL` env var (default: `http://ollama:11434`)
- Model: configurable via `OLLAMA_MODEL` env var (default: `llama3`)
- Timeout: configurable via `OLLAMA_TIMEOUT_SECONDS` (default: `120`)
- On timeout or connection error: task is re-queued with exponential back-off (max 3 retries), error returned to caller
- Raw prompt content is never written to audit logs; only token counts are recorded


---

### Eligibility_Evaluator

**Responsibility**: Compare each bidder's structured profile against extracted eligibility criteria and produce PASS / FAIL / PARTIAL verdicts.

**Interfaces**

```python
class EligibilityEvaluator:
    def evaluate(self, criteria: list[EligibilityCriterion],
                 bidders: list[BidderProfile]) -> EvaluationMatrix: ...
    def compute_eligibility_score(self, results: list[CriterionResult]) -> float: ...
```

**Scoring Formula**

```
eligibility_score = (mandatory_pass_count / mandatory_total) * 70
                  + (optional_pass_count / optional_total) * 30
```

A bidder with any mandatory FAIL receives `INELIGIBLE` status; `eligibility_score` is set to 0 for INELIGIBLE bidders regardless of formula output.

**Performance Constraint**: 20 bidders × 30 criteria must complete within 120 seconds. Each criterion comparison is a pure Python function (no LLM call); LLM is used only in NLP_Processor extraction phase.

---

### VPRS_Calculator

**Responsibility**: Compute the composite Vendor Performance and Reliability Score (0–100) for each eligible bidder.

**Interfaces**

```python
class VPRSCalculator:
    def calculate(self, profile: BidderProfile,
                  weights: VPRSWeights) -> VPRSResult: ...
    def rank(self, results: list[VPRSResult]) -> list[RankedBidder]: ...
```

**Default Weight Configuration** (Admin-configurable, must sum to 100)

| Component | Default Weight |
|---|---|
| Financial Stability (turnover trend) | 25% |
| Relevant Experience | 25% |
| Certification Validity & Scope | 20% |
| Compliance Completeness (optional criteria) | 15% |
| Historical Performance | 15% |

Bidders with any mandatory FAIL receive VPRS = 0 without component calculation.

---

### Fraud_Detector

**Responsibility**: Identify anomalies, duplicate content, and suspicious patterns in bidder submissions.

**Detection Checks**

| Check | Method |
|---|---|
| Near-duplicate documents | MinHash / Jaccard similarity (threshold: ≥ 0.85 similarity) |
| GST format validation | Regex: `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$` |
| Financial cross-validation | Compare declared turnover vs. figures in CA certificates/balance sheets |
| Expired / near-expiry certs | Compare certification validity date vs. evaluation date |
| Implausible financials | Statistical deviation from configurable industry benchmark ranges |
| Duplicate submission detection | Per-session hash comparison of extracted text |

**Alert Severity Levels**: LOW, MEDIUM, HIGH. HIGH alerts block finalization and require mandatory HITL review.

---

### Report_Generator

**Responsibility**: Produce PDF and JSON evaluation reports after HITL approval.

**Interfaces**

```python
class ReportGenerator:
    def generate_pdf(self, session: EvaluationSession) -> bytes: ...
    def generate_json(self, session: EvaluationSession) -> dict: ...
```

PDF is produced with WeasyPrint from an HTML template (Jinja2). JSON report mirrors the same structure as the internal `EvaluationSession` data model. SHA-256 hash of the PDF bytes is recorded in the audit log at generation time.


---

### Audit_Log_Service

**Responsibility**: Record every significant event to a cryptographically chained, tamper-evident append-only log.

**Interfaces**

```python
class AuditLogService:
    def record(self, event: AuditEvent) -> AuditLogEntry: ...
    def verify_chain(self, from_date: datetime, to_date: datetime) -> ChainVerificationResult: ...
    def get_entries(self, filters: AuditLogFilter, actor: User) -> list[AuditLogEntry]: ...
```

**Hash Chain Construction**

```
entry.payload_hash   = SHA-256(json(event_payload))
entry.chain_hash     = SHA-256(prev_entry.chain_hash + entry.payload_hash)
```

The genesis entry uses `chain_hash = SHA-256("TENDERMIND_GENESIS")`. Any modification to a past entry invalidates its `chain_hash`, which then invalidates all subsequent entries. The verification endpoint re-computes the chain and compares against stored values.

**Events Logged**: document upload, OCR complete, NLP extraction, eligibility evaluation, VPRS calculation, fraud alert, HITL action, report generation, user authentication, LLM invocation (token counts only).

---

### Auth_Service

**Responsibility**: Authenticate users, issue JWTs, enforce RBAC, handle MFA, and manage account lockout.

**Interfaces**

```python
class AuthService:
    def login(self, username: str, password: str, totp_code: str | None) -> TokenPair: ...
    def refresh(self, refresh_token: str) -> TokenPair: ...
    def verify_token(self, token: str) -> TokenClaims: ...
    def check_permission(self, claims: TokenClaims, required: Permission) -> None: ...
```

**JWT Configuration**
- Access token TTL: 8 hours
- Refresh token TTL: 7 days (stored in Redis; revocable)
- Algorithm: HS256 (configurable to RS256 for multi-service deployments)
- Password hashing: bcrypt, cost factor 12

**Account Lockout**: After 5 consecutive failures, account is locked; Admin is notified via in-platform alert. Unlock requires Admin action.

**MFA**: TOTP (RFC 6238) using `pyotp`. Mandatory for Admin role. Optional for other roles (per system config).

---

### HITL_Workflow

**Responsibility**: Gate AI evaluation finalization behind mandatory human review.

**State Machine**

```mermaid
stateDiagram-v2
    [*] --> PENDING_REVIEW : evaluation_complete
    PENDING_REVIEW --> IN_REVIEW : officer_opens_review
    IN_REVIEW --> AWAITING_ALERT_ACK : high_severity_fraud_alert_present
    AWAITING_ALERT_ACK --> IN_REVIEW : officer_acknowledges_alert
    IN_REVIEW --> APPROVED : officer_approves AND review_period_elapsed
    IN_REVIEW --> REJECTED : officer_rejects
    APPROVED --> [*] : report_generated
    REJECTED --> [*] : session_closed
```

**Business Rules**
- Minimum review period: 30 minutes from `evaluation_complete` timestamp
- Approving before 30 minutes elapses returns HTTP 422 with `review_period_not_elapsed` error
- HIGH severity fraud alerts must be acknowledged before approval is allowed
- All modifications require a written justification (minimum 10 characters)


---

## Data Models

### Database Schema (PostgreSQL)

#### `users`

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(64) UNIQUE NOT NULL,
    email         VARCHAR(256) UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,           -- bcrypt
    role          VARCHAR(32) NOT NULL,             -- 'admin' | 'procurement_officer' | 'auditor'
    mfa_secret    VARCHAR(64),                      -- TOTP secret; NULL if MFA not enrolled
    mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `evaluation_sessions`

```sql
CREATE TABLE evaluation_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tender_doc_id   UUID NOT NULL REFERENCES documents(id),
    created_by      UUID NOT NULL REFERENCES users(id),
    status          VARCHAR(32) NOT NULL DEFAULT 'created',
    -- 'created' | 'processing' | 'pending_review' | 'in_review' |
    -- 'awaiting_alert_ack' | 'approved' | 'rejected'
    evaluation_completed_at TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,
    approved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `documents`

```sql
CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID REFERENCES evaluation_sessions(id),
    doc_type      VARCHAR(32) NOT NULL,   -- 'tender' | 'bidder_submission'
    filename      VARCHAR(512) NOT NULL,
    file_size     BIGINT NOT NULL,
    mime_type     VARCHAR(128) NOT NULL,
    storage_key   VARCHAR(1024) NOT NULL, -- MinIO object key
    uploaded_by   UUID NOT NULL REFERENCES users(id),
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    bidder_name   VARCHAR(256)           -- populated after NLP extraction
);
```

#### `ocr_results`

```sql
CREATE TABLE ocr_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id),
    page_number INTEGER NOT NULL,
    text        TEXT NOT NULL,
    confidence  NUMERIC(4,3) NOT NULL,  -- 0.000 to 1.000
    flagged     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `eligibility_criteria`

```sql
CREATE TABLE eligibility_criteria (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID NOT NULL REFERENCES evaluation_sessions(id),
    code          VARCHAR(16),           -- e.g. 'C1', 'C2'
    description   TEXT NOT NULL,
    criterion_type VARCHAR(16) NOT NULL, -- 'mandatory' | 'optional'
    threshold_value NUMERIC(18,2),
    threshold_unit VARCHAR(64),
    comparison_op  VARCHAR(16),          -- 'gte' | 'lte' | 'eq' | 'contains'
    confidence     NUMERIC(4,3),
    flagged_for_review BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_by  UUID REFERENCES users(id),
    confirmed_at  TIMESTAMPTZ
);
```

#### `bidder_profiles`

```sql
CREATE TABLE bidder_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES evaluation_sessions(id),
    document_id     UUID NOT NULL REFERENCES documents(id),
    company_name    VARCHAR(512),
    gst_number      VARCHAR(15),
    gst_status      VARCHAR(32),
    msme_registered BOOLEAN,
    msme_number     VARCHAR(64),
    years_experience NUMERIC(5,1),
    raw_json        JSONB NOT NULL,      -- full structured extraction
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```


#### `annual_turnovers`

```sql
CREATE TABLE annual_turnovers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bidder_profile_id UUID NOT NULL REFERENCES bidder_profiles(id),
    financial_year    VARCHAR(16) NOT NULL,  -- e.g. 'FY2024'
    amount_inr_crore  NUMERIC(18,2) NOT NULL
);
```

#### `certifications`

```sql
CREATE TABLE certifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bidder_profile_id UUID NOT NULL REFERENCES bidder_profiles(id),
    cert_type        VARCHAR(256),
    cert_number      VARCHAR(256),
    issuer           VARCHAR(512),
    valid_until      DATE,
    is_expired       BOOLEAN,
    near_expiry      BOOLEAN  -- within 90 days
);
```

#### `evaluation_results`

```sql
CREATE TABLE evaluation_results (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id        UUID NOT NULL REFERENCES evaluation_sessions(id),
    bidder_profile_id UUID NOT NULL REFERENCES bidder_profiles(id),
    criterion_id      UUID NOT NULL REFERENCES eligibility_criteria(id),
    verdict           VARCHAR(16) NOT NULL,  -- 'PASS' | 'FAIL' | 'PARTIAL'
    evidence          TEXT,
    ai_confidence     NUMERIC(4,3),
    -- HITL overrides
    officer_verdict   VARCHAR(16),
    officer_justification TEXT,
    modified_by       UUID REFERENCES users(id),
    modified_at       TIMESTAMPTZ
);
```

#### `vprs_results`

```sql
CREATE TABLE vprs_results (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id        UUID NOT NULL REFERENCES evaluation_sessions(id),
    bidder_profile_id UUID NOT NULL REFERENCES bidder_profiles(id),
    vprs_score        NUMERIC(5,2) NOT NULL,  -- 0.00 to 100.00
    financial_score   NUMERIC(5,2),
    experience_score  NUMERIC(5,2),
    cert_score        NUMERIC(5,2),
    compliance_score  NUMERIC(5,2),
    historical_score  NUMERIC(5,2),
    rank              INTEGER,
    explanation       TEXT,
    weights_snapshot  JSONB NOT NULL  -- weights at time of calculation
);
```

#### `fraud_alerts`

```sql
CREATE TABLE fraud_alerts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id        UUID NOT NULL REFERENCES evaluation_sessions(id),
    bidder_profile_id UUID REFERENCES bidder_profiles(id),
    severity          VARCHAR(16) NOT NULL,  -- 'LOW' | 'MEDIUM' | 'HIGH'
    alert_type        VARCHAR(64) NOT NULL,
    description       TEXT NOT NULL,
    evidence_fields   JSONB,
    acknowledged_by   UUID REFERENCES users(id),
    acknowledged_at   TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `audit_log_entries`

```sql
CREATE TABLE audit_log_entries (
    id             BIGSERIAL PRIMARY KEY,
    event_type     VARCHAR(64) NOT NULL,
    actor_id       UUID REFERENCES users(id),
    actor_role     VARCHAR(32),
    session_id     UUID,
    document_ids   UUID[],
    event_payload  JSONB NOT NULL,
    payload_hash   CHAR(64) NOT NULL,   -- SHA-256 hex of event_payload JSON
    chain_hash     CHAR(64) NOT NULL,   -- SHA-256 hex of (prev_chain_hash + payload_hash)
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log_entries (occurred_at);
CREATE INDEX ON audit_log_entries (actor_id);
```

#### `vprs_weights_config`

```sql
CREATE TABLE vprs_weights_config (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_weight    NUMERIC(5,2) NOT NULL DEFAULT 25,
    experience_weight   NUMERIC(5,2) NOT NULL DEFAULT 25,
    cert_weight         NUMERIC(5,2) NOT NULL DEFAULT 20,
    compliance_weight   NUMERIC(5,2) NOT NULL DEFAULT 15,
    historical_weight   NUMERIC(5,2) NOT NULL DEFAULT 15,
    updated_by          UUID REFERENCES users(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT weights_sum_100 CHECK (
        financial_weight + experience_weight + cert_weight +
        compliance_weight + historical_weight = 100
    )
);
```


### Python Data Model (Pydantic / SQLAlchemy)

Key domain objects exchanged between services:

```python
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime, date
from typing import Optional
from enum import Enum

class DocumentType(str, Enum):
    TENDER = "tender"
    BIDDER_SUBMISSION = "bidder_submission"

class DocumentMetadata(BaseModel):
    id: UUID
    filename: str
    file_size: int               # bytes
    mime_type: str
    doc_type: DocumentType
    uploaded_at: datetime
    storage_key: str
    extraction_confidence: Optional[float] = None  # overall; None for non-OCR docs

class EligibilityCriterion(BaseModel):
    id: UUID
    code: str
    description: str
    criterion_type: str          # 'mandatory' | 'optional'
    threshold_value: Optional[float]
    threshold_unit: Optional[str]
    comparison_op: Optional[str]
    confidence: float            # NLP extraction confidence

class BidderProfile(BaseModel):
    id: UUID
    company_name: str
    gst_number: Optional[str]
    gst_status: Optional[str]
    msme_registered: bool
    years_experience: Optional[float]
    annual_turnovers: list[dict]  # [{financial_year, amount_inr_crore}]
    certifications: list[dict]
    raw_json: dict

class CriterionResult(BaseModel):
    criterion_id: UUID
    verdict: str                 # 'PASS' | 'FAIL' | 'PARTIAL'
    evidence: str
    ai_confidence: float

class VPRSResult(BaseModel):
    bidder_profile_id: UUID
    vprs_score: float
    component_scores: dict[str, float]
    explanation: str
    rank: int

class FraudAlert(BaseModel):
    id: UUID
    severity: str                # 'LOW' | 'MEDIUM' | 'HIGH'
    alert_type: str
    description: str
    evidence_fields: dict

class AuditEvent(BaseModel):
    event_type: str
    actor_id: UUID
    actor_role: str
    session_id: Optional[UUID]
    document_ids: list[UUID]
    payload: dict                # never contains raw LLM prompt content
```


---

## API Design

All endpoints live under `/api/v1/`. Authentication is required for all endpoints except `/api/v1/auth/login`. OpenAPI docs are available at `/api/v1/docs`.

### Authentication

| Method | Path | Description | Roles |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Username + password (+ TOTP if MFA enabled). Returns `{access_token, refresh_token}`. | Public |
| POST | `/api/v1/auth/refresh` | Exchange refresh token for new access token. | Authenticated |
| POST | `/api/v1/auth/logout` | Revoke refresh token. | Authenticated |

### User Management (Admin only)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/users` | List all users |
| POST | `/api/v1/users` | Create user |
| PATCH | `/api/v1/users/{user_id}` | Update user (role, lock/unlock) |
| DELETE | `/api/v1/users/{user_id}` | Deactivate user |

### Documents

| Method | Path | Description | Roles |
|---|---|---|---|
| POST | `/api/v1/documents/upload` | Upload document (multipart). Returns `DocumentMetadata`. | Procurement_Officer, Admin |
| GET | `/api/v1/documents/{doc_id}` | Get document metadata | All |
| GET | `/api/v1/documents/{doc_id}/download` | Download original file | Procurement_Officer, Admin |

### Evaluation Sessions

| Method | Path | Description | Roles |
|---|---|---|---|
| POST | `/api/v1/sessions` | Create evaluation session; associate tender doc | Procurement_Officer, Admin |
| GET | `/api/v1/sessions` | List sessions (paginated) | All |
| GET | `/api/v1/sessions/{session_id}` | Get session detail + status | All |
| POST | `/api/v1/sessions/{session_id}/bidders` | Associate bidder submission(s) with session | Procurement_Officer, Admin |
| POST | `/api/v1/sessions/{session_id}/start` | Start processing pipeline | Procurement_Officer, Admin |
| GET | `/api/v1/sessions/{session_id}/status` | SSE stream: real-time pipeline status | Procurement_Officer, Admin |

### Evaluation Results

| Method | Path | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/sessions/{session_id}/criteria` | Get extracted eligibility criteria | All |
| PATCH | `/api/v1/sessions/{session_id}/criteria/{criterion_id}` | Confirm / correct criterion (HITL) | Procurement_Officer, Admin |
| GET | `/api/v1/sessions/{session_id}/evaluation` | Get compliance matrix | All |
| GET | `/api/v1/sessions/{session_id}/vprs` | Get VPRS scores + ranking | All |
| GET | `/api/v1/sessions/{session_id}/fraud-alerts` | Get fraud alerts | All |

### HITL Workflow

| Method | Path | Description | Roles |
|---|---|---|---|
| POST | `/api/v1/sessions/{session_id}/review/start` | Mark session as IN_REVIEW | Procurement_Officer, Admin |
| PATCH | `/api/v1/sessions/{session_id}/review/results/{result_id}` | Override individual criterion result with justification | Procurement_Officer, Admin |
| POST | `/api/v1/sessions/{session_id}/review/acknowledge-alerts` | Acknowledge HIGH fraud alerts | Procurement_Officer, Admin |
| POST | `/api/v1/sessions/{session_id}/review/approve` | Approve evaluation (enforces 30-min gate) | Procurement_Officer, Admin |
| POST | `/api/v1/sessions/{session_id}/review/reject` | Reject evaluation with reason | Procurement_Officer, Admin |

### Reports

| Method | Path | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/sessions/{session_id}/report/pdf` | Download PDF report (post-approval only) | All |
| GET | `/api/v1/sessions/{session_id}/report/json` | Get JSON report | All |

### Audit Logs

| Method | Path | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/audit` | Query audit log entries (paginated, filterable by date/actor/event) | Auditor, Admin |
| GET | `/api/v1/audit/verify` | Verify hash chain integrity for a date range | Auditor, Admin |

### System Configuration (Admin only)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/config/vprs-weights` | Get current VPRS weights |
| PUT | `/api/v1/config/vprs-weights` | Update VPRS weights (must sum to 100) |
| GET | `/api/v1/config/ollama` | Get Ollama config |
| PUT | `/api/v1/config/ollama` | Update Ollama endpoint / model |


---

## Async Task Queue Design

```mermaid
graph LR
    API[FastAPI] -->|enqueue| Redis[(Redis Queue)]
    Redis --> W1[document_ingest worker]
    Redis --> W2[ocr worker]
    Redis --> W3[nlp worker]
    Redis --> W4[evaluation worker]
    Redis --> W5[report worker]
    W1 -->|done: trigger| W2
    W2 -->|done: trigger| W3
    W3 -->|done: trigger| W4
    W4 -->|done: SSE update| API
    W5 -->|done: SSE update| API
```

**Celery Task Chains**

The pipeline uses Celery chained tasks:

```python
pipeline = chain(
    ingest_document.s(doc_id, session_id),
    ocr_extract.s(),
    nlp_extract.s(),
    evaluate_eligibility.s(),
    calculate_vprs.s(),
    detect_fraud.s(),
    notify_review_ready.s()
)
pipeline.delay()
```

**Task Configuration**

| Task | Queue | Max Retries | Retry Backoff |
|---|---|---|---|
| `ingest_document` | default | 3 | 5s, 25s, 125s |
| `ocr_extract` | ocr | 3 | 10s, 50s, 250s |
| `nlp_extract` | nlp | 3 | 15s, 75s, 375s |
| `evaluate_eligibility` | evaluation | 2 | 10s, 60s |
| `calculate_vprs` | evaluation | 2 | 10s, 60s |
| `detect_fraud` | evaluation | 2 | 10s, 60s |
| `generate_report` | report | 2 | 10s, 60s |

**Progress Updates**: Workers write status updates to Redis pub/sub. The FastAPI SSE endpoint (`/sessions/{id}/status`) subscribes to the channel and streams events to the browser every ≤ 5 seconds.

---

## Cryptographic Audit Log Chain Design

### Chain Construction

```
Genesis:
  chain_hash[0] = SHA-256("TENDERMIND_GENESIS")

Entry N:
  payload_bytes[N]  = UTF-8(canonical_json(event_payload[N]))
  payload_hash[N]   = SHA-256(payload_bytes[N])
  chain_hash[N]     = SHA-256(chain_hash[N-1] || payload_hash[N])
  -- where || is byte concatenation
```

### Integrity Verification Algorithm

```python
def verify_chain(entries: list[AuditLogEntry]) -> ChainVerificationResult:
    prev_hash = sha256("TENDERMIND_GENESIS")
    for entry in sorted(entries, key=lambda e: e.id):
        computed_payload_hash = sha256(canonical_json(entry.event_payload))
        if computed_payload_hash != entry.payload_hash:
            return ChainVerificationResult(valid=False, tampered_entry_id=entry.id,
                                           reason="payload_hash_mismatch")
        expected_chain_hash = sha256(prev_hash + computed_payload_hash)
        if expected_chain_hash != entry.chain_hash:
            return ChainVerificationResult(valid=False, tampered_entry_id=entry.id,
                                           reason="chain_hash_mismatch")
        prev_hash = entry.chain_hash
    return ChainVerificationResult(valid=True)
```

If verification fails, all Admin users receive an in-platform tamper alert notification.

### Retention Policy

Audit logs are stored in PostgreSQL partitioned by year. Partitions older than 7 years are archived to MinIO cold storage (not deleted). The `GET /api/v1/audit` endpoint queries both hot (PostgreSQL) and warm (MinIO) partitions transparently.


---

## Security Design

### Authentication Flow

```mermaid
sequenceDiagram
    participant UI as React UI
    participant API as FastAPI
    participant AS as Auth_Service
    participant DB as PostgreSQL
    participant Redis

    UI->>API: POST /auth/login {username, password, totp_code?}
    API->>AS: login(username, password, totp_code)
    AS->>DB: SELECT user WHERE username=?
    AS->>AS: bcrypt.verify(password, hash)
    AS->>AS: totp.verify(totp_code) [if MFA enabled]
    AS->>Redis: store refresh_token (TTL=7d)
    AS->>API: TokenPair {access_token, refresh_token}
    API->>UI: 200 {access_token, refresh_token}
    UI->>API: Subsequent requests: Authorization: Bearer <access_token>
    API->>AS: verify_token(access_token)
    AS->>AS: check_permission(claims, required_permission)
```

### RBAC Permission Matrix

| Permission | Admin | Procurement_Officer | Auditor |
|---|---|---|---|
| Upload documents | ✓ | ✓ | — |
| Create / start sessions | ✓ | ✓ | — |
| View evaluations | ✓ | ✓ | — |
| Perform HITL review | ✓ | ✓ | — |
| View audit logs | ✓ | — | ✓ |
| View finalized reports | ✓ | ✓ | ✓ |
| Manage users | ✓ | — | — |
| Configure system (VPRS, Ollama) | ✓ | — | — |
| Verify audit chain | ✓ | — | ✓ |

### Security Controls Summary

| Control | Implementation |
|---|---|
| Password hashing | bcrypt, cost 12 |
| JWT signing | HS256 (configurable RS256) |
| Access token TTL | 8 hours |
| Refresh token storage | Redis with TTL; revocable on logout |
| MFA | TOTP (RFC 6238) via `pyotp`; mandatory for Admin |
| Account lockout | 5 consecutive failures; Admin notified |
| Transport security | TLS 1.2+ enforced at load balancer / ingress |
| Document storage | MinIO with per-object server-side encryption (SSE-S3) |
| Database | TLS connection, env-managed credentials, never logged |
| LLM data isolation | Ollama is self-hosted; no external API calls |
| Audit log tamper detection | Cryptographic hash chain; Admin alert on failure |
| Input validation | Pydantic models on all API inputs |
| File upload safety | MIME validation + ClamAV virus scan (optional integration) |


---

## Deployment Design

### Docker Compose (Single-Node / Development)

```yaml
# docker-compose.yml (abbreviated)
services:
  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [api]

  api:
    build: ./backend
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    environment:
      - DATABASE_URL=postgresql://tm:${DB_PASS}@postgres:5432/tendermind
      - REDIS_URL=redis://redis:6379/0
      - MINIO_ENDPOINT=minio:9000
      - OLLAMA_BASE_URL=http://ollama:11434
      - JWT_SECRET=${JWT_SECRET}
    depends_on: [postgres, redis, minio, ollama]
    ports: ["8000:8000"]

  celery-worker:
    build: ./backend
    command: celery -A app.worker worker --concurrency=4 -Q default,ocr,nlp,evaluation,report
    environment: *api-env
    depends_on: [redis, postgres]

  ollama:
    image: ollama/ollama:latest
    volumes: [ollama_data:/root/.ollama]
    ports: ["11434:11434"]

  postgres:
    image: postgres:15
    environment: {POSTGRES_DB: tendermind, POSTGRES_USER: tm, POSTGRES_PASSWORD: "${DB_PASS}"}
    volumes: [pg_data:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes: [minio_data:/data]
    environment: {MINIO_ROOT_USER: minioadmin, MINIO_ROOT_PASSWORD: "${MINIO_PASS}"}
```

### Kubernetes (Multi-Node / Production)

```mermaid
graph TB
    Ingress[Nginx Ingress\nTLS Termination] --> FE[frontend Deployment\n2+ replicas]
    Ingress --> API[api Deployment\n3+ replicas\nHPA: CPU 70%]
    API --> PG[(PostgreSQL\nStatefulSet)]
    API --> RD[(Redis\nStatefulSet)]
    API --> MN[(MinIO\nStatefulSet)]
    API --> OL[Ollama\nStatefulSet\nGPU node pool]
    CW[celery-worker Deployment\n2+ replicas] --> RD
    CW --> PG
    CW --> MN
    CW --> OL
```

**Key Kubernetes Resources**

| Resource | Kind | Notes |
|---|---|---|
| `api` | Deployment + HPA | Scale on CPU 70%; min 2, max 10 replicas |
| `celery-worker` | Deployment | Separate Deployments per queue for independent scaling |
| `postgres` | StatefulSet | PVC with ReadWriteOnce; backup via pg_basebackup CronJob |
| `redis` | StatefulSet | PVC; Sentinel for HA in large deployments |
| `minio` | StatefulSet | PVC; distributed mode for HA |
| `ollama` | StatefulSet | Pin to GPU node pool via `nodeSelector`; model preloaded via initContainer |
| Secrets | Kubernetes Secrets | DB password, JWT secret, MinIO credentials |
| ConfigMaps | ConfigMap | Ollama model name, timeout, feature flags |


---

## Error Handling

### HTTP Error Response Format

All API errors follow a consistent JSON structure:

```json
{
  "error": {
    "code": "UNSUPPORTED_FILE_FORMAT",
    "message": "File type 'application/x-executable' is not supported. Accepted types: PDF, DOCX, JPEG, PNG, TIFF.",
    "detail": {},
    "request_id": "a3f7c2d1-..."
  }
}
```

### Error Code Catalogue

| Code | HTTP Status | Trigger |
|---|---|---|
| `UNSUPPORTED_FILE_FORMAT` | 422 | File MIME type not in allowed list |
| `FILE_TOO_LARGE` | 422 | File exceeds 50 MB |
| `DUPLICATE_DOCUMENT` | 409 | Document ID collision (should not occur with UUID v4) |
| `OCR_LOW_CONFIDENCE` | 200 + flag | Page confidence < 0.75 (non-fatal; flagged in result) |
| `NLP_LOW_CONFIDENCE` | 200 + flag | Criterion confidence < 0.80 |
| `OLLAMA_TIMEOUT` | 503 | LLM did not respond within timeout |
| `OLLAMA_UNAVAILABLE` | 503 | Connection refused to Ollama service |
| `REVIEW_PERIOD_NOT_ELAPSED` | 422 | Approve attempted before 30-minute gate |
| `HIGH_ALERT_NOT_ACKNOWLEDGED` | 422 | Approve attempted with unacknowledged HIGH alert |
| `PERMISSION_DENIED` | 403 | Action outside user's role |
| `ACCOUNT_LOCKED` | 423 | Account locked after 5 failed login attempts |
| `TOKEN_EXPIRED` | 401 | JWT past expiry |
| `AUDIT_CHAIN_TAMPERED` | 500 | Hash chain verification failure |
| `WEIGHTS_NOT_100` | 422 | VPRS weights do not sum to 100 |

### Ollama Retry Strategy

```python
@celery.task(bind=True, max_retries=3)
def nlp_extract(self, doc_id: str):
    try:
        result = nlp_processor.extract(doc_id)
    except OllamaTimeoutError as exc:
        raise self.retry(exc=exc, countdown=15 * (2 ** self.request.retries))
    except OllamaUnavailableError as exc:
        raise self.retry(exc=exc, countdown=30 * (2 ** self.request.retries))
```


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: Valid format files are accepted

*For any* file whose MIME type is one of `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/jpeg`, `image/png`, or `image/tiff`, the `validate_format` function SHALL accept the file without raising a `ValidationError`.

**Validates: Requirements 1.1, 1.2**

---

### Property 2: Invalid format files are rejected with a non-empty error message

*For any* file whose MIME type is not in the supported set, the `validate_format` function SHALL raise a `ValidationError` containing a non-empty, descriptive message that identifies the unsupported format.

**Validates: Requirements 1.3**

---

### Property 3: File size boundary is enforced correctly

*For any* integer file size `n`, `validate_size(n)` SHALL accept the file (no error) if and only if `n ≤ 52_428_800`. For any `n > 52_428_800`, it SHALL raise a `ValidationError` with a non-empty message.

**Validates: Requirements 1.4, 1.5**

---

### Property 4: All document IDs are globally unique

*For any* sequence of valid document uploads, all document identifiers returned by the `Document_Ingestion_Service` SHALL be distinct UUID values — no two uploads in the same session or across different sessions shall produce the same identifier.

**Validates: Requirements 1.6**

---

### Property 5: OCR confidence is always in range and flagging is correct

*For any* image or scanned page processed by the `OCR_Engine`, the returned confidence value SHALL be in the closed interval `[0.0, 1.0]`, and the page SHALL be flagged for manual review if and only if its confidence is strictly less than `0.75`.

**Validates: Requirements 2.1, 2.4, 2.5**

---

### Property 6: NLP low-confidence criteria are flagged

*For any* `EligibilityCriterion` produced by the `NLP_Processor`, `flagged_for_review` SHALL be `True` if and only if the criterion's `confidence` value is strictly less than `0.80`.

**Validates: Requirements 3.5**

---

### Property 7: Mandatory/optional classification is determined by keywords

*For any* criterion text that contains a definitive keyword (`MANDATORY`, `required`, `OPTIONAL`, `preference`), the `NLP_Processor` SHALL classify the criterion's `criterion_type` consistently with the keyword semantics. A criterion text containing `MANDATORY` or `required` SHALL yield `criterion_type = "mandatory"`. A criterion text containing `OPTIONAL` or `preference` (without a mandatory keyword) SHALL yield `criterion_type = "optional"`.

**Validates: Requirements 3.2**

---

### Property 8: Eligibility evaluation is total and produces valid verdicts

*For any* non-empty list of `EligibilityCriterion` objects and any `BidderProfile`, `Eligibility_Evaluator.evaluate()` SHALL produce exactly one `CriterionResult` for every criterion — no criterion may be skipped — and every result's `verdict` SHALL be one of `{PASS, FAIL, PARTIAL}` with a non-empty `evidence` string.

**Validates: Requirements 5.1, 5.2, 5.4**

---

### Property 9: Mandatory failure implies INELIGIBLE status and zero score

*For any* evaluation result set where at least one `CriterionResult` has `verdict = FAIL` for a mandatory criterion, the bidder's overall status SHALL be `INELIGIBLE`, their `eligibility_score` SHALL be `0`, and their `vprs_score` SHALL be `0`.

**Validates: Requirements 5.3, 5.5, 6.4**

---

### Property 10: Eligibility score is always in range [0, 100]

*For any* combination of criterion pass/fail results for an eligible bidder, the computed `eligibility_score` SHALL be a number in the closed interval `[0.0, 100.0]`.

**Validates: Requirements 5.5**

---

### Property 11: VPRS score is always in range [0, 100] and reflects weighted components

*For any* eligible `BidderProfile` and any `VPRSWeights` configuration where all weights sum to 100, the computed `vprs_score` SHALL be in `[0.0, 100.0]` and SHALL equal the weighted sum of the five component scores: `sum(component_score_i × weight_i / 100)`. The `explanation` field SHALL be non-empty.

**Validates: Requirements 6.1, 6.2, 6.3**

---

### Property 12: VPRS ranking is in descending order

*For any* list of `VPRSResult` objects, the `rank()` function SHALL produce a list ordered such that each bidder's rank reflects descending VPRS score — the bidder with the highest VPRS receives rank 1, and for any two bidders `i` and `j`, `rank[i] < rank[j]` implies `vprs_score[i] ≥ vprs_score[j]`.

**Validates: Requirements 6.5**

---

### Property 13: VPRS weight configuration requires weights summing to 100

*For any* proposed `VPRSWeights` configuration, the system SHALL accept the configuration if and only if `financial_weight + experience_weight + cert_weight + compliance_weight + historical_weight = 100`. Any configuration where the sum differs from 100 SHALL be rejected with a `WEIGHTS_NOT_100` error.

**Validates: Requirements 6.6**

---

### Property 14: GST format validation is correct for all inputs

*For any* string `s`, `Fraud_Detector.validate_gst(s)` SHALL return `True` if and only if `s` matches the 15-character Indian GST regex pattern `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`. Any string not matching this pattern SHALL be flagged as a format anomaly.

**Validates: Requirements 7.2**

---

### Property 15: Certification expiry flags are correct

*For any* `Certification` with a `valid_until` date and a given evaluation date `eval_date`:
- `is_expired` SHALL be `True` if and only if `valid_until < eval_date`
- `near_expiry` SHALL be `True` if and only if `0 ≤ (valid_until - eval_date).days ≤ 90`
- Both flags may be `True` simultaneously only if the cert is expired (which implies near_expiry is also True by the ≤ 90 day condition; expired certs SHALL have `is_expired = True` and `near_expiry` is not required to be set)

**Validates: Requirements 7.6**

---

### Property 16: Audit log entries contain all required fields

*For any* significant system event recorded by `Audit_Log_Service.record()`, the produced `AuditLogEntry` SHALL contain: a non-null `event_type`, a non-null `actor_id`, a timestamp in ISO 8601 UTC format, a non-empty 64-character hex `payload_hash` equal to `SHA-256(canonical_json(event_payload))`, and a non-empty 64-character hex `chain_hash`.

**Validates: Requirements 10.1, 10.2**

---

### Property 17: Audit log chain hash chain is always valid after sequential inserts

*For any* sequence of audit log entries produced by sequential calls to `Audit_Log_Service.record()`, a subsequent call to `verify_chain()` over the complete sequence SHALL return `ChainVerificationResult(valid=True)`. That is, inserting entries in order always produces a valid chain.

**Validates: Requirements 10.3, 10.4**

---

### Property 18: Modifying any audit log entry invalidates the chain

*For any* valid chain of `N` audit log entries, modifying the `event_payload` of entry `k` (where `1 ≤ k ≤ N`) SHALL cause `verify_chain()` to return `ChainVerificationResult(valid=False)` with `tampered_entry_id = k`. This demonstrates that tampering is always detectable.

**Validates: Requirements 10.3, 10.5**

---

### Property 19: Serialization round-trip produces equivalent objects

*For any* instance of `DocumentMetadata`, `EligibilityCriterion`, `BidderProfile`, or `VPRSResult`, serializing the object to JSON and then deserializing from that JSON SHALL produce an object that compares equal to the original (all fields with the same types and values).

**Validates: Requirements 14.3, 4.4, 8.5**

---

### Property 20: HITL 30-minute gate and HIGH alert gate are enforced for all sessions

*For any* evaluation session:
- If the current time is less than `evaluation_completed_at + 30 minutes`, a call to `approve()` SHALL be rejected with `REVIEW_PERIOD_NOT_ELAPSED`.
- If any `FraudAlert` in the session has `severity = HIGH` and `acknowledged_at` is null, a call to `approve()` SHALL be rejected with `HIGH_ALERT_NOT_ACKNOWLEDGED`.
- Both conditions are independent and both must be resolved before approval succeeds.

**Validates: Requirements 9.4, 9.6**

---

### Property 21: Password hashing round-trip is correct

*For any* non-empty password string `pw`:
- `bcrypt.verify(pw, bcrypt.hash(pw, cost=12))` SHALL return `True`
- *For any* different string `pw2 ≠ pw`, `bcrypt.verify(pw2, bcrypt.hash(pw, cost=12))` SHALL return `False`

**Validates: Requirements 11.2**


---

## Testing Strategy

### Dual Testing Approach

TenderMind AI uses two complementary testing layers: **property-based tests** for universal correctness guarantees and **unit/integration tests** for specific behaviors and infrastructure wiring.

### Property-Based Testing

**Library**: `hypothesis` (Python) — the de facto PBT library for Python, with `@given` decorator syntax.

**Configuration**: Each property test runs a minimum of 100 iterations (`settings(max_examples=100)`). All properties are tagged with a comment referencing the design property number.

```python
from hypothesis import given, settings
from hypothesis import strategies as st

# Feature: tendermind-ai, Property 3: File size boundary is enforced correctly
@given(file_size=st.integers(min_value=0, max_value=200_000_000))
@settings(max_examples=200)
def test_file_size_boundary(file_size):
    if file_size > 52_428_800:
        with pytest.raises(ValidationError):
            validate_size(file_size)
    else:
        validate_size(file_size)  # must not raise
```

**Properties to implement as property-based tests** (by Property number):

| Property | Test focus | Hypothesis Strategy |
|---|---|---|
| 1 | Valid MIME type accepted | `st.sampled_from(ALLOWED_MIME_TYPES)` |
| 2 | Invalid MIME type rejected | `st.text()` filtered to exclude allowed MIMEs |
| 3 | File size boundary | `st.integers(0, 200_000_000)` |
| 4 | Document ID uniqueness | `st.lists(valid_file_st(), min_size=2, max_size=20)` |
| 5 | OCR confidence range + flag | `st.floats(0.0, 1.0)` |
| 6 | NLP confidence flag | `st.floats(0.0, 1.0)` |
| 7 | Keyword classification | `st.text()` with injected keywords |
| 8 | Evaluation totality + verdict | `st.lists(criterion_st()), bidder_st()` |
| 9 | Mandatory fail → INELIGIBLE + VPRS=0 | `criterion_results_st(with_mandatory_fail=True)` |
| 10 | Eligibility score range | `st.lists(criterion_result_st())` |
| 11 | VPRS range + weighted sum | `bidder_profile_st(), vprs_weights_st()` |
| 12 | VPRS ranking descending | `st.lists(vprs_result_st(), min_size=1)` |
| 13 | VPRS weights sum constraint | `st.tuples(5 × st.floats(0, 100))` filtered |
| 14 | GST regex correctness | `st.text(alphabet=st.characters())` |
| 15 | Cert expiry flags | `st.dates(), st.dates()` |
| 16 | Audit entry field completeness | `audit_event_st()` |
| 17 | Chain valid after sequential insert | `st.lists(audit_event_st(), min_size=1)` |
| 18 | Chain invalid after modification | `st.lists(audit_event_st(), min_size=2)` + mutation |
| 19 | Serialization round-trip | `st.one_of(metadata_st(), criterion_st(), bidder_st(), vprs_st())` |
| 20 | HITL gates enforced | `session_st(), timedelta_st()` |
| 21 | bcrypt round-trip | `st.text(min_size=1)` |

### Unit Tests

Unit tests are focused on specific examples, integration points, and error conditions where PBT does not apply:

- **Document_Ingestion_Service**: Native PDF / DOCX text extraction (no OCR invoked), session-document association
- **OCR_Engine**: Scanned page detection, multi-page PDF handling, logical structure preservation
- **NLP_Processor**: Criterion extraction from known templates (English and Hindi), null field handling in bidder data
- **Eligibility_Evaluator**: Specific compliance matrix example (demo tender vs. 3 bidders), PARTIAL verdict edge cases
- **Fraud_Detector**: Near-duplicate detection threshold, financial cross-validation, implausible figure detection
- **Report_Generator**: PDF generation completeness (all required sections present), JSON structure validation
- **Auth_Service**: Account lockout after exactly 5 failures, MFA enforcement for Admin, token refresh flow
- **HITL_Workflow**: State machine transitions (PENDING_REVIEW → IN_REVIEW → APPROVED), modification justification requirement

### Integration Tests

Integration tests verify system behavior with real infrastructure (using test containers):

- End-to-end pipeline: upload tender + 3 bidder submissions → evaluate → approve → download report
- Ollama timeout and retry: mock Ollama service unavailable; verify 3-retry behavior and error surfacing
- Celery task chain: verify tasks execute in correct order and status events are emitted
- Audit log integrity: full session creates verifiable chain
- PostgreSQL: Alembic migration runs cleanly; DB constraints enforced (weights sum = 100)
- RBAC: Auditor cannot upload; Procurement_Officer cannot access admin config endpoints

### Testing Infrastructure

```
tests/
├── unit/
│   ├── test_document_ingestion.py
│   ├── test_ocr_engine.py
│   ├── test_nlp_processor.py
│   ├── test_eligibility_evaluator.py
│   ├── test_vprs_calculator.py
│   ├── test_fraud_detector.py
│   ├── test_report_generator.py
│   ├── test_audit_log_service.py
│   └── test_auth_service.py
├── property/
│   ├── test_properties_document.py       # Properties 1–4, 19
│   ├── test_properties_ocr.py            # Property 5
│   ├── test_properties_nlp.py            # Properties 6, 7
│   ├── test_properties_evaluation.py     # Properties 8–10
│   ├── test_properties_vprs.py           # Properties 11–13
│   ├── test_properties_fraud.py          # Properties 14, 15
│   ├── test_properties_audit.py          # Properties 16–18
│   ├── test_properties_hitl.py           # Property 20
│   └── test_properties_auth.py           # Property 21
└── integration/
    ├── test_e2e_pipeline.py
    ├── test_ollama_retry.py
    ├── test_celery_chain.py
    └── test_rbac.py
```


---

## Frontend Design (React SPA)

### Application Structure

```
frontend/src/
├── api/                    # React Query hooks for each API resource
│   ├── auth.ts
│   ├── sessions.ts
│   ├── documents.ts
│   ├── evaluation.ts
│   └── auditLog.ts
├── components/
│   ├── upload/             # DocumentUploadZone (drag-and-drop + file browser)
│   ├── session/            # SessionDashboard, SessionStatus, PipelineProgress
│   ├── evaluation/         # ComplianceMatrix, VPRSScoreCard, FraudAlertPanel
│   ├── hitl/               # HITLReviewPanel, CriterionOverride, ApprovalGate
│   ├── audit/              # AuditLogTable, ChainVerificationResult
│   └── common/             # Button, Modal, Badge, Spinner, Notification
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── SessionDetailPage.tsx
│   ├── HITLReviewPage.tsx
│   ├── ReportsPage.tsx
│   └── AuditPage.tsx
├── hooks/
│   ├── useSSE.ts           # Server-Sent Events subscription
│   └── useAuth.ts          # JWT management, role checks
└── store/
    └── authStore.ts        # Zustand: current user, token
```

### Real-Time Status Updates (SSE)

The `useSSE` hook subscribes to `GET /api/v1/sessions/{id}/status` (an SSE endpoint). Events include:

```typescript
type PipelineEvent =
  | { stage: 'INGESTION'; status: 'RUNNING' | 'DONE' | 'ERROR'; message: string }
  | { stage: 'OCR'; status: 'RUNNING' | 'DONE' | 'ERROR'; page?: number; confidence?: number }
  | { stage: 'NLP'; status: 'RUNNING' | 'DONE' | 'ERROR'; criteria_found?: number }
  | { stage: 'EVALUATION'; status: 'RUNNING' | 'DONE' | 'ERROR'; bidders_processed?: number }
  | { stage: 'VPRS'; status: 'RUNNING' | 'DONE' | 'ERROR' }
  | { stage: 'FRAUD'; status: 'RUNNING' | 'DONE' | 'ERROR'; alerts?: number }
  | { stage: 'READY_FOR_REVIEW'; status: 'PENDING_REVIEW' }
```

The progress indicator updates the frontend at least every 5 seconds (backend worker emits heartbeat events if no other event occurs within 5s).

### Accessibility

All interactive components comply with WCAG 2.1 Level AA:
- All form inputs have associated `<label>` elements
- Color is never the sole means of conveying information (status badges include text labels)
- Keyboard navigation fully supported; focus traps in modals
- ARIA roles and `aria-live` regions for dynamic status updates
- Minimum contrast ratio 4.5:1 for normal text, 3:1 for large text


---

## Design Decisions and Rationale

| Decision | Choice | Rationale |
|---|---|---|
| Task queue technology | Celery + Redis | Proven Python-native async task queue; Redis handles both message brokering and result backend; widely supported in Docker/K8s |
| OCR library | Tesseract 5 + pdfplumber | Tesseract is the industry-standard open-source OCR engine; pdfplumber gives accurate digital PDF text extraction without OCR overhead |
| PDF generation | WeasyPrint | Pure Python; supports CSS-based print layouts; no headless browser needed; produces standards-compliant PDF |
| Audit chain | SHA-256 linked in DB | Simple to verify, tamper-evident without requiring a blockchain; all data stays in PostgreSQL for easy querying and retention management |
| LLM inference | Ollama (self-hosted) | Government data cannot be sent to external APIs; Ollama provides a production-ready, model-agnostic local inference server |
| Object storage | MinIO | S3-compatible API allows future migration to AWS S3/GCS without code changes; runs identically on-prem |
| Frontend state | React Query + Zustand | React Query handles server state + caching; Zustand is lightweight for client state (auth); no Redux boilerplate needed |
| JWT algorithm | HS256 default, RS256 optional | HS256 is simpler for single-service deployments; RS256 is available for multi-service/microservice architectures where services need to verify tokens independently |
| HITL 30-minute gate | Enforced server-side | Cannot be bypassed by UI manipulation; prevents rubber-stamping of AI evaluations in high-stakes government procurement |
| VPRS weights in DB | Stored in `vprs_weights_config` table | Allows live reconfiguration by Admin without code changes or restarts; DB CHECK constraint guarantees weights always sum to 100 |
