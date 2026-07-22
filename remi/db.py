"""אחסון SQLite: היסטוריית שיחה, תזכורות ומשימות."""
import sqlite3
from datetime import datetime, timezone

import config


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                due_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL
            );
            """
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- היסטוריית שיחה ---

def add_history(chat_id: int, role: str, content: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO history (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (chat_id, role, content, _now()),
        )


def get_history(chat_id: int, limit: int = config.HISTORY_LIMIT) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT role, content FROM history WHERE chat_id = ? ORDER BY id DESC LIMIT ?",
            (chat_id, limit),
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]


def clear_history(chat_id: int) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM history WHERE chat_id = ?", (chat_id,))


# --- תזכורות ---

def add_reminder(chat_id: int, text: str, due_at_iso: str) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO reminders (chat_id, text, due_at, created_at) VALUES (?, ?, ?, ?)",
            (chat_id, text, due_at_iso, _now()),
        )
        return cur.lastrowid


def list_reminders(chat_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, text, due_at FROM reminders WHERE chat_id = ? AND status = 'pending' ORDER BY due_at",
            (chat_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def pending_reminders_all() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, chat_id, text, due_at FROM reminders WHERE status = 'pending'"
        ).fetchall()
    return [dict(r) for r in rows]


def mark_reminder(reminder_id: int, status: str) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE reminders SET status = ? WHERE id = ? AND status = 'pending'",
            (status, reminder_id),
        )
        return cur.rowcount > 0


# --- משימות ---

def add_task(chat_id: int, text: str) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO tasks (chat_id, text, created_at) VALUES (?, ?, ?)",
            (chat_id, text, _now()),
        )
        return cur.lastrowid


def list_tasks(chat_id: int, include_done: bool = False) -> list[dict]:
    query = "SELECT id, text, status FROM tasks WHERE chat_id = ?"
    if not include_done:
        query += " AND status = 'open'"
    query += " ORDER BY id"
    with _connect() as conn:
        rows = conn.execute(query, (chat_id,)).fetchall()
    return [dict(r) for r in rows]


def set_task_status(chat_id: int, task_id: int, status: str) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE tasks SET status = ? WHERE id = ? AND chat_id = ?",
            (status, task_id, chat_id),
        )
        return cur.rowcount > 0


def delete_task(chat_id: int, task_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM tasks WHERE id = ? AND chat_id = ?", (task_id, chat_id)
        )
        return cur.rowcount > 0
