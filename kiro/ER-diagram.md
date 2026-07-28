# TenderMind AI — Database ER Diagram

```mermaid
erDiagram

    %% ─────────────────────────────────────────────
    %% USERS & ACCESS CONTROL
    %% ─────────────────────────────────────────────

    ROLES {
        uuid        id              PK  "gen_random_uuid()"
        varchar(32) name            UK  "admin | procurement_officer | auditor"
        text        description
        timestamptz created_at          "DEFAULT now()"
    }

    PERMISSIONS {
        uuid        id              PK  "gen_random_uuid()"
        varchar(64) name            UK  "e.g. documents:upload"
        varchar(64) resource            "documents | sessions | audit | config"
        varchar(16) action              "read | write | delete | approve"
        text        description
    }

    ROLE_PERMISSIONS {
        uuid        role_id         PK  "FK → roles.id"
        uuid        permission_id   PK  "FK → permissions.id"
        timestamptz granted_at          "DEFAULT now()"
    }

    USERS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        role_id         FK  "FK → roles.id"
        varchar(64) username        UK  "NOT NULL"
        varchar(256) email          UK  "NOT NULL"
        varchar(256) password_hash      "bcrypt cost-12"
        varchar(64) mfa_secret          "TOTP secret; NULL if not enrolled"
        boolean     mfa_enabled         "DEFAULT FALSE"
        integer     failed_attempts     "DEFAULT 0"
        timestamptz locked_at           "NULL when unlocked"
        boolean     is_active           "DEFAULT TRUE"
        timestamptz created_at          "DEFAULT now()"
        timestamptz updated_at          "DEFAULT now()"
    }

    USER_SESSIONS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        user_id         FK  "FK → users.id"
        varchar(512) refresh_token  UK  "stored hash in Redis; reference here"
        varchar(45) ip_address
        varchar(256) user_agent
        timestamptz issued_at           "DEFAULT now()"
        timestamptz expires_at          "issued_at + 7 days"
        boolean     revoked             "DEFAULT FALSE"
        timestamptz revoked_at
    }

    %% ─────────────────────────────────────────────
    %% TENDER
    %% ─────────────────────────────────────────────

    TENDERS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        document_id     FK  "FK → documents.id"
        uuid        created_by      FK  "FK → users.id"
        varchar(256) title              "NOT NULL"
        varchar(128) reference_number  "Govt tender ref"
        varchar(128) department         "Issuing dept"
        text        description
        numeric(18-2) emd_amount        "Earnest Money Deposit INR"
        varchar(32) status              "draft|active|closed|cancelled"
        date        submission_deadline
        date        opening_date
        timestamptz created_at          "DEFAULT now()"
        timestamptz updated_at          "DEFAULT now()"
    }

    TENDER_CRITERIA {
        uuid        id              PK  "gen_random_uuid()"
        uuid        tender_id       FK  "FK → tenders.id"
        uuid        session_id      FK  "FK → evaluation_sessions.id"
        varchar(16) code                "e.g. C1, C2"
        text        description         "NOT NULL"
        varchar(16) criterion_type      "mandatory | optional"
        numeric(18-2) threshold_value   "NULL if non-numeric"
        varchar(64) threshold_unit      "INR Crore | years | count"
        varchar(16) comparison_op       "gte | lte | eq | contains"
        numeric(4-3) confidence         "NLP extraction confidence 0–1"
        boolean     flagged_for_review  "DEFAULT FALSE"
        uuid        confirmed_by    FK  "FK → users.id; NULL until confirmed"
        timestamptz confirmed_at
        timestamptz created_at          "DEFAULT now()"
    }

    %% ─────────────────────────────────────────────
    %% VENDOR (BIDDER)
    %% ─────────────────────────────────────────────

    VENDORS {
        uuid        id              PK  "gen_random_uuid()"
        varchar(512) company_name       "NOT NULL"
        varchar(15) gst_number          "15-char GST format"
        varchar(32) gst_status          "active | inactive | not_found"
        boolean     msme_registered     "DEFAULT FALSE"
        varchar(64) msme_number
        varchar(256) pan_number         "10-char PAN"
        varchar(512) registered_address
        varchar(128) industry_sector
        boolean     is_verified         "DEFAULT FALSE"
        timestamptz created_at          "DEFAULT now()"
        timestamptz updated_at          "DEFAULT now()"
    }

    VENDOR_ANNUAL_TURNOVERS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        vendor_id       FK  "FK → vendors.id"
        varchar(16) financial_year      "e.g. FY2024"
        numeric(18-2) amount_inr_crore  "NOT NULL; normalised to INR Crore"
    }

    VENDOR_CERTIFICATIONS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        vendor_id       FK  "FK → vendors.id"
        varchar(256) cert_type
        varchar(256) cert_number
        varchar(512) issuer
        date        valid_until
        boolean     is_expired          "computed on read"
        boolean     near_expiry         "within 90 days"
        boolean     issuer_unverifiable "DEFAULT FALSE"
    }

    VENDOR_CLIENT_REFERENCES {
        uuid        id              PK  "gen_random_uuid()"
        uuid        vendor_id       FK  "FK → vendors.id"
        varchar(512) client_name        "NOT NULL"
        varchar(256) project_name
        numeric(18-2) contract_value_inr_crore
        varchar(16) financial_year
        text        description
    }

    VENDOR_DOCUMENTS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        vendor_id       FK  "FK → vendors.id"
        uuid        document_id     FK  "FK → documents.id"
        varchar(32) doc_subtype         "ca_certificate | balance_sheet | cert | other"
        integer     financial_year_int  "for CA cert/balance sheet"
        text        notes
        timestamptz uploaded_at         "DEFAULT now()"
    }

    %% ─────────────────────────────────────────────
    %% DOCUMENTS
    %% ─────────────────────────────────────────────

    DOCUMENTS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        session_id      FK  "FK → evaluation_sessions.id; NULL for vendor docs"
        uuid        uploaded_by     FK  "FK → users.id"
        varchar(32) doc_type            "tender | bidder_submission | vendor_support"
        varchar(512) filename           "NOT NULL"
        bigint      file_size           "bytes; max 52_428_800"
        varchar(128) mime_type          "NOT NULL"
        varchar(1024) storage_key       "MinIO object key"
        varchar(64) bidder_name         "populated after NLP extraction"
        timestamptz uploaded_at         "DEFAULT now()"
    }

    OCR_RESULTS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        document_id     FK  "FK → documents.id"
        integer     page_number         "NOT NULL"
        text        extracted_text      "NOT NULL"
        numeric(4-3) confidence         "0.000–1.000"
        boolean     flagged             "DEFAULT FALSE; TRUE if confidence < 0.75"
        timestamptz created_at          "DEFAULT now()"
    }

    %% ─────────────────────────────────────────────
    %% EVALUATION SESSION
    %% ─────────────────────────────────────────────

    EVALUATION_SESSIONS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        tender_id       FK  "FK → tenders.id"
        uuid        tender_doc_id   FK  "FK → documents.id"
        uuid        created_by      FK  "FK → users.id"
        uuid        assigned_officer FK "FK → users.id"
        varchar(32) status              "created|processing|pending_review|in_review|awaiting_alert_ack|approved|rejected"
        timestamptz evaluation_completed_at
        timestamptz review_started_at
        timestamptz approved_at
        uuid        approved_by     FK  "FK → users.id; NULL until approved"
        text        rejection_reason
        timestamptz created_at          "DEFAULT now()"
        timestamptz updated_at          "DEFAULT now()"
    }

    BIDDER_PROFILES {
        uuid        id              PK  "gen_random_uuid()"
        uuid        session_id      FK  "FK → evaluation_sessions.id"
        uuid        document_id     FK  "FK → documents.id"
        uuid        vendor_id       FK  "FK → vendors.id; NULL if new vendor"
        varchar(512) company_name
        varchar(15) gst_number
        varchar(32) gst_status
        boolean     msme_registered
        varchar(64) msme_number
        numeric(5-1) years_experience
        varchar(32) eligibility_status "eligible | ineligible | pending"
        numeric(5-2) eligibility_score "0.00–100.00"
        jsonb       raw_json            "full NLP extraction"
        timestamptz created_at          "DEFAULT now()"
    }

    %% ─────────────────────────────────────────────
    %% ELIGIBILITY RESULTS
    %% ─────────────────────────────────────────────

    EVALUATION_RESULTS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        session_id      FK  "FK → evaluation_sessions.id"
        uuid        bidder_id       FK  "FK → bidder_profiles.id"
        uuid        criterion_id    FK  "FK → tender_criteria.id"
        varchar(16) ai_verdict          "PASS | FAIL | PARTIAL"
        text        ai_evidence         "quoted source text"
        numeric(4-3) ai_confidence      "0.000–1.000"
        varchar(16) officer_verdict     "NULL until HITL override"
        text        officer_justification "min 10 chars if set"
        uuid        modified_by     FK  "FK → users.id; NULL if no override"
        timestamptz modified_at
    }

    %% ─────────────────────────────────────────────
    %% VENDOR PERFORMANCE SCORE
    %% ─────────────────────────────────────────────

    VPRS_WEIGHTS_CONFIG {
        uuid        id              PK  "gen_random_uuid()"
        numeric(5-2) financial_weight   "DEFAULT 25; CHECK sum=100"
        numeric(5-2) experience_weight  "DEFAULT 25"
        numeric(5-2) cert_weight        "DEFAULT 20"
        numeric(5-2) compliance_weight  "DEFAULT 15"
        numeric(5-2) historical_weight  "DEFAULT 15"
        uuid        updated_by      FK  "FK → users.id"
        timestamptz updated_at          "DEFAULT now()"
    }

    VPRS_RESULTS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        session_id      FK  "FK → evaluation_sessions.id"
        uuid        bidder_id       FK  "FK → bidder_profiles.id"
        uuid        weights_config_id FK "FK → vprs_weights_config.id"
        numeric(5-2) vprs_score         "0.00–100.00"
        numeric(5-2) financial_score
        numeric(5-2) experience_score
        numeric(5-2) cert_score
        numeric(5-2) compliance_score
        numeric(5-2) historical_score
        integer     rank                "1 = highest VPRS"
        text        explanation         "component contribution narrative"
        jsonb       weights_snapshot    "weights at calculation time"
        timestamptz calculated_at       "DEFAULT now()"
    }

    FRAUD_ALERTS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        session_id      FK  "FK → evaluation_sessions.id"
        uuid        bidder_id       FK  "FK → bidder_profiles.id; NULL for session-level"
        varchar(16) severity            "LOW | MEDIUM | HIGH"
        varchar(64) alert_type          "duplicate | gst_invalid | financial_mismatch | cert_expired | implausible_financials"
        text        description         "NOT NULL"
        jsonb       evidence_fields     "specific fields involved"
        uuid        acknowledged_by FK  "FK → users.id; NULL until acknowledged"
        timestamptz acknowledged_at
        timestamptz created_at          "DEFAULT now()"
    }

    %% ─────────────────────────────────────────────
    %% REPORTS
    %% ─────────────────────────────────────────────

    REPORTS {
        uuid        id              PK  "gen_random_uuid()"
        uuid        session_id      FK  "FK → evaluation_sessions.id"
        uuid        generated_by    FK  "FK → users.id"
        uuid        approved_by     FK  "FK → users.id"
        varchar(32) report_type         "evaluation | summary | audit_export"
        varchar(32) status              "generating | ready | archived"
        varchar(1024) pdf_storage_key   "MinIO object key for PDF"
        varchar(1024) json_storage_key  "MinIO object key for JSON"
        varchar(64) pdf_sha256          "SHA-256 hex of PDF bytes"
        varchar(64) json_sha256         "SHA-256 hex of JSON bytes"
        bigint      pdf_size_bytes
        bigint      json_size_bytes
        varchar(512) top_bidder_name    "denormalised for quick access"
        numeric(5-2) top_bidder_vprs
        timestamptz generated_at        "DEFAULT now()"
        timestamptz archived_at
    }

    %% ─────────────────────────────────────────────
    %% AUDIT LOGS
    %% ─────────────────────────────────────────────

    AUDIT_LOG_ENTRIES {
        bigserial   id              PK  "auto-increment; sequential"
        varchar(64) event_type          "document_upload | ocr_complete | nlp_extraction | eligibility_eval | vprs_calc | fraud_alert | hitl_action | report_generated | user_auth | llm_invocation"
        uuid        actor_id        FK  "FK → users.id; NULL for system events"
        varchar(32) actor_role          "denormalised for query speed"
        uuid        session_id          "nullable reference"
        uuid[]      document_ids        "array of doc UUIDs involved"
        jsonb       event_payload       "NOT NULL; never contains raw LLM prompt"
        char(64)    payload_hash        "SHA-256 hex of event_payload JSON"
        char(64)    chain_hash          "SHA-256(prev_chain_hash || payload_hash)"
        integer     llm_input_tokens    "NULL unless event_type=llm_invocation"
        integer     llm_output_tokens   "NULL unless event_type=llm_invocation"
        varchar(128) llm_model_name     "NULL unless event_type=llm_invocation"
        timestamptz occurred_at         "DEFAULT now(); indexed"
    }

    %% ─────────────────────────────────────────────
    %% RELATIONSHIPS
    %% ─────────────────────────────────────────────

    %% Access Control
    ROLES           ||--o{ USERS                  : "has many"
    ROLES           ||--o{ ROLE_PERMISSIONS        : "has many"
    PERMISSIONS     ||--o{ ROLE_PERMISSIONS        : "granted via"
    USERS           ||--o{ USER_SESSIONS           : "opens many"

    %% Tender
    USERS           ||--o{ TENDERS                 : "created_by"
    DOCUMENTS       ||--o| TENDERS                 : "sourced from"
    TENDERS         ||--o{ TENDER_CRITERIA         : "defines many"
    EVALUATION_SESSIONS ||--o{ TENDER_CRITERIA     : "scoped to"
    USERS           |o--o{ TENDER_CRITERIA         : "confirmed_by"

    %% Vendor
    VENDORS         ||--o{ VENDOR_ANNUAL_TURNOVERS : "has many"
    VENDORS         ||--o{ VENDOR_CERTIFICATIONS   : "holds many"
    VENDORS         ||--o{ VENDOR_CLIENT_REFERENCES: "provides many"
    VENDORS         ||--o{ VENDOR_DOCUMENTS        : "submits many"
    DOCUMENTS       ||--o| VENDOR_DOCUMENTS        : "stored as"

    %% Documents
    USERS           ||--o{ DOCUMENTS               : "uploaded_by"
    EVALUATION_SESSIONS |o--o{ DOCUMENTS           : "contains"
    DOCUMENTS       ||--o{ OCR_RESULTS             : "produces many"

    %% Evaluation Session
    TENDERS         ||--o{ EVALUATION_SESSIONS     : "evaluated in"
    DOCUMENTS       ||--o| EVALUATION_SESSIONS     : "tender_doc"
    USERS           ||--o{ EVALUATION_SESSIONS     : "created_by"
    USERS           |o--o{ EVALUATION_SESSIONS     : "assigned_officer"
    USERS           |o--o{ EVALUATION_SESSIONS     : "approved_by"

    %% Bidder Profiles
    EVALUATION_SESSIONS ||--o{ BIDDER_PROFILES     : "contains many"
    DOCUMENTS       ||--o| BIDDER_PROFILES         : "sourced from"
    VENDORS         |o--o| BIDDER_PROFILES         : "linked to"

    %% Eligibility Results
    EVALUATION_SESSIONS ||--o{ EVALUATION_RESULTS  : "produces many"
    BIDDER_PROFILES ||--o{ EVALUATION_RESULTS      : "assessed in"
    TENDER_CRITERIA ||--o{ EVALUATION_RESULTS      : "evaluated against"
    USERS           |o--o{ EVALUATION_RESULTS      : "modified_by"

    %% VPRS
    EVALUATION_SESSIONS ||--o{ VPRS_RESULTS        : "produces many"
    BIDDER_PROFILES ||--o| VPRS_RESULTS            : "scored in"
    VPRS_WEIGHTS_CONFIG ||--o{ VPRS_RESULTS        : "applied in"
    USERS           |o--o| VPRS_WEIGHTS_CONFIG     : "updated_by"

    %% Fraud Alerts
    EVALUATION_SESSIONS ||--o{ FRAUD_ALERTS        : "raises many"
    BIDDER_PROFILES |o--o{ FRAUD_ALERTS            : "flagged in"
    USERS           |o--o{ FRAUD_ALERTS            : "acknowledged_by"

    %% Reports
    EVALUATION_SESSIONS ||--o{ REPORTS             : "finalises into"
    USERS           ||--o| REPORTS                 : "generated_by"
    USERS           |o--o| REPORTS                 : "approved_by"

    %% Audit Logs
    USERS           |o--o{ AUDIT_LOG_ENTRIES       : "actor"
```
