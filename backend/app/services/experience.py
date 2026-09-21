"""Total years of experience, computed in code because LLMs are unreliable at date maths."""

import re
from collections.abc import Iterable
from datetime import date
from typing import Protocol

_OPEN_ENDED = {"present", "current", "now", "ongoing", "today"}


class _HasDates(Protocol):
    start: str | None
    end: str | None


def _month_index(value: str | None, *, is_end: bool, today: date) -> int | None:
    """'2021-03' -> month number, '2021' -> Jan (start) or Dec (end); unparseable -> None."""
    if value is None:
        return None
    text = value.strip().lower()
    if text in _OPEN_ENDED:
        return today.year * 12 + today.month - 1
    if m := re.fullmatch(r"(\d{4})-(\d{1,2})", text):
        year, month = int(m[1]), int(m[2])
        return year * 12 + month - 1 if 1 <= month <= 12 else None
    if m := re.fullmatch(r"(\d{4})", text):
        return int(m[1]) * 12 + (11 if is_end else 0)
    return None


def total_experience_years(jobs: Iterable[_HasDates], today: date | None = None) -> float:
    """Sum of worked months with overlapping roles counted once, in years to 1 decimal."""
    today = today or date.today()
    spans: list[tuple[int, int]] = []
    for job in jobs:
        start = _month_index(job.start, is_end=False, today=today)
        end = _month_index(job.end, is_end=True, today=today)
        if start is not None and end is not None and end >= start:
            spans.append((start, end + 1))  # +1: a role that starts and ends in one month counts as 1

    total, covered_to = 0, None
    for start, end in sorted(spans):
        if covered_to is None or start > covered_to:
            total += end - start
            covered_to = end
        elif end > covered_to:
            total += end - covered_to
            covered_to = end
    return round(total / 12, 1)
