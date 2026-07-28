 # TenderMind AI Backend

## Overview

The backend of TenderMind AI powers the core intelligence of the platform. It is responsible for processing tender documents, extracting eligibility criteria, evaluating vendor submissions, generating explainable reports, and maintaining secure records throughout the procurement workflow.

## Features

- Tender document processing
- AI-based criteria extraction
- Vendor eligibility evaluation
- Explainable AI recommendations
- Vendor Performance & Reliability Score (VPRS)
- Report generation
- Database management
- Secure audit logging
- Human-in-the-loop decision support

## Project Structure

```
backend/
│
├── main.py          # Application entry point
├── ai.py            # AI processing and reasoning
├── extract.py       # Tender criteria extraction
├── tender.py        # Tender processing
├── bidder.py        # Vendor evaluation
├── report.py        # Report generation
├── db.py            # Database operations
├── config.py        # Configuration settings
├── requirements.txt # Project dependencies
├── Dockerfile       # Docker configuration
└── README.md
```

## Workflow

1. Upload Tender Document
2. Extract Tender Criteria
3. Upload Vendor Documents
4. Verify Eligibility
5. Generate AI Recommendations
6. Officer Review
7. Generate Final Report

## Technology Stack

- Python
- FastAPI
- Ollama (Self-hosted AI)
- PostgreSQL
- OCR
- Docker

## Security

The backend is designed with a security-first approach. All AI recommendations are explainable, sensitive procurement data is intended to remain within a self-hosted environment, and the final decision always rests with the procurement officer.

## Future Enhancements

- GeM Integration
- Government API Verification
- Blockchain-based Audit Trail
- Advanced Fraud Detection
- Multi-language Support

## Installation

```bash
pip install -r requirements.txt
```

Run the application:

```bash
python main.py
```

## Team

**Team Teen Titans**  
Government Women Engineering College, Ajmer

**TenderMind AI**  
*Empowering Businesses. Supporting Officers. Building for Good.*
