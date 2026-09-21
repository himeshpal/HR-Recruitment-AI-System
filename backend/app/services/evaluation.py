"""Ranking metrics and a plain keyword baseline, used to check that the Matcher really adds value."""

import math

from app.services.skills import mentions, normalize_skill


def pairwise_accuracy(scores: list[float], grades: list[int]) -> float:
    """Of all pairs where one candidate is truly better, how often is the better one scored higher?
    A tie counts as half. 1.0 is perfect, 0.5 is what random scoring gives."""
    correct = total = 0.0
    for i in range(len(scores)):
        for j in range(len(scores)):
            if grades[i] > grades[j]:
                total += 1
                correct += 1.0 if scores[i] > scores[j] else 0.5 if scores[i] == scores[j] else 0.0
    return correct / total if total else 1.0


def _ranks(values: list[float]) -> list[float]:
    """1-based ranks with ties sharing their average rank."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    pos = 0
    while pos < len(order):
        end = pos
        while end + 1 < len(order) and values[order[end + 1]] == values[order[pos]]:
            end += 1
        for k in range(pos, end + 1):
            ranks[order[k]] = (pos + end) / 2 + 1
        pos = end + 1
    return ranks


def spearman(scores: list[float], grades: list[int]) -> float:
    """Rank correlation between scores and true grades, -1 to 1 (0 if either is constant)."""
    a, b = _ranks(scores), _ranks([float(g) for g in grades])
    mean_a, mean_b = sum(a) / len(a), sum(b) / len(b)
    cov = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b))
    var_a = sum((x - mean_a) ** 2 for x in a)
    var_b = sum((y - mean_b) ** 2 for y in b)
    return cov / math.sqrt(var_a * var_b) if var_a and var_b else 0.0


def ndcg_at_k(scores: list[float], grades: list[int], k: int = 3) -> float:
    """How well the top k of the ranking matches the ideal top k (1.0 is perfect)."""
    order = sorted(range(len(scores)), key=lambda i: -scores[i])[:k]
    dcg = sum(grades[i] / math.log2(rank + 2) for rank, i in enumerate(order))
    ideal = sorted(grades, reverse=True)[:k]
    idcg = sum(g / math.log2(rank + 2) for rank, g in enumerate(ideal))
    return dcg / idcg if idcg else 1.0


def keyword_baseline(must_have: list[str], resume_text: str) -> float:
    """The naive approach: what share of the required skills are mentioned anywhere in the resume?"""
    if not must_have:
        return 0.0
    text = resume_text.lower()
    hits = sum(mentions(text, normalize_skill(skill)[0]) for skill in must_have)
    return 100 * hits / len(must_have)
