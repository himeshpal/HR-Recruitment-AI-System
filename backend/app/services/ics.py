"""Build an iCalendar (.ics) invitation that Outlook, Google Calendar and Apple Calendar all open.

Follows RFC 5545: CRLF line endings, text escaping, lines folded at 75 octets, times in UTC.
"""

import re
from datetime import UTC, datetime, timedelta

_EMAIL = re.compile(r"^[^@\s,;:<>\"]+@[^@\s,;:<>\"]+\.[^@\s,;:<>\"]+$")


def _escape(text: str) -> str:
    text = text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return text.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")


def _fold(line: str) -> list[str]:
    """Split a content line so that no physical line exceeds 75 octets. Never cuts a multi-byte character."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return [line]
    parts, current, size = [], "", 0
    limit = 75
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > limit:
            parts.append(current)
            current, size, limit = " ", 1, 75  # continuation lines start with one space, which counts
        current += char
        size += width
    parts.append(current)
    return parts


def _utc(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def build_ics(
    *, uid: str, starts_at: datetime, duration_minutes: int, summary: str, description: str = "",
    location: str = "", attendee_email: str | None = None, now: datetime | None = None,
) -> str:
    if starts_at.tzinfo is None:
        raise ValueError("starts_at must include a timezone")
    if not 5 <= duration_minutes <= 8 * 60:
        raise ValueError("duration must be between 5 minutes and 8 hours")
    stamp = now or datetime.now(UTC)
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI Recruiter//Interview Invite//EN", "CALSCALE:GREGORIAN",
        "METHOD:REQUEST", "BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{_utc(stamp)}", f"DTSTART:{_utc(starts_at)}",
        f"DTEND:{_utc(starts_at + timedelta(minutes=duration_minutes))}", f"SUMMARY:{_escape(summary)}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{_escape(description)}")
    if location:
        lines.append(f"LOCATION:{_escape(location)}")
    if attendee_email and _EMAIL.match(attendee_email):
        lines.append(f"ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:{attendee_email}")
    lines += ["STATUS:CONFIRMED", "SEQUENCE:0", "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY",
              "DESCRIPTION:Interview reminder", "END:VALARM", "END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(part for line in lines for part in _fold(line)) + "\r\n"
