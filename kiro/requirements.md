# Requirements Document

## Introduction

TenderMind AI is an AI-powered procurement intelligence platform designed for government procurement agencies. The platform enables procurement officers to upload tender documents and bidder submissions in PDF, scanned image, or DOCX formats, automatically extract and analyze their content using OCR and NLP, compare bidder submissions against tender eligibility criteria, calculate a Vendor Performance and Reliability Score (VPRS), detect potential fraud or anomalies, and generate explainable evaluation reports. The system uses a self-hosted large language model (Ollama), enforces Human-in-the-Loop approval workflows, maintains cryptographic audit logs for accountability, implements role-based access control, and is built on a modern React frontend with a FastAPI backend. The goal is a scalable, secure, and production-ready platform for government procurement organizations.

---

## Glossary

- **TenderMind_AI**: The overall procurement intelligence platform described in this document.
- **Document_Ingestion_Service**: The subsystem responsible for receiving, validating, and storing uploaded documents.
- **OCR_Engine**: The subsystem responsible for extracting text from scanned images and PDFs using Optical Character Recognition.
- **NLP_Processor**: The subsystem responsible for understanding, parsing, and structuring tender eligibility criteria and bidder data using Natural Language Processing and the self-hosted LLM.
- **Eligibility_Evaluator**: The subsystem that compares extracted bidder data against parsed tender eligibility criteria.
- **VPRS_Calculator**: The subsystem that computes the Vendor Performance and Reliability Score for each bidder.
- **Fraud_Detector**: The subsystem that detects anomalies, inconsistencies, and potential fraud indicators in bidder submissions.
- **Report_Generator**: The subsystem that produces explainable evaluation reports for procurement officers.
- **Audit_Log_Service**: The subsystem that records all system actions to a cryptographically verifiable, tamper-evident audit trail.
- **Auth_Service**: The subsystem responsible for user authentication and role-based access control.
- **HITL_Workflow**: Human-in-the-Loop approval workflow; the process by which procurement officers review and approve or override AI-generated evaluations before finalization.
- **Ollama_LLM**: The self-hosted large language model served via Ollama, used for NLP tasks.
- **Procurement_Officer**: A user role with privileges to upload documents, view evaluations, and trigger the HITL approval workflow.
- **Admin**: A user role with all Procurement_Officer privileges plus user management and system configuration access.
- **Auditor**: A read-only user role with access to audit logs and finalized evaluation reports.
- **Tender**: A government procurement request document defining requirements, eligibility criteria, quantities, and terms.
- **Bidder_Submission**: A document submitted by a vendor in response to a Tender.
- **VPRS**: Vendor Performance and Reliability Score — a composite numeric score (0–100) representing a vendor's reliability, compliance history, and evaluation results.
- **Eligibility_Criterion**: A specific rule or requirement extracted from a Tender that a bidder must satisfy (e.g., minimum annual turnover, mandatory certifications).
- **Explainability_Report**: A human-readable document that provides the reasoning, evidence, and confidence level behind each AI-generated evaluation decision.
- **Cryptographic_Audit_Log**: An append-only log where each entry is signed with a hash of the previous entry, forming a tamper-evident chain.
- **EMD**: Earnest Money Deposit — a mandatory security deposit submitted with a tender bid.

---

## Requirements

### Requirement 1: Document Upload and Validation

**User Story:** As a Procurement_Officer, I want to upload tender documents and bidder submissions in multiple formats, so that the system can process them regardless of the original document type.

#### Acceptance Criteria

1. THE Document_Ingestion_Service SHALL accept file uploads in PDF, DOCX, and scanned image formats (JPEG, PNG, TIFF).
2. WHEN a file is uploaded, THE Document_Ingestion_Service SHALL validate the file type against the list of supported formats before processing.
3. IF a file with an unsupported format is uploaded, THEN THE Document_Ingestion_Service SHALL reject the file and return a descriptive error message identifying the unsupported format.
4. WHEN a file is uploaded, THE Document_Ingestion_Service SHALL enforce a maximum file size of 50 MB per document.
5. IF a file exceeds the maximum size limit, THEN THE Document_Ingestion_Service SHALL reject the upload and return a descriptive error message stating the size limit.
6. WHEN a valid document is successfully uploaded, THE Document_Ingestion_Service SHALL assign a unique document identifier that does not duplicate any existing Tender document or Bidder_Submission document identifier, and SHALL store the document securely.
7. THE Document_Ingestion_Service SHALL allow a Procurement_Officer to associate one Tender document with one or more Bidder_Submission documents within a single evaluation session.

---

### Requirement 2: OCR Text Extraction

**User Story:** As a Procurement_Officer, I want the system to automatically extract text from scanned images and PDFs, so that document content is available for analysis without manual data entry.

#### Acceptance Criteria

1. WHEN a scanned image document is uploaded, THE OCR_Engine SHALL extract text from the image and produce a structured text representation.
2. WHEN a PDF containing scanned pages is uploaded, THE OCR_Engine SHALL detect scanned pages and apply OCR to extract text from those pages.
3. WHEN a native digital PDF or DOCX is uploaded, THE Document_Ingestion_Service SHALL extract text directly without invoking OCR.
4. WHEN OCR processing is complete, THE OCR_Engine SHALL return extracted text with a confidence score between 0.0 and 1.0 for each page.
5. WHEN OCR processing of an uploaded document is active and the confidence score for a page falls below 0.75, THE OCR_Engine SHALL flag that page for manual review and notify the Procurement_Officer.
6. THE OCR_Engine SHALL preserve the logical structure of the document, including headings, tables, and numbered lists, in the extracted text output.

---

### Requirement 3: NLP-Based Eligibility Criteria Extraction

**User Story:** As a Procurement_Officer, I want the system to automatically identify and parse eligibility criteria from tender documents, so that evaluations are based on the exact requirements stated in the tender.

#### Acceptance Criteria

1. WHEN a Tender document's text is available, THE NLP_Processor SHALL extract all Eligibility_Criterion entries including their type (mandatory or optional), threshold values, and applicable units.
2. WHEN eligibility criteria are extracted, THE NLP_Processor SHALL successfully classify each criterion as mandatory or optional based on explicit keywords (e.g., "MANDATORY", "required", "OPTIONAL", "preference"), and SHALL flag any criterion for which a definitive classification cannot be determined for manual review by the Procurement_Officer.
3. THE NLP_Processor SHALL extract numeric thresholds from criteria (e.g., "Minimum INR 5 Crore", "Minimum 3 years") and represent them as structured data with value, unit, and comparison operator.
4. WHEN extraction is complete, THE NLP_Processor SHALL present extracted criteria to the Procurement_Officer for review and confirmation before evaluation proceeds.
5. IF the NLP_Processor cannot confidently extract a criterion (confidence below 0.80), THEN THE NLP_Processor SHALL flag that criterion for manual entry by the Procurement_Officer.
6. THE NLP_Processor SHALL support extraction of criteria in English and Hindi languages within the same document.

---

### Requirement 4: Bidder Data Extraction and Structuring

**User Story:** As a Procurement_Officer, I want the system to extract and structure key vendor information from bidder submissions, so that bidder data can be systematically compared against tender requirements.

#### Acceptance Criteria

1. WHEN a Bidder_Submission document's text is available, THE NLP_Processor SHALL extract structured vendor fields including company name, GST registration number and status, annual turnover per financial year, years of relevant experience, client references, certifications (type, number, validity date), and MSME registration status.
2. WHEN a field is not found in the Bidder_Submission, THE NLP_Processor SHALL record the field as absent and assign it a null value in the structured output.
3. THE NLP_Processor SHALL normalize monetary values to a common unit (INR Crore) with two decimal places for comparison purposes.
4. WHEN bidder data extraction is complete, THE NLP_Processor SHALL produce a structured JSON representation of each bidder's data.
5. THE NLP_Processor SHALL use the Ollama_LLM for contextual understanding of ambiguous or non-standard field expressions in bidder documents.

---

### Requirement 5: Eligibility Evaluation and Compliance Checking

**User Story:** As a Procurement_Officer, I want the system to automatically compare each bidder's submission against all tender eligibility criteria, so that I receive an objective compliance assessment for every bidder.

#### Acceptance Criteria

1. WHEN bidder data and extracted eligibility criteria are available, THE Eligibility_Evaluator SHALL compare each bidder's structured data against every mandatory and optional Eligibility_Criterion.
2. FOR EACH Eligibility_Criterion evaluated, THE Eligibility_Evaluator SHALL produce a result of PASS, FAIL, or PARTIAL with a textual explanation citing the specific evidence from the bidder's document.
3. IF a bidder fails any single mandatory Eligibility_Criterion, THEN THE Eligibility_Evaluator SHALL mark the bidder as INELIGIBLE and the mandatory failure shall be prominently indicated in the evaluation output.
4. THE Eligibility_Evaluator SHALL produce a per-criterion compliance matrix for all bidders, showing each bidder's result for each criterion in a single comparable view.
5. WHEN evaluation is complete, THE Eligibility_Evaluator SHALL calculate an overall eligibility score (0–100) for each eligible bidder based on mandatory pass rate and optional criterion satisfaction, where mandatory criteria carry higher weight.
6. THE Eligibility_Evaluator SHALL complete evaluation of up to 20 bidders against up to 30 eligibility criteria within 120 seconds on standard hardware.

---

### Requirement 6: Vendor Performance and Reliability Score (VPRS)

**User Story:** As a Procurement_Officer, I want a composite reliability score for each vendor, so that I can objectively compare bidders beyond basic eligibility compliance.

#### Acceptance Criteria

1. THE VPRS_Calculator SHALL compute a VPRS on a scale of 0 to 100 for each bidder who passes all mandatory eligibility criteria.
2. THE VPRS_Calculator SHALL calculate the VPRS using the following weighted components: financial stability (annual turnover trend, 25%), relevant experience (years and client credibility, 25%), certification validity and scope (20%), compliance completeness (optional criteria met, 15%), and historical performance data if available (15%).
3. WHEN a VPRS is calculated, THE VPRS_Calculator SHALL produce an explanation detailing the contribution of each weighted component to the final score.
4. THE VPRS_Calculator SHALL assign a VPRS of 0 to any bidder who fails one or more mandatory eligibility criteria, without performing component calculation.
5. WHEN VPRS values are available for all eligible bidders, THE VPRS_Calculator SHALL produce a ranked list of bidders ordered by VPRS in descending order.
6. THE VPRS_Calculator SHALL support administrative configuration of component weights within the constraint that all weights sum to 100.

---

### Requirement 7: Fraud and Anomaly Detection

**User Story:** As a Procurement_Officer, I want the system to automatically detect suspicious patterns and inconsistencies in bidder submissions, so that I am alerted to potential fraud before making procurement decisions.

#### Acceptance Criteria

1. WHEN bidder submissions are processed, THE Fraud_Detector SHALL check for duplicate or near-duplicate document content across multiple bidder submissions within the same evaluation session.
2. WHEN bidder submissions are processed, THE Fraud_Detector SHALL verify that declared GST registration numbers follow the valid 15-character Indian GST format.
3. WHEN financial figures are present in a bidder submission, THE Fraud_Detector SHALL cross-validate declared annual turnover values against any corroborating documents (CA certificates, balance sheets) present in the same submission.
4. IF the Fraud_Detector identifies an anomaly or inconsistency, or if a Procurement_Officer manually escalates a concern, THEN THE Fraud_Detector SHALL generate a fraud alert with a severity level (LOW, MEDIUM, HIGH), a description of the anomaly, and the specific fields or evidence involved.
5. WHEN a HIGH severity fraud alert is generated, THE Fraud_Detector SHALL require mandatory HITL review before the affected bidder's evaluation can be finalized.
6. THE Fraud_Detector SHALL flag certifications that are expired, near expiry (within 90 days), or have unverifiable issuer details.
7. THE Fraud_Detector SHALL detect implausible financial figures, such as a declared turnover significantly exceeding industry benchmarks for the vendor's stated scale.

---

### Requirement 8: Explainable AI Evaluation Report Generation

**User Story:** As a Procurement_Officer, I want a detailed, human-readable evaluation report for each tender session, so that procurement decisions are transparent, auditable, and defensible.

#### Acceptance Criteria

1. WHEN an evaluation session is finalized, THE Report_Generator SHALL produce an Explainability_Report in PDF format for the evaluation session.
2. THE Report_Generator SHALL include in every Explainability_Report: a summary table of all bidders with their VPRS and eligibility status, per-bidder compliance detail for every eligibility criterion with supporting evidence quoted from source documents, VPRS component breakdown for each eligible bidder, a list of all fraud alerts with severity and description, and the AI model's confidence level for each evaluation decision.
3. THE Report_Generator SHALL include the name and role of the Procurement_Officer who approved the report via the HITL_Workflow.
4. THE Report_Generator SHALL highlight the top-ranked bidder and provide a human-readable justification for the ranking.
5. THE Report_Generator SHALL produce a machine-readable JSON version of the evaluation results alongside the PDF report.
6. WHEN a report is generated, THE Audit_Log_Service SHALL record the report generation event including the user, timestamp, session identifier, and a SHA-256 hash of the report content.

---

### Requirement 9: Human-in-the-Loop (HITL) Approval Workflow

**User Story:** As a Procurement_Officer, I want to review and approve or override AI-generated evaluations before they are finalized, so that human judgment remains the authoritative decision in government procurement.

#### Acceptance Criteria

1. WHEN an AI evaluation is complete, THE HITL_Workflow SHALL present the evaluation results to the assigned Procurement_Officer for review before any report is finalized or shared.
2. WHEN reviewing an evaluation, THE Procurement_Officer SHALL be able to approve, reject, or modify any individual criterion result, VPRS component score, or fraud alert classification.
3. WHEN a Procurement_Officer modifies an AI-generated result, THE HITL_Workflow SHALL require the officer to provide a written justification for the modification.
4. IF a HIGH severity fraud alert is present, THEN THE HITL_Workflow SHALL prevent finalization of the evaluation until the Procurement_Officer explicitly acknowledges and acts on the alert, and THE HITL_Workflow SHALL still enforce the 30-minute minimum review period after such acknowledgment.
5. WHEN an evaluation is approved via HITL_Workflow, THE Audit_Log_Service SHALL record the approval event with the approving user's identity, timestamp, and a summary of any modifications made.
6. THE HITL_Workflow SHALL enforce a minimum review period of 30 minutes between evaluation completion and finalization to prevent uninformed approvals.
7. THE HITL_Workflow SHALL notify the assigned Procurement_Officer via an in-platform notification when an evaluation is ready for review.

---

### Requirement 10: Cryptographic Audit Logging

**User Story:** As an Auditor, I want every significant system action to be recorded in a tamper-evident audit log, so that procurement decisions can be independently verified and accountability is maintained.

#### Acceptance Criteria

1. THE Audit_Log_Service SHALL record an audit log entry for every significant event including: document uploads, OCR completions, NLP extractions, eligibility evaluations, VPRS calculations, fraud alerts, HITL review actions, report generations, and user authentication events.
2. EACH audit log entry SHALL contain: event type, actor identity (user ID and role), timestamp in ISO 8601 UTC format, session identifier, relevant document identifiers, and a SHA-256 hash of the event payload.
3. THE Audit_Log_Service SHALL form a Cryptographic_Audit_Log by chaining each entry's hash to the hash of the previous entry, so that deletion or modification of any entry invalidates all subsequent entries.
4. THE Audit_Log_Service SHALL expose a log integrity verification endpoint that allows an Auditor to verify the hash chain for any date range.
5. IF the hash chain verification fails for any entry, THEN THE Audit_Log_Service SHALL generate a tamper alert and notify all Admin users.
6. THE Audit_Log_Service SHALL retain audit logs for a minimum of 7 years in compliance with government procurement record-keeping requirements.
7. THE Audit_Log_Service SHALL allow read-only access to audit logs by users with the Auditor role and full access by users with the Admin role.

---

### Requirement 11: Role-Based Access Control and Authentication

**User Story:** As an Admin, I want fine-grained role-based access control and secure authentication, so that only authorized personnel can access procurement data and system functions.

#### Acceptance Criteria

1. THE Auth_Service SHALL support three user roles: Admin, Procurement_Officer, and Auditor, each with distinct permission sets.
2. THE Auth_Service SHALL authenticate users via username and password with passwords hashed using bcrypt with a minimum cost factor of 12.
3. THE Auth_Service SHALL issue JSON Web Tokens (JWT) with a maximum validity period of 8 hours upon successful authentication.
4. WHEN a JWT expires, THE Auth_Service SHALL require re-authentication before granting further access.
5. THE Auth_Service SHALL enforce role-based permissions: Procurement_Officers can upload documents, initiate evaluations, and perform HITL reviews; Auditors can read audit logs and finalized reports only; Admins can perform all actions plus user management and system configuration.
6. IF a user attempts an action outside their role's permissions, THEN THE Auth_Service SHALL deny the request and return an HTTP 403 response.
7. THE Auth_Service SHALL lock a user account after 5 consecutive failed authentication attempts and notify the Admin.
8. THE Auth_Service SHALL support multi-factor authentication (MFA) as an optional configuration for all user roles, enforced as mandatory for the Admin role.

---

### Requirement 12: Self-Hosted LLM Integration (Ollama)

**User Story:** As an Admin, I want all AI inference to run on a self-hosted LLM, so that sensitive government procurement data is never transmitted to external third-party AI services.

#### Acceptance Criteria

1. THE NLP_Processor SHALL perform all LLM inference requests exclusively against the locally running Ollama_LLM service and SHALL NOT transmit document content or extracted data to any external API endpoint.
2. THE NLP_Processor SHALL use the Ollama REST API for model invocation with a configurable endpoint URL and model name managed via system configuration.
3. WHEN the Ollama_LLM service is unavailable or unresponsive, THE NLP_Processor SHALL treat the condition as a timeout, return a descriptive timeout error to the caller, and queue the pending task for retry, without failing silently.
4. THE NLP_Processor SHALL support configurable model selection, allowing an Admin to switch between available Ollama models without code changes.
5. THE NLP_Processor SHALL impose a configurable inference timeout and return a timeout error if the Ollama_LLM does not respond within the specified period.
6. THE Audit_Log_Service SHALL log each LLM invocation including the model name, input token count, and output token count, without logging raw prompt content containing sensitive document data.

---

### Requirement 13: Modern Web Interface (React + FastAPI)

**User Story:** As a Procurement_Officer, I want a modern, intuitive web interface, so that I can manage tenders, view evaluations, and interact with AI-generated reports efficiently.

#### Acceptance Criteria

1. THE TenderMind_AI frontend SHALL be implemented as a single-page application using React and SHALL communicate with the backend exclusively through the FastAPI REST API.
2. THE TenderMind_AI frontend SHALL provide a document upload interface supporting drag-and-drop and file browser selection for Tender and Bidder_Submission documents.
3. THE TenderMind_AI frontend SHALL display real-time processing status updates for document ingestion, OCR, NLP extraction, and evaluation tasks using server-sent events or WebSocket communication.
4. THE TenderMind_AI frontend SHALL render the per-bidder evaluation compliance matrix, VPRS scores, and fraud alerts in a structured, sortable dashboard view.
5. THE TenderMind_AI frontend SHALL provide the HITL review interface allowing a Procurement_Officer to view AI reasoning, modify results, enter justifications, and submit approvals.
6. THE TenderMind_AI frontend SHALL be accessible in compliance with WCAG 2.1 Level AA standards.
7. THE FastAPI backend SHALL expose all platform capabilities via versioned REST API endpoints (prefix `/api/v1/`) with OpenAPI documentation auto-generated and available at `/api/v1/docs`.

---

### Requirement 14: Document Parsing and Round-Trip Integrity

**User Story:** As a system engineer, I want document extraction to be verifiable and reversible, so that the integrity of text extraction from source documents can be validated.

#### Acceptance Criteria

1. WHEN a document is parsed, THE Document_Ingestion_Service SHALL produce a structured document object containing page-level text, metadata (filename, upload timestamp, document type), and extraction confidence scores.
2. THE Report_Generator SHALL format structured evaluation data back into valid human-readable documents (PDF and JSON).
3. FOR ALL structured evaluation data objects, serializing to JSON then deserializing SHALL produce an equivalent object (round-trip property).
4. THE Document_Ingestion_Service SHALL parse document metadata including file name, file size, MIME type, and upload timestamp into a structured DocumentMetadata object.
5. THE Document_Ingestion_Service SHALL preserve original document binary content in secure storage, enabling re-processing if the extraction pipeline is updated.

---

### Requirement 15: System Scalability and Performance

**User Story:** As an Admin, I want the platform to handle concurrent evaluation sessions and large document volumes, so that the platform remains responsive under government-scale workloads.

#### Acceptance Criteria

1. THE TenderMind_AI platform SHALL support at least 10 concurrent active evaluation sessions without degradation of response time beyond 20% of single-session baseline.
2. WHILE the system configuration has `async_processing_enabled = true`, WHEN multiple document processing tasks are queued, THE Document_Ingestion_Service SHALL process them using an asynchronous task queue, enabling non-blocking operation.
3. THE FastAPI backend SHALL return API responses for non-AI operations (document listing, report retrieval, audit log queries) within 500 milliseconds under normal load.
4. THE TenderMind_AI platform SHALL be deployable via Docker Compose for single-node deployment and SHALL provide configuration for Kubernetes deployment for multi-node scalability.
5. WHILE the system is processing an evaluation, THE TenderMind_AI frontend SHALL display a progress indicator updated at least every 5 seconds.
