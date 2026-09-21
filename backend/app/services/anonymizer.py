"""Bias Shield: remove identity signals from a resume before an AI scores it.

The Matcher only ever sees the anonymised text, so name, gender cues, contact details,
location and school names cannot influence the score. Placeholders keep the text readable.
Graduation years and employer names are kept because they are job-relevant.
"""

import re
from typing import Protocol

CANDIDATE, EMAIL, PHONE, LOCATION, INSTITUTION = "[CANDIDATE]", "[EMAIL]", "[PHONE]", "[LOCATION]", "[INSTITUTION]"

_PERSONAL_LINE = re.compile(
    r"^[ \t]*(?:date of birth|d\.?o\.?b\.?|age|gender|sex|marital status|nationality|religion|caste|"
    r"father'?s name|mother'?s name|photo)[ \t]*[:\-–].*$",
    re.IGNORECASE | re.MULTILINE,
)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_INTL_PHONE = re.compile(r"\+\d[\d\s().-]{8,}\d")
_TITLES = re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Mx|Shri|Smt)\.?\s+", re.IGNORECASE)
_PRONOUNS = {
    "he": "they", "she": "they", "his": "their", "hers": "theirs", "her": "their",
    "him": "them", "himself": "themself", "herself": "themself",
}
_PRONOUN_RE = re.compile(r"\b(" + "|".join(_PRONOUNS) + r")\b", re.IGNORECASE)


class _Profile(Protocol):
    name: str
    location: str | None
    phone: str | None
    education: list


def _replace_phrase(text: str, phrase: str, placeholder: str) -> str:
    phrase = phrase.strip()
    if len(phrase) < 3:
        return text
    return re.sub(rf"(?<![\w]){re.escape(phrase)}(?![\w])", placeholder, text, flags=re.IGNORECASE)


def _keep_case(match: re.Match) -> str:
    word = match.group(0)
    replacement = _PRONOUNS[word.lower()]
    return replacement.capitalize() if word[0].isupper() else replacement


def anonymize_resume(text: str, profile: _Profile) -> str:
    """Return `text` with identity signals replaced by placeholders."""
    out = _PERSONAL_LINE.sub("", text)

    # Longest phrases first so "NIT Surathkal" is replaced before any shorter overlap.
    for edu in sorted(profile.education, key=lambda e: -len(e.institution or "")):
        if edu.institution:
            out = _replace_phrase(out, edu.institution, INSTITUTION)

    out = _EMAIL.sub(EMAIL, out)
    if profile.phone:
        out = out.replace(profile.phone, PHONE)
    out = _INTL_PHONE.sub(PHONE, out)

    if profile.location:
        out = _replace_phrase(out, profile.location, LOCATION)
        for part in profile.location.split(","):
            out = _replace_phrase(out, part, LOCATION)

    if profile.name.strip():
        out = _replace_phrase(out, profile.name, CANDIDATE)
        for token in profile.name.split():
            out = _replace_phrase(out, token, CANDIDATE)

    out = _TITLES.sub("", out)
    out = _PRONOUN_RE.sub(_keep_case, out)
    return re.sub(r"\n{3,}", "\n\n", out).strip()
