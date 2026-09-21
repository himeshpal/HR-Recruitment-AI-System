"""Outreach agent: draft invitation, rejection and offer emails.

Two design rules keep this safe:
  * The model never sees the candidate's name, schedule, salary or links. It writes with placeholders and
    this module fills them in, so it cannot invent a time, a figure or a link.
  * Every draft is checked in code before it is shown: allowed placeholders only, required placeholders
    present, no numbers or links that were not provided, no protected-characteristic wording, sensible length.
"""

import re
from typing import Literal

from pydantic import BaseModel

from app.llm.client import LLMClient, LLMError
from app.llm.safety import UNTRUSTED_RULE, wrap_untrusted
from app.prompts import load_prompt

Kind = Literal["invite", "reject", "offer"]

_COMMON = {"first_name", "sender_name"}
ALLOWED_PLACEHOLDERS: dict[str, set[str]] = {
    "invite": _COMMON | {"interview_time", "duration", "mode", "location"},
    "reject": set(_COMMON),
    "offer": _COMMON | {"salary", "start_date", "reply_by"},
}
REQUIRED_PLACEHOLDERS: dict[str, set[str]] = {
    "invite": {"first_name", "interview_time", "location"},  # the candidate must be told where or how to join
    "reject": {"first_name"},
    "offer": {"first_name", "salary"},
}
# What a recruiter sees where a detail was not provided, so it is obvious it still needs filling in.
FALLBACKS = {
    "sender_name": "[your name]", "interview_time": "[interview time]", "duration": "[duration]",
    "mode": "[format]", "location": "[location or link]", "salary": "[salary]", "start_date": "[start date]",
    "reply_by": "[reply-by date]",
}
MAX_BODY_CHARS = 1800
MAX_SUBJECT_CHARS = 120

_PLACEHOLDER = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
_NUMBER = re.compile(r"\d[\d,.]*")
_URL = re.compile(r"https?://|www\.", re.IGNORECASE)
_PROTECTED = re.compile(
    r"\b(age|aged|old|young|gender|male|female|man|woman|married|marital|pregnan\w*|religio\w*|ethnic\w*|"
    r"nationalit\w*|disabilit\w*|health|caste|race|college|university)\b", re.IGNORECASE)


class EmailDraft(BaseModel):
    subject: str
    body: str


class OutreachError(LLMError):
    """The model could not produce an email that passes the checks."""


def check_email(kind: str, draft: EmailDraft, facts_text: str, exempt: tuple[str, ...] = ()) -> list[str]:
    """Everything wrong with a draft, in plain words. An empty list means it is fit to show.

    `exempt` names (the job title, the company) may contain words such as "AI" that are fine there."""
    issues: list[str] = []
    subject, body = draft.subject.strip(), draft.body.strip()
    if not subject or "\n" in subject:
        issues.append("The subject must be a single non-empty line.")
    if len(subject) > MAX_SUBJECT_CHARS:
        issues.append("The subject is too long.")
    if not body or len(body) > MAX_BODY_CHARS:
        issues.append(f"The body must be between 1 and {MAX_BODY_CHARS} characters.")

    used = {m.strip() for m in _PLACEHOLDER.findall(subject + "\n" + body)}
    unknown = used - ALLOWED_PLACEHOLDERS[kind]
    if unknown:
        issues.append("These placeholders are not allowed in this email: " + ", ".join(sorted(unknown)) + ".")
    missing = REQUIRED_PLACEHOLDERS[kind] - used
    if missing:
        issues.append("These placeholders are required but missing: " + ", ".join("{{" + m + "}}" for m in sorted(missing)) + ".")

    without = _PLACEHOLDER.sub("", subject + "\n" + body)
    for name in filter(None, exempt):
        without = re.sub(re.escape(name), " ", without, flags=re.IGNORECASE)
    stray = re.findall(r"\{\{|\}\}", without)
    if stray:
        issues.append("There is a malformed placeholder. Use exactly {{name}}.")
    invented = {n.strip(",.") for n in _NUMBER.findall(without)} - {n.strip(",.") for n in _NUMBER.findall(facts_text)}
    if invented:
        issues.append("Do not write numbers that were not given (found: " + ", ".join(sorted(invented)) + "). Use a placeholder.")
    if _URL.search(without):
        issues.append("Do not include links; use a placeholder.")
    if _PROTECTED.search(without):
        issues.append("The email mentions a topic that must never appear in hiring emails.")
    if re.search(r"\b(score|scored|ranking|ranked|algorithm|artificial intelligence|\bAI\b)\b", without, re.IGNORECASE):
        issues.append("Do not mention scores, rankings or AI.")
    return issues


def fill(text: str, values: dict[str, str]) -> str:
    """Replace placeholders that we have a value for, and mark the rest so they are easy to spot."""
    def swap(match: re.Match) -> str:
        key = match.group(1)
        if key == "first_name":
            return match.group(0)  # filled in at display time, so blind mode can hide it
        return values.get(key) or FALLBACKS.get(key, match.group(0))
    return _PLACEHOLDER.sub(swap, text)


def render(text: str, first_name: str) -> str:
    return _PLACEHOLDER.sub(lambda m: first_name if m.group(1) == "first_name" else m.group(0), text)


def unresolved_fields(*texts: str) -> list[str]:
    """Bracketed fallbacks still present, in order of first appearance."""
    found: list[str] = []
    for text in texts:
        for token in FALLBACKS.values():
            if token in text and token not in found:
                found.append(token)
    return found


def draft_email(
    *, kind: Kind, job_title: str, company: str, facts: list[str], feedback_points: list[str], llm: LLMClient,
) -> EmailDraft:
    """Ask for a draft and re-ask once, with the problems listed, if it fails the checks."""
    fact_lines = "\n".join(f"- {f}" for f in facts) or "- (none)"
    points = "\n".join(f"- {p}" for p in feedback_points) or "- (none)"
    user = (
        f"EMAIL TYPE: {kind}\nROLE: {job_title}\nCOMPANY: {company}\n\nKNOWN FACTS\n{fact_lines}\n\n"
        f"FEEDBACK POINTS\n{wrap_untrusted('notes', points)}"
    )
    system = "\n\n".join([load_prompt("outreach_common"), load_prompt(f"outreach_{kind}"), UNTRUSTED_RULE.format(tag="notes")])
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    allowed_numbers = "\n".join([job_title, company, *facts, *feedback_points])

    draft = llm.chat_json(messages, EmailDraft, agent=f"outreach_{kind}", tier="large", temperature=0.3, reasoning_effort="low")
    exempt = (job_title, company)
    issues = check_email(kind, draft, allowed_numbers, exempt)
    if issues:
        retry = [*messages, {"role": "assistant", "content": draft.model_dump_json()},
                 {"role": "user", "content": "That draft has problems:\n" + "\n".join(f"- {i}" for i in issues)
                  + "\nReturn a corrected JSON email that fixes every one of them."}]
        draft = llm.chat_json(retry, EmailDraft, agent=f"outreach_{kind}", tier="large", temperature=0.3, reasoning_effort="low")
        issues = check_email(kind, draft, allowed_numbers, exempt)
        if issues:
            raise OutreachError("The email could not be drafted safely: " + " ".join(issues))
    return draft
