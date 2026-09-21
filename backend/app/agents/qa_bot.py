"""Candidate Q&A: answer questions about a job, only from the job description and the company info.

Three layers keep the bot honest, and only the middle one is the model:
  1. relevance   - if nothing in the documents is similar to the question, no answer is attempted
  2. the model   - answers from the retrieved sections, or says it cannot
  3. code checks - the sources it cites must be ones it was given, and every figure in the answer must
                   appear in those sources

Anything that fails a layer is escalated to a human recruiter instead of being answered.
"""

import re
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from app.llm.client import LLMClient
from app.llm.safety import UNTRUSTED_RULE, wrap_untrusted
from app.prompts import load_prompt
from app.services.retrieval import Chunk

MIN_SIMILARITY = 0.25  # below this, no section is even about the topic: do not ask the model
MAX_ANSWER_CHARS = 900
ESCALATION_MESSAGE = (
    "I don't have a reliable answer to that in the job description or our company information. "
    "I've passed your question to the recruiter, who will get back to you."
)

_NUMBER = re.compile(r"\d[\d,.]*\d|\d")


class QAOutput(BaseModel):
    answerable: bool
    answer: str = ""
    source_ids: list[str] = Field(default_factory=list)


@dataclass
class QAResult:
    answer: str
    sources: list[Chunk]
    escalated: bool
    reason: str = ""  # why it was escalated: out_of_scope | not_covered | bad_sources | unverified_figures | too_long
    best_similarity: float = 0.0
    used: list[str] = field(default_factory=list)


def _figures(text: str) -> set[str]:
    """Every number in the text with separators removed, so '500,000' and '500000' compare equal."""
    return {re.sub(r"[,.]", "", n) for n in _NUMBER.findall(text)}


def answer_question(
    *, question: str, job_title: str, retrieved: list[tuple[Chunk, float]], llm: LLMClient
) -> QAResult:
    best = retrieved[0][1] if retrieved else 0.0
    if not retrieved or best < MIN_SIMILARITY:
        return QAResult(ESCALATION_MESSAGE, [], True, "out_of_scope", best)

    by_id = {chunk.id: chunk for chunk, _ in retrieved}
    sources_text = "\n\n".join(f"[{c.id}] {c.label}\n{c.text}" for c, _ in retrieved)
    system = load_prompt("qa") + "\n\n" + UNTRUSTED_RULE.format(tag="question")
    user = f"JOB: {job_title}\n\nSOURCES\n{sources_text}\n\nQUESTION\n{wrap_untrusted('question', question)}"
    out = llm.chat_json([{"role": "system", "content": system}, {"role": "user", "content": user}],
                        QAOutput, agent="qa_bot", tier="large", reasoning_effort="low")

    if not out.answerable or not out.answer.strip():
        return QAResult(ESCALATION_MESSAGE, [], True, "not_covered", best)
    cited = [by_id[i] for i in dict.fromkeys(out.source_ids) if i in by_id]
    if not cited:
        return QAResult(ESCALATION_MESSAGE, [], True, "bad_sources", best)
    if len(out.answer) > MAX_ANSWER_CHARS:
        return QAResult(ESCALATION_MESSAGE, [], True, "too_long", best)
    # Every figure must come from a section the candidate is shown. The model sometimes cites the neighbouring
    # section instead of the one holding the figure; if the figure is in another retrieved section, that section
    # is added to the sources (so the candidate can see it) rather than the correct answer being thrown away.
    sources = list(cited)
    for figure in _figures(out.answer) - _figures(" ".join(c.text for c in sources)):
        holder = next((c for c, _ in retrieved if figure in _figures(c.text)), None)
        if holder is None:
            return QAResult(ESCALATION_MESSAGE, [], True, "unverified_figures", best)
        if holder not in sources:
            sources.append(holder)
    return QAResult(out.answer.strip(), sources, False, "", best, [c.id for c in sources])
