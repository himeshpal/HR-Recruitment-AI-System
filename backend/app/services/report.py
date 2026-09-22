"""A one-candidate PDF report: score, evidence, panel verdict and interview scorecard.

Built with fpdf2 and its built-in fonts, which only cover Latin-1, so text is tidied first (curly quotes, dashes and
so on become plain ones; anything else becomes "?"). By default the report is blind: it says "Candidate #7" and
carries no name, email or location, matching blind mode in the app.
"""

import re
from datetime import datetime, timezone

from fpdf import FPDF

from app.agents.matcher import WEIGHTS
from app.models import Match

_REPLACEMENTS = {
    "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-",
    " ": " ", " ": " ", "‑": "-", "→": "->", "✓": "v",
}
BAND = ((75, "Strong fit"), (50, "Partial fit"), (0, "Weak fit"))
BREAKDOWN_LABELS = {"skills": "Skills coverage", "semantic": "Semantic fit", "experience": "Experience", "ai_review": "AI review"}
STATUS_LABELS = {"demonstrated": "shown in real work", "listed": "listed only", "missing": "missing"}
VERDICT_LABELS = {"hire": "Hire", "maybe": "Maybe", "no_hire": "No hire"}


def clean(text: object) -> str:
    text = str(text if text is not None else "")
    for old, new in _REPLACEMENTS.items():
        text = text.replace(old, new)
    text = re.sub(r"(\S{60})(?=\S)", r"\1 ", text)  # let a very long unbroken string wrap instead of overflowing
    return text.encode("latin-1", "replace").decode("latin-1")


def band(score: float) -> str:
    return next(label for floor, label in BAND if score >= floor)


class _Report(FPDF):
    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120)
        self.cell(0, 6, clean(f"AI Recruiter - decision support, not a decision. Page {self.page_no()}"), align="C")


def build_report(match: Match, panel, interview, blind: bool = True) -> bytes:
    """`panel` is a PanelOut or None; `interview` is a completed Interview row or None."""
    candidate, job = match.candidate, match.job
    pdf = _Report(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(16, 16, 16)
    pdf.add_page()

    def heading(text: str) -> None:
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(60, 60, 140)
        pdf.cell(0, 7, clean(text.upper()), new_x="LMARGIN", new_y="NEXT")
        pdf.set_draw_color(200)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
        pdf.ln(2)
        pdf.set_text_color(0)

    def body(text: str, size: int = 10, style: str = "", indent: float = 0) -> None:
        pdf.set_font("Helvetica", style, size)
        pdf.set_x(pdf.l_margin + indent)
        pdf.multi_cell(0, 5, clean(text), new_x="LMARGIN", new_y="NEXT")

    def bullets(items: list[str], empty: str = "None noted.") -> None:
        if not items:
            body(empty, style="I")
        for item in items:
            body("- " + item, indent=3)

    title = f"Candidate #{candidate.id}" if blind else candidate.name
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 10, clean(title), new_x="LMARGIN", new_y="NEXT")
    profile = candidate.parsed_profile or {}
    if profile.get("headline"):
        body(profile["headline"], 11)
    body(f"For the role: {job.title}", 10)
    if not blind:
        contact = "  |  ".join(x for x in [candidate.email, profile.get("location")] if x)
        if contact:
            body(contact, 9)
    else:
        body("Blind report: name, email and location are left out.", 9, "I")
    body(f"Created {datetime.now(timezone.utc).strftime('%d %b %Y')}", 9)

    heading("Match score")
    pdf.set_font("Helvetica", "B", 26)
    pdf.cell(28, 12, str(round(match.overall_score)))
    pdf.set_font("Helvetica", "", 12)
    pdf.cell(0, 12, clean(f"{band(match.overall_score)}  (AI confidence {round(match.confidence * 100)}%)"), new_x="LMARGIN", new_y="NEXT")
    if match.summary:
        body(match.summary)
    pdf.ln(1)
    for key, value in (match.breakdown or {}).items():
        weight = WEIGHTS.get(key)
        line = f"{BREAKDOWN_LABELS.get(key, key)}: " + ("not used" if value is None else f"{round(value)} / 100")
        body(line + (f"   (counts {round(weight * 100)}%)" if weight is not None and value is not None else ""), indent=3)

    heading("Strengths")
    bullets(match.strengths or [])
    heading("Gaps")
    bullets(match.gaps or [])

    heading("Skills for this job")
    details = match.skill_details or []
    for kind, label in (("must", "Must have"), ("nice", "Nice to have")):
        rows = [d for d in details if d.get("kind") == kind]
        if rows:
            body(label + ": " + "; ".join(f"{d['skill']} ({STATUS_LABELS.get(d['status'], d['status'])})" for d in rows), indent=3)

    heading("Evidence from the resume")
    if not match.evidence:
        body("The AI did not cite any verifiable quotes.", style="I")
    for i, item in enumerate(match.evidence or [], 1):
        body(f"{i}. {item.get('claim', '')}", style="B")
        body(f"\"{item.get('quote', '')}\"", 9, "I", indent=5)
    body("Every quote is checked word for word against the resume the AI saw.", 8, "I")

    if panel is not None:
        heading("Panel review")
        body(f"Verdict: {VERDICT_LABELS[panel.verdict]}   |   consensus {round(panel.consensus_score)}   |   agreement {panel.agreement}", style="B")
        body(panel.summary)
        for review in panel.reviews:
            body(f"{review.label}: {round(review.score)} ({VERDICT_LABELS[review.stance]})", indent=3)
        if panel.key_risks:
            body("Key risks:", style="B")
            bullets(panel.key_risks)
        body("The verdict follows fixed rules in code; the AI only explains it.", 8, "I")

    card = interview.scorecard if interview is not None else None
    if card:
        heading("AI interview scorecard")
        body(f"Overall {round(card['overall'])} / 100   |   recommendation: {card['recommendation']}", style="B")
        body(card.get("summary", ""))
        for name, value in (card.get("competencies") or {}).items():
            body(f"{name.replace('_', ' ').capitalize()}: {round(value)} / 10", indent=3)
        if card.get("communication") is not None:
            body(f"Communication: {round(card['communication'])} / 10", indent=3)

    return bytes(pdf.output())
