from app.agents.resume_parser import Experience, ParsedProfile
from app.services.skills import assess_skills, normalize_skill


def profile(skills, highlights=(), title="Engineer") -> ParsedProfile:
    return ParsedProfile(
        name="A B", skills=list(skills),
        experience=[Experience(title=title, highlights=list(highlights))],
    )


def status_of(details, skill):
    return next(d.status for d in details if d.skill == skill)


def test_normalize_handles_aliases_qualifiers_and_case():
    assert normalize_skill("Postgres") == ("postgresql", False)
    assert normalize_skill("  NodeJS ") == ("node.js", False)
    assert normalize_skill("Python (basic)") == ("python", True)
    assert normalize_skill("ReactJS") == ("react", False)


def test_skill_used_in_experience_is_demonstrated_and_listed_only_is_listed():
    p = profile(["Python", "Docker"], highlights=["Built REST APIs in Python"])
    details, score = assess_skills(["Python", "Docker", "Kafka"], [], p)
    assert [d.status for d in details] == ["demonstrated", "listed", "missing"]
    assert score == round(100 * (1.0 + 0.5 + 0.0) / 3, 1)


def test_keyword_stuffing_scores_below_real_experience():
    stuffed = profile(["Python", "Django", "AWS", "Docker"], highlights=["Worked on various projects"])
    real = profile([], highlights=["Built Django services in Python", "Deployed to AWS with Docker"])
    must = ["Python", "Django", "AWS", "Docker"]
    assert assess_skills(must, [], stuffed)[1] == 50.0
    assert assess_skills(must, [], real)[1] == 100.0


def test_basic_level_skill_gets_reduced_credit():
    _, score = assess_skills(["Python"], [], profile(["Python (basic)"]))
    assert score == 25.0


def test_alias_in_experience_text_counts():
    details, _ = assess_skills(["PostgreSQL"], [], profile([], highlights=["Tuned postgres queries"]))
    assert details[0].status == "demonstrated"


def test_whole_word_matching_avoids_false_positives():
    p = profile(["JavaScript", "MySQL"], highlights=["Wrote JavaScript and MySQL queries"])
    details, _ = assess_skills(["Java", "SQL", "C++"], [], p)
    assert [d.status for d in details] == ["missing", "missing", "missing"]


def test_special_character_skills_match():
    p = profile([], highlights=["Wrote C++ services and used CI/CD with Node.js"])
    details, score = assess_skills(["C++", "CI/CD", "Node.js"], [], p)
    assert [d.status for d in details] == ["demonstrated"] * 3 and score == 100.0


def test_nice_to_have_adds_at_most_fifteen_percent_weight():
    p = profile([], highlights=["Used Python"])
    _, only_must = assess_skills(["Python"], ["Go"], p)
    assert only_must == 85.0
    _, with_nice = assess_skills(["Python"], ["Python"], p)
    assert with_nice == 100.0


def test_no_skills_in_the_job_means_no_score():
    assert assess_skills([], [], profile(["Python"])) == ([], None)
