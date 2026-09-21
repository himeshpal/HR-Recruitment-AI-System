"""Rule-based check for biased or exclusionary wording in job descriptions.

Deliberately not an LLM call: it is instant, free, deterministic and testable,
so the UI can re-run it on every keystroke.
"""

import re
from dataclasses import dataclass

from pydantic import BaseModel


class LanguageFlag(BaseModel):
    phrase: str  # the text as it appears in the document
    start: int
    end: int
    category: str
    reason: str
    suggestion: str


@dataclass(frozen=True)
class _Rule:
    pattern: str
    category: str
    reason: str
    suggestion: str


_JARGON = "Exclusionary jargon"
_GENDER = "Gender-coded"
_AGE = "Age-coded"
_ABILITY = "Ability-coded"

# Order matters: when two rules match overlapping text, the earlier rule wins
# (so "he/she" is reported once, not also as "he" and "she").
_RULES = [
    _Rule(r"rock\s?stars?", _JARGON, "Hero-worship jargon skews toward a narrow, male-coded pool.", "skilled engineer"),
    _Rule(r"ninjas?", _JARGON, "Hero-worship jargon skews toward a narrow, male-coded pool.", "skilled professional"),
    _Rule(r"gurus?|wizards?", _JARGON, "Vague superlatives put off many qualified applicants.", "expert"),
    _Rule(r"aggressive(?:ly)?", _GENDER, "Masculine-coded wording reduces applications from women.", "proactive"),
    _Rule(r"dominant|dominate", _GENDER, "Masculine-coded wording reduces applications from women.", "lead"),
    _Rule(r"guys", _GENDER, "Addresses the team as male.", "everyone"),
    _Rule(r"manpower", _GENDER, "Gendered noun.", "workforce"),
    _Rule(r"man[- ]hours?", _GENDER, "Gendered noun.", "person-hours"),
    _Rule(r"chairman", _GENDER, "Gendered job title.", "chair"),
    _Rule(r"salesmen|salesman", _GENDER, "Gendered job title.", "salesperson"),
    _Rule(r"businessmen|businessman", _GENDER, "Gendered job title.", "business professional"),
    _Rule(r"he/she|s/he|he or she", _GENDER, "Assumes a gender binary.", "they"),
    _Rule(r"his/her|his or her", _GENDER, "Assumes a gender binary.", "their"),
    _Rule(r"he", _GENDER, "Generic 'he' assumes the candidate is male.", "they"),
    _Rule(r"him", _GENDER, "Generic 'him' assumes the candidate is male.", "them"),
    _Rule(r"his", _GENDER, "Generic 'his' assumes the candidate is male.", "their"),
    _Rule(r"young|youthful", _AGE, "Signals a preference for younger applicants.", "motivated"),
    _Rule(r"digital natives?", _AGE, "Signals a preference for younger applicants.", "comfortable with digital tools"),
    _Rule(r"(?:recent|fresh) graduates?", _AGE, "Signals age; say what level of experience you actually need.", "early-career candidate"),
    _Rule(r"high[- ]energy|energetic", _AGE, "Often read as a preference for younger applicants.", "enthusiastic"),
    _Rule(r"overqualified", _AGE, "Often used to screen out older applicants.", "experienced"),
    _Rule(r"able[- ]bodied", _ABILITY, "Excludes people with disabilities.", "able to perform the essential duties (with or without accommodation)"),
    _Rule(r"handicapped", _ABILITY, "Outdated term.", "person with a disability"),
    _Rule(r"native (?:english )?speakers?", "Language / origin", "Excludes strong non-native speakers; state the skill instead.", "fluent in English"),
    _Rule(r"blacklist(?:ed|ing)?", "Tech terms", "Colour-coded technical term.", "blocklist"),
    _Rule(r"whitelist(?:ed|ing)?", "Tech terms", "Colour-coded technical term.", "allowlist"),
    _Rule(r"work hard,? play hard", "Culture-fit cliche", "Signals a narrow social culture.", "collaborative, supportive team"),
]

# Whole-word, case-insensitive. "he/she" starts at a word boundary and ends at one, so \b works for all rules.
_COMPILED = [(re.compile(rf"\b(?:{rule.pattern})\b", re.IGNORECASE), rule) for rule in _RULES]


def check_inclusive_language(text: str) -> list[LanguageFlag]:
    """Return every flagged phrase with its position, sorted by position."""
    flags: list[LanguageFlag] = []
    taken: list[tuple[int, int]] = []
    for regex, rule in _COMPILED:
        for m in regex.finditer(text):
            if any(m.start() < end and start < m.end() for start, end in taken):
                continue
            taken.append((m.start(), m.end()))
            flags.append(
                LanguageFlag(
                    phrase=m.group(0), start=m.start(), end=m.end(),
                    category=rule.category, reason=rule.reason, suggestion=rule.suggestion,
                )
            )
    return sorted(flags, key=lambda f: f.start)
