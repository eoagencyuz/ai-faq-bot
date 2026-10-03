"""SQLite: foydalanuvchilar, arizalar, statistika va operator yozishmalari."""
from __future__ import annotations

import os
import sqlite3
import threading
import time

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "bot.db"))

_lock = threading.Lock()
try:
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
except (OSError, sqlite3.Error):
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.db")
    _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_conn.executescript("""
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    first_name TEXT, last_name TEXT, username TEXT, lang TEXT,
    created_at INTEGER, last_seen INTEGER, blocked INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, name TEXT, phone TEXT, program TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
    user_id INTEGER, kind TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS relay (
    admin_msg_id INTEGER PRIMARY KEY, user_id INTEGER
);
CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, author TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS gaps (
    user_id INTEGER, question TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS events_time ON events(created_at);
""")
# Ro'yxatdan o'tish ustunlari (eski bazalarga ham qo'shiladi)
for _col in ("full_name TEXT", "phone TEXT", "registered_at INTEGER"):
    try:
        _conn.execute(f"ALTER TABLE users ADD COLUMN {_col}")
    except sqlite3.OperationalError:
        pass
_conn.commit()


def _exec(sql: str, args=()):
    with _lock:
        cur = _conn.execute(sql, args)
        _conn.commit()
        return cur


def _query(sql: str, args=()):
    with _lock:
        return _conn.execute(sql, args).fetchall()


def upsert_user(user: dict) -> bool:
    """Foydalanuvchini saqlaydi. Yangi bo'lsa True qaytaradi."""
    now = int(time.time())
    uid = user.get("id")
    if not uid:
        return False
    is_new = not _query("SELECT 1 FROM users WHERE id=?", (uid,))
    _exec("""INSERT INTO users (id, first_name, last_name, username, lang, created_at, last_seen, blocked)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)
             ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name, last_name=excluded.last_name,
                 username=excluded.username, lang=excluded.lang, last_seen=excluded.last_seen, blocked=0""",
          (uid, user.get("first_name"), user.get("last_name"), user.get("username"),
           user.get("language_code"), now, now))
    return is_new


def get_registration(user_id: int) -> tuple[str, str] | None:
    rows = _query("SELECT full_name, phone FROM users WHERE id=? AND phone IS NOT NULL", (user_id,))
    return (rows[0]["full_name"], rows[0]["phone"]) if rows else None


def set_registration(user_id: int, full_name: str, phone: str):
    _exec("UPDATE users SET full_name=?, phone=?, registered_at=? WHERE id=?",
          (full_name, phone, int(time.time()), user_id))


def registered_users():
    return _query("SELECT * FROM users WHERE phone IS NOT NULL ORDER BY registered_at")


def all_leads():
    return _query("SELECT * FROM leads ORDER BY id")


def set_blocked(user_id: int):
    _exec("UPDATE users SET blocked=1 WHERE id=?", (user_id,))


def active_user_ids() -> list[int]:
    return [r["id"] for r in _query("SELECT id FROM users WHERE blocked=0")]


def log_event(user_id: int, kind: str):
    _exec("INSERT INTO events (user_id, kind, created_at) VALUES (?, ?, ?)", (user_id, kind, int(time.time())))


def add_lead(user_id: int, name: str, phone: str, program: str) -> int:
    cur = _exec("INSERT INTO leads (user_id, name, phone, program, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, name, phone, program, int(time.time())))
    return cur.lastrowid


def recent_leads(limit: int = 10):
    return _query("SELECT * FROM leads ORDER BY id DESC LIMIT ?", (limit,))


def save_relay(admin_msg_id: int, user_id: int):
    _exec("INSERT OR REPLACE INTO relay (admin_msg_id, user_id) VALUES (?, ?)", (admin_msg_id, user_id))


def clear_relay():
    _exec("DELETE FROM relay")


def relay_user(admin_msg_id: int) -> int | None:
    rows = _query("SELECT user_id FROM relay WHERE admin_msg_id=?", (admin_msg_id,))
    return rows[0]["user_id"] if rows else None


def stats() -> dict:
    now = int(time.time())
    day, week = now - 86400, now - 7 * 86400

    def one(sql, args=()):
        return _query(sql, args)[0][0]

    return {
        "users": one("SELECT COUNT(*) FROM users"),
        "registered": one("SELECT COUNT(*) FROM users WHERE phone IS NOT NULL"),
        "reg_day": one("SELECT COUNT(*) FROM users WHERE registered_at>=?", (day,)),
        "blocked": one("SELECT COUNT(*) FROM users WHERE blocked=1"),
        "new_day": one("SELECT COUNT(*) FROM users WHERE created_at>=?", (day,)),
        "new_week": one("SELECT COUNT(*) FROM users WHERE created_at>=?", (week,)),
        "active_day": one("SELECT COUNT(DISTINCT user_id) FROM events WHERE created_at>=?", (day,)),
        "msgs_day": one("SELECT COUNT(*) FROM events WHERE created_at>=?", (day,)),
        "leads": one("SELECT COUNT(*) FROM leads"),
        "leads_day": one("SELECT COUNT(*) FROM leads WHERE created_at>=?", (day,)),
        "leads_week": one("SELECT COUNT(*) FROM leads WHERE created_at>=?", (week,)),
        "by_kind": {r["kind"]: r["n"] for r in _query(
            "SELECT kind, COUNT(*) n FROM events WHERE created_at>=? GROUP BY kind", (week,))},
    }


# --- Bilim bazasi (admin /addinfo orqali qo'shadi) ---
_knowledge_cache: list | None = None


def list_knowledge():
    global _knowledge_cache
    if _knowledge_cache is None:
        _knowledge_cache = _query("SELECT * FROM knowledge ORDER BY id")
    return _knowledge_cache


def add_knowledge(text: str, author: str) -> int:
    global _knowledge_cache
    cur = _exec("INSERT INTO knowledge (text, author, created_at) VALUES (?, ?, ?)", (text, author, int(time.time())))
    _knowledge_cache = None
    return cur.lastrowid


def delete_knowledge(kid: int) -> bool:
    global _knowledge_cache
    cur = _exec("DELETE FROM knowledge WHERE id=?", (kid,))
    _knowledge_cache = None
    return cur.rowcount > 0


# --- Bot javob topa olmagan savollar ---
def add_gap(user_id: int, question: str):
    _exec("INSERT INTO gaps (user_id, question, created_at) VALUES (?, ?, ?)", (user_id, question, int(time.time())))


def recent_gaps(limit: int = 20):
    since = int(time.time()) - 30 * 86400
    return _query("""SELECT question, COUNT(*) n, MAX(created_at) last FROM gaps WHERE created_at>=?
                     GROUP BY lower(question) ORDER BY n DESC, last DESC LIMIT ?""", (since, limit))


# --- Zaxira nusxa (Telegram'dagi pin qilingan faylda saqlanadi, Render bazani tozalasa ham) ---
def snapshot() -> dict:
    return {
        "v": 1,
        "created_at": int(time.time()),
        "knowledge": [dict(r) for r in _query("SELECT text, author, created_at FROM knowledge ORDER BY id")],
        "users": [dict(r) for r in _query(
            "SELECT id, first_name, last_name, username, full_name, phone, registered_at, created_at "
            "FROM users WHERE phone IS NOT NULL")],
        "leads": [dict(r) for r in _query(
            "SELECT user_id, name, phone, program, created_at FROM leads ORDER BY id DESC LIMIT 2000")][::-1],
    }


def restore(data: dict) -> dict:
    """Bo'sh jadvallarni zaxiradan to'ldiradi; mavjud ma'lumotlarni o'zgartirmaydi."""
    global _knowledge_cache
    counts = {"knowledge": 0, "users": 0, "leads": 0}
    with _lock:
        if not _conn.execute("SELECT 1 FROM knowledge LIMIT 1").fetchone():
            for k in data.get("knowledge", []):
                _conn.execute("INSERT INTO knowledge (text, author, created_at) VALUES (?, ?, ?)",
                              (k.get("text"), k.get("author"), k.get("created_at")))
                counts["knowledge"] += 1
        for u in data.get("users", []):
            if _conn.execute("SELECT 1 FROM users WHERE id=? AND phone IS NOT NULL", (u["id"],)).fetchone():
                continue
            _conn.execute("""INSERT INTO users (id, first_name, last_name, username, full_name, phone,
                                 registered_at, created_at, last_seen, blocked)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                             ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name, phone=excluded.phone,
                                 registered_at=excluded.registered_at""",
                          (u["id"], u.get("first_name"), u.get("last_name"), u.get("username"), u.get("full_name"),
                           u.get("phone"), u.get("registered_at"), u.get("created_at"), u.get("created_at")))
            counts["users"] += 1
        if not _conn.execute("SELECT 1 FROM leads LIMIT 1").fetchone():
            for ld in data.get("leads", []):
                _conn.execute("INSERT INTO leads (user_id, name, phone, program, created_at) VALUES (?, ?, ?, ?, ?)",
                              (ld.get("user_id"), ld.get("name"), ld.get("phone"), ld.get("program"),
                               ld.get("created_at")))
                counts["leads"] += 1
        _conn.commit()
    _knowledge_cache = None
    return counts
