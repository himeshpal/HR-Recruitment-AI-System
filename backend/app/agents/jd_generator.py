from collections.abc import Iterator

from pydantic import BaseModel, Field

from app.llm.client import LLMClient
from app.prompts import load_prompt


class JobRequirements(BaseModel):
    must_have_skills: list[str] = Field(default_factory=list)
    nice_to_have_skills: list[str] = Field(default_factory=list)
    min_years_experience: int = 0
    education: str | None = None
    responsibilities: list[str] = Field(default_factory=list)


def stream_jd(title: str, brief: str, llm: LLMClient) -> Iterator[str]:
    """Stream a Markdown job description written from a title and short brief."""
    messages = [
        {"role": "system", "content": load_prompt("jd_generator")},
        {"role": "user", "content": f"Job title: {title}\n\nBrief:\n{brief or '(none given)'}"},
    ]
    return llm.stream(messages, agent="jd_generator", tier="large", temperature=0.5,
                      reasoning_effort="low")


def extract_requirements(markdown: str, llm: LLMClient) -> JobRequirements:
    """Turn a (possibly edited) job description into the structured requirements the Matcher uses."""
    messages = [
        {"role": "system", "content": load_prompt("jd_requirements")},
        {"role": "user", "content": markdown},
    ]
    return llm.chat_json(messages, JobRequirements, agent="jd_requirements", tier="small",
                         reasoning_effort="low")
