import pytest

from app.services.evaluation import keyword_baseline, ndcg_at_k, pairwise_accuracy, spearman


def test_perfect_reversed_and_tied_rankings():
    grades = [3, 2, 1, 0]
    assert pairwise_accuracy([90, 70, 50, 10], grades) == 1.0
    assert pairwise_accuracy([10, 50, 70, 90], grades) == 0.0
    assert pairwise_accuracy([50, 50, 50, 50], grades) == 0.5
    assert spearman([90, 70, 50, 10], grades) == pytest.approx(1.0)
    assert spearman([10, 50, 70, 90], grades) == pytest.approx(-1.0)


def test_pairs_with_equal_grades_are_not_judged():
    assert pairwise_accuracy([10, 90], [1, 1]) == 1.0  # nothing to get wrong


def test_spearman_handles_ties_and_constants():
    assert spearman([5, 5, 5], [1, 2, 3]) == 0.0
    assert 0.9 < spearman([9, 8, 8, 1], [3, 2, 2, 0]) <= 1.0


def test_ndcg_rewards_putting_the_best_candidates_first():
    grades = [3, 2, 1, 0, 0]
    assert ndcg_at_k([9, 8, 7, 1, 0], grades) == pytest.approx(1.0)
    worse = ndcg_at_k([0, 1, 2, 8, 9], grades)
    assert 0 <= worse < 0.5
    assert ndcg_at_k([1, 2], [0, 0]) == 1.0  # no relevant candidates at all


def test_keyword_baseline_is_fooled_by_stuffing_which_is_why_we_compare():
    stuffed = "Skills: Python, Django, AWS, Docker, Kafka. Worked on various projects."
    real = "Built Django services in Python."
    must = ["Python", "Django", "AWS", "Docker"]
    assert keyword_baseline(must, stuffed) == 100.0 > keyword_baseline(must, real) == 50.0


def test_keyword_baseline_matches_whole_words_only():
    assert keyword_baseline(["Java"], "JavaScript developer") == 0.0
    assert keyword_baseline([], "anything") == 0.0
