import re
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.services.ics import build_ics

IST = timezone(timedelta(hours=5, minutes=30))
NOW = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)


def unfold(text: str) -> list[str]:
    """Undo RFC 5545 line folding, as a calendar app would."""
    return re.sub(r"\r\n[ \t]", "", text).split("\r\n")


def make(**kw):
    args = dict(uid="abc@airecruiter", starts_at=datetime(2026, 10, 1, 15, 30, tzinfo=IST), duration_minutes=45,
                summary="Interview: Backend Engineer", description="Video call", location="https://meet.example.com/x",
                attendee_email="asha@example.com", now=NOW)
    args.update(kw)
    return build_ics(**args)


def test_the_file_has_the_required_structure_and_crlf_line_endings():
    ics = make()
    assert ics.startswith("BEGIN:VCALENDAR\r\n") and ics.endswith("END:VCALENDAR\r\n")
    assert "\n" not in ics.replace("\r\n", "")  # every line break is CRLF
    lines = unfold(ics)
    for required in ["VERSION:2.0", "METHOD:REQUEST", "BEGIN:VEVENT", "END:VEVENT", "UID:abc@airecruiter", "STATUS:CONFIRMED"]:
        assert required in lines
    assert lines.count("BEGIN:VALARM") == lines.count("END:VALARM") == 1


def test_times_are_converted_to_utc_and_the_end_is_start_plus_duration():
    lines = unfold(make())
    assert "DTSTART:20261001T100000Z" in lines  # 15:30 IST is 10:00 UTC
    assert "DTEND:20261001T104500Z" in lines
    assert "DTSTAMP:20260921T120000Z" in lines


def test_text_is_escaped():
    lines = unfold(make(summary="Round 1; tech, deep\\dive", description="Line one\nLine two"))
    assert "SUMMARY:Round 1\\; tech\\, deep\\\\dive" in lines
    assert "DESCRIPTION:Line one\\nLine two" in lines


def test_long_lines_are_folded_at_75_octets_and_unfold_to_the_original():
    long_text = "Please bring your laptop and be ready to talk through a recent project in detail. " * 4
    ics = make(description=long_text)
    assert all(len(line.encode("utf-8")) <= 75 for line in ics.split("\r\n"))
    unfolded = next(l for l in unfold(ics) if l.startswith("DESCRIPTION:Please"))
    assert unfolded == "DESCRIPTION:" + long_text  # nothing lost or altered by folding


def test_folding_never_splits_a_multibyte_character():
    text = "Café ☕ नमस्ते " * 20
    ics = make(description=text)
    assert all(len(line.encode("utf-8")) <= 75 for line in ics.split("\r\n"))
    assert ics.encode("utf-8").decode("utf-8") == ics  # still valid UTF-8 everywhere
    assert text.strip().replace(",", "\\,") in "".join(unfold(ics))


def test_the_attendee_is_included_only_when_the_address_looks_valid():
    assert "ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:asha@example.com" in unfold(make())
    assert not any(l.startswith("ATTENDEE") for l in unfold(make(attendee_email="not an email\r\nEVIL:1")))
    assert not any(l.startswith("ATTENDEE") for l in unfold(make(attendee_email=None)))


def test_header_injection_through_text_fields_is_neutralised():
    lines = unfold(make(summary="Hi\r\nATTENDEE:mailto:evil@example.com", location="Room\nDESCRIPTION:pwned"))
    assert not any(l.startswith("ATTENDEE:mailto:evil") or l.startswith("DESCRIPTION:pwned") for l in lines)


def test_invalid_input_is_rejected():
    with pytest.raises(ValueError, match="timezone"):
        make(starts_at=datetime(2026, 10, 1, 15, 30))
    with pytest.raises(ValueError, match="duration"):
        make(duration_minutes=2)
    with pytest.raises(ValueError, match="duration"):
        make(duration_minutes=24 * 60)
