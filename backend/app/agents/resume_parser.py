import re

from pydantic import BaseModel, Field

from app.llm.client import LLMClient
from app.llm.safety import UNTRUSTED_RULE, wrap_untrusted
from app.prompts import load_prompt
from app.services.experience import total_experience_years

MAX_RESUME_CHARS = 12_000
MAX_SKILLS = 40
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


class Experience(BaseModel):
    title: str
    company: str | None = None
    start: str | None = None
    end: str | None = None
    highlights: list[str] = Field(default_factory=list)


class Education(BaseModel):
    degree: str
    institution: str | None = None
    year: str | None = None


class ProfileExtraction(BaseModel):
    """What the LLM is asked to produce."""

    name: str
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    headline: str | None = None
    skills: list[str] = Field(default_factory=list)
    experience: list[Experience] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)


class ParsedProfile(ProfileExtraction):
    """The extraction plus values we compute or verify in code."""

    total_years_experience: float = 0.0


def _dedupe_skills(skills: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for skill in skills:
        cleaned = skill.strip()
        if cleaned and cleaned.lower() not in seen:
            seen.add(cleaned.lower())
            result.append(cleaned)
    return result[:MAX_SKILLS]


def parse_resume(resume_text: str, llm: LLMClient) -> ParsedProfile:
    text = resume_text[:MAX_RESUME_CHARS]
    messages = [
        {"role": "system",
         "content": load_prompt("resume_parser") + "\n\n" + UNTRUSTED_RULE.format(tag="resume")},
        {"role": "user", "content": wrap_untrusted("resume", text)},
    ]
    extracted = llm.chat_json(messages, ProfileExtraction, agent="resume_parser", tier="small",
                              reasoning_effort="low")

    data = extracted.model_dump()
    data["skills"] = _dedupe_skills(extracted.skills)

    # Never trust a model-supplied email that is not actually in the document.
    found = _EMAIL_RE.search(text)
    if not data["email"] or data["email"].lower() not in text.lower():
        data["email"] = found.group(0) if found else None

    data["name"] = extracted.name.strip() or "Unknown candidate"
    data["total_years_experience"] = total_experience_years(extracted.experience)
    return ParsedProfile(**data)
