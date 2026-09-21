from datetime import date

from app.agents.resume_parser import Experience
from app.services.experience import total_experience_years

TODAY = date(2026, 9, 21)


def job(start, end):
    return Experience(title="t", start=start, end=end)


def test_simple_span_in_months():
    assert total_experience_years([job("2020-01", "2022-12")], TODAY) == 3.0


def test_present_uses_todays_date():
    assert total_experience_years([job("2026-09", "present")], TODAY) == 0.1  # this month only
    assert total_experience_years([job("2024-09", "Present")], TODAY) == 2.1  # 25 months, both ends inclusive


def test_overlapping_roles_are_counted_once():
    jobs = [job("2018-01", "2020-12"), job("2019-06", "2021-12")]
    assert total_experience_years(jobs, TODAY) == 4.0  # 2018-01 .. 2021-12


def test_gaps_are_not_counted():
    jobs = [job("2015-01", "2015-12"), job("2018-01", "2018-12")]
    assert total_experience_years(jobs, TODAY) == 2.0


def test_year_only_dates_cover_whole_years():
    assert total_experience_years([job("2019", "2020")], TODAY) == 2.0


def test_unparseable_or_missing_dates_are_ignored_not_guessed():
    jobs = [job("sometime", "2020-01"), job(None, None), job("2020-01", None), job("2021-05", "2021-02")]
    assert total_experience_years(jobs, TODAY) == 0.0


def test_no_jobs():
    assert total_experience_years([], TODAY) == 0.0
