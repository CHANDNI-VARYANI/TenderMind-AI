import sqlite3
import hashlib
import time

DB_PATH = "tendermind.db"

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS tenders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            raw_text TEXT,
            criteria_json TEXT,
            created_at REAL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS bidders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tender_id INTEGER,
            company_name TEXT,
            filename TEXT,
            raw_text TEXT,
            verdict TEXT,
            score INTEGER,
            evaluation_json TEXT,
            created_at REAL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT,
            entity_type TEXT,
            entity_id INTEGER,
            details TEXT,
            hash TEXT,
            prev_hash TEXT,
            timestamp REAL DEFAULT (unixepoch())
        );
    """)
    conn.commit()
    conn.close()

def log_action(action, entity_type, entity_id, details):
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1")
    row = c.fetchone()
    prev_hash = row["hash"] if row else "GENESIS"
    payload = f"{action}|{entity_type}|{entity_id}|{details}|{time.time()}|{prev_hash}"
    new_hash = hashlib.sha256(payload.encode()).hexdigest()
    c.execute(
        "INSERT INTO audit_log (action, entity_type, entity_id, details, hash, prev_hash) VALUES (?,?,?,?,?,?)",
        (action, entity_type, entity_id, details, new_hash, prev_hash)
    )
    conn.commit()
    conn.close()

init_db()
