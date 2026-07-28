from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routes import tender, bidder, report
import os

app = FastAPI(title="TenderMind AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tender.router, prefix="/api/tender")
app.include_router(bidder.router, prefix="/api/bidder")
app.include_router(report.router, prefix="/api/report")

@app.get("/health")
def health():
    return {"status": "TenderMind AI is running"}

if os.path.exists("static/dist"):
    app.mount("/", StaticFiles(directory="static/dist", html=True), name="static")
