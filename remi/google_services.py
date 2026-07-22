"""חיבור ל-Google Calendar ו-Gmail. דורש הרצה חד-פעמית של google_auth.py."""
import base64
from email.message import EmailMessage
from email.utils import parseaddr

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

import config


class GoogleNotConnected(Exception):
    pass


def _get_credentials() -> Credentials:
    if not config.GOOGLE_TOKEN_PATH.exists():
        raise GoogleNotConnected(
            "חשבון Google לא מחובר. יש להריץ פעם אחת: python google_auth.py"
        )
    creds = Credentials.from_authorized_user_file(
        str(config.GOOGLE_TOKEN_PATH), config.GOOGLE_SCOPES
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        config.GOOGLE_TOKEN_PATH.write_text(creds.to_json())
    return creds


def _calendar():
    return build("calendar", "v3", credentials=_get_credentials(), cache_discovery=False)


def _gmail():
    return build("gmail", "v1", credentials=_get_credentials(), cache_discovery=False)


# --- יומן ---

def list_events(start_iso: str, end_iso: str, max_results: int = 25) -> list[dict]:
    result = (
        _calendar()
        .events()
        .list(
            calendarId="primary",
            timeMin=start_iso,
            timeMax=end_iso,
            maxResults=max_results,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )
    events = []
    for ev in result.get("items", []):
        events.append(
            {
                "id": ev.get("id"),
                "title": ev.get("summary", "(ללא כותרת)"),
                "start": ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date"),
                "end": ev.get("end", {}).get("dateTime") or ev.get("end", {}).get("date"),
                "location": ev.get("location", ""),
                "description": (ev.get("description") or "")[:300],
            }
        )
    return events


def create_event(title: str, start_iso: str, end_iso: str, description: str = "", location: str = "") -> dict:
    body = {
        "summary": title,
        "start": {"dateTime": start_iso, "timeZone": config.TIMEZONE_NAME},
        "end": {"dateTime": end_iso, "timeZone": config.TIMEZONE_NAME},
    }
    if description:
        body["description"] = description
    if location:
        body["location"] = location
    ev = _calendar().events().insert(calendarId="primary", body=body).execute()
    return {"id": ev.get("id"), "link": ev.get("htmlLink", "")}


def delete_event(event_id: str) -> None:
    _calendar().events().delete(calendarId="primary", eventId=event_id).execute()


# --- מייל ---

def search_emails(query: str, max_results: int = 10) -> list[dict]:
    svc = _gmail()
    result = svc.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    messages = []
    for ref in result.get("messages", []):
        msg = (
            svc.users()
            .messages()
            .get(userId="me", id=ref["id"], format="metadata",
                 metadataHeaders=["From", "Subject", "Date"])
            .execute()
        )
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        messages.append(
            {
                "id": msg["id"],
                "from": headers.get("From", ""),
                "subject": headers.get("Subject", ""),
                "date": headers.get("Date", ""),
                "snippet": msg.get("snippet", ""),
            }
        )
    return messages


def _extract_body(payload: dict) -> str:
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    for part in payload.get("parts", []) or []:
        text = _extract_body(part)
        if text:
            return text
    return ""


def read_email(message_id: str) -> dict:
    msg = _gmail().users().messages().get(userId="me", id=message_id, format="full").execute()
    headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
    body = _extract_body(msg.get("payload", {})) or msg.get("snippet", "")
    return {
        "id": msg["id"],
        "from": headers.get("From", ""),
        "to": headers.get("To", ""),
        "subject": headers.get("Subject", ""),
        "date": headers.get("Date", ""),
        "body": body[:8000],
    }


def create_draft(to: str, subject: str, body: str) -> dict:
    _, addr = parseaddr(to)
    if "@" not in addr:
        raise ValueError(f"כתובת מייל לא תקינה: {to}")
    message = EmailMessage()
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    encoded = base64.urlsafe_b64encode(message.as_bytes()).decode()
    draft = (
        _gmail()
        .users()
        .drafts()
        .create(userId="me", body={"message": {"raw": encoded}})
        .execute()
    )
    return {"draft_id": draft.get("id")}
