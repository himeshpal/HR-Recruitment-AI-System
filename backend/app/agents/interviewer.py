"""Interview Agent: plan the questions, judge each answer, ask a follow-up when an answer is thin,
and produce a scorecard.

The LLM does the judging (question writing, per-answer scores, a follow-up when it sees vagueness,
and the written summary). Everything that decides an outcome is fixed rules in code: when a follow-up
is allowed, how answer scores roll up into competencies, the weights, and the recommendation.
The candidate's answers are untrusted text and are never allowed to instruct the scorer.
"""

from statistics import mean
from typing import Literal

from pydantic import BaseModel, Field

from app.agents.jd_generator import JobRequirements
from app.agents.matcher import job_brief
from app.llm.client import LLMClient
from app.llm.safety import UNTRUSTED_RULE, wrap_untrusted
from app.prompts import load_prompt

Competency = Literal["technical", "problem_solving", "behavioural", "role_fit"]

# How much each part of the interview counts. Communication is the clarity of all answers.
WEIGHTS = {"technical": 0.30, "problem_solving": 0.20, "behavioural": 0.15, "role_fit": 0.15, "communication": 0.20}
FOLLOW_UP_BELOW = 6.0  # an answer scoring under this may earn one follow-up question
STRONG_AT, MIXED_AT = 70, 50
MAX_ANSWER_CHARS = 4000


class Question(BaseModel):
    id: int
    text: str
    competency: Competency
    difficulty: Literal["easy", "medium", "hard"]
    good_answer_signals: list[str] = Field(default_factory=list)


class QuestionSet(BaseModel):
    questions: list[Question] = Field(min_length=4, max_length=6)


class AnswerEvaluation(BaseModel):
    content_score: float = Field(ge=0, le=10)
    clarity_score: float = Field(ge=0, le=10)
    feedback: str
    follow_up: str | None = None


class Narrative(BaseModel):
    summary: str
    strengths: list[str] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)


def generate_questions(
    *, job_title: str, requirements: JobRequirements, years: float, resume_text: str, areas_to_probe: list[str],
    llm: LLMClient,
) -> list[Question]:
    """`resume_text` should already be anonymised: the interviewer plans from work, not identity."""
    probe = "\n".join(f"- {a}" for a in areas_to_probe) or "- (none noted)"
    user = (
        f"JOB\n{job_brief(job_title, requirements)}\n\n"
        f"VERIFIED FACTS\nTotal years of professional experience, calculated from the dates: {years}\n\n"
        f"CANDIDATE BACKGROUND\n{wrap_untrusted('resume', resume_text)}\n\n"
        f"AREAS TO PROBE\n{wrap_untrusted('notes', probe)}"
    )
    system = "\n\n".join([load_prompt("interview_questions"), UNTRUSTED_RULE.format(tag="resume"),
                          UNTRUSTED_RULE.format(tag="notes")])
    out = llm.chat_json([{"role": "system", "content": system}, {"role": "user", "content": user}],
                        QuestionSet, agent="interview_questions", tier="large", reasoning_effort="low")
    return [q.model_copy(update={"id": i}) for i, q in enumerate(out.questions)]  # ids are ours, not the model's


def evaluate_answer(
    *, job_title: str, requirements: JobRequirements, question: dict, asked: str, answer: str, is_follow_up: bool,
    llm: LLMClient,
) -> AnswerEvaluation:
    """Judge one answer. `asked` is the text the candidate was actually answering (the question or its follow-up)."""
    parts = [f"JOB\n{job_brief(job_title, requirements)}", f"QUESTION ASKED\n{asked}"]
    if is_follow_up:
        parts.append(f"(This is a follow-up. The original question was: {question['text']})")
    signals = "\n".join(f"- {s}" for s in question.get("good_answer_signals", [])) or "- (none listed)"
    parts.append(f"WHAT A STRONG ANSWER INCLUDES\n{signals}")
    parts.append(f"CANDIDATE'S ANSWER\n{wrap_untrusted('answer', answer[:MAX_ANSWER_CHARS])}")
    system = load_prompt("interview_evaluate") + "\n\n" + UNTRUSTED_RULE.format(tag="answer")
    evaluation = llm.chat_json(
        [{"role": "system", "content": system}, {"role": "user", "content": "\n\n".join(parts)}],
        AnswerEvaluation, agent="interview_evaluate", tier="large", reasoning_effort="low",
    )
    evaluation.follow_up = (evaluation.follow_up or "").strip() or None
    return evaluation


def should_follow_up(evaluation: AnswerEvaluation, *, is_follow_up: bool) -> bool:
    """One follow-up at most per question, and only for a thin answer. Decided here, not by the model."""
    return not is_follow_up and evaluation.follow_up is not None and evaluation.content_score < FOLLOW_UP_BELOW


def recommendation_for(overall: float) -> str:
    return "strong" if overall >= STRONG_AT else "mixed" if overall >= MIXED_AT else "weak"


def compute_scorecard(questions: list[dict], turns: list[dict]) -> dict:
    """All the numbers in the scorecard, from the recorded answer scores."""
    answers: dict[int, list[dict]] = {}
    for turn in turns:
        if turn["role"] == "candidate":
            answers.setdefault(turn["question_index"], []).append(turn)

    rows = []
    for index, question in enumerate(questions):
        given = answers.get(index, [])
        if not given:
            continue
        rows.append({
            "index": index, "text": question["text"], "competency": question["competency"],
            "score": round(10 * mean(a["content_score"] for a in given), 1),
            "follow_up_asked": len(given) > 1,
            "feedback": " ".join(a["feedback"].strip() for a in given if a.get("feedback")),
        })

    competencies = {}
    for name in ("technical", "problem_solving", "behavioural", "role_fit"):
        scores = [r["score"] for r in rows if r["competency"] == name]
        if scores:
            competencies[name] = round(mean(scores), 1)
    all_answers = [a for given in answers.values() for a in given]
    communication = round(10 * mean(a["clarity_score"] for a in all_answers), 1) if all_answers else None

    parts = {**competencies, **({"communication": communication} if communication is not None else {})}
    total_weight = sum(WEIGHTS[k] for k in parts)
    overall = round(sum(WEIGHTS[k] * v for k, v in parts.items()) / total_weight, 1) if parts else 0.0
    return {
        "overall": overall, "recommendation": recommendation_for(overall), "competencies": competencies,
        "communication": communication, "weights": WEIGHTS, "questions": rows,
    }


def narrate(*, job_title: str, numbers: dict, llm: LLMClient) -> Narrative:
    facts = {k: numbers[k] for k in ("overall", "recommendation", "competencies", "communication")}
    rows = [{"competency": r["competency"], "score": r["score"], "follow_up_asked": r["follow_up_asked"],
             "feedback": r["feedback"]} for r in numbers["questions"]]
    user = (f"JOB: {job_title}\n\nRESULTS (calculated by rules)\n{facts}\n\n"
            f"PER QUESTION\n{wrap_untrusted('feedback', str(rows))}")
    system = load_prompt("interview_scorecard") + "\n\n" + UNTRUSTED_RULE.format(tag="feedback")
    out = llm.chat_json([{"role": "system", "content": system}, {"role": "user", "content": user}],
                        Narrative, agent="interview_scorecard", tier="small", reasoning_effort="low")
    out.strengths, out.concerns = out.strengths[:3], out.concerns[:3]
    return out


def simulate_answer(
    *, job_title: str, requirements: JobRequirements, background: str, question_text: str,
    quality: Literal["strong", "weak"], llm: LLMClient,
) -> str:
    """Demo helper and test tool: an AI writes the answer a strong or a weak candidate might give."""
    user = (f"JOB\n{job_brief(job_title, requirements)}\n\nBACKGROUND\n{wrap_untrusted('resume', background)}\n\n"
            f"QUESTION\n{question_text}\n\nQUALITY OF ANSWER TO WRITE: {quality}")
    system = load_prompt("interview_simulate") + "\n\n" + UNTRUSTED_RULE.format(tag="resume")
    result = llm.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                      agent="interview_simulate", tier="small", temperature=0.3, reasoning_effort="low")
    return result.text.strip()
