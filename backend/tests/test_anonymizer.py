from app.agents.resume_parser import Education, ParsedProfile
from app.services.anonymizer import anonymize_resume

RESUME = """Priya Nair
priya.nair@example.com | +91 98000 10002 | Kochi, India
Gender: Female
Date of Birth: 12 March 1998
Marital Status: Single

Ms. Nair is a Python developer. She built APIs and her team praised her work.
Worked with Acme Corp from 2019-01 to 2022-06 (2019-01 - 2022-06).
B.Sc Computer Science, University of Kerala (2020)
Skills: Python, Django"""

PROFILE = ParsedProfile(
    name="Priya Nair", email="priya.nair@example.com", phone="+91 98000 10002", location="Kochi, India",
    education=[Education(degree="B.Sc", institution="University of Kerala", year="2020")],
)


def test_identity_signals_are_removed():
    out = anonymize_resume(RESUME, PROFILE)
    for leaked in ["Priya", "Nair", "priya.nair", "98000", "Kochi", "India", "Kerala", "Female",
                   "Date of Birth", "Marital", "1998"]:
        assert leaked not in out, f"{leaked!r} survived anonymisation:\n{out}"


def test_placeholders_keep_the_text_readable():
    out = anonymize_resume(RESUME, PROFILE)
    assert "[CANDIDATE]" in out and "[EMAIL]" in out and "[PHONE]" in out
    assert "[LOCATION]" in out and "[INSTITUTION]" in out


def test_gendered_pronouns_and_titles_are_neutralised():
    out = anonymize_resume(RESUME, PROFILE)
    assert "They built APIs and their team praised their work" in out
    assert "Ms." not in out


def test_job_relevant_content_is_kept():
    out = anonymize_resume(RESUME, PROFILE)
    assert "Python developer" in out and "Acme Corp" in out and "Skills: Python, Django" in out


def test_date_ranges_are_not_mistaken_for_phone_numbers():
    out = anonymize_resume(RESUME, PROFILE)
    assert "(2019-01 - 2022-06)" in out and "from 2019-01 to 2022-06" in out


def test_short_or_empty_identity_fields_do_not_mangle_text():
    profile = ParsedProfile(name="Al", location="", phone=None)
    text = "Al built a database and an alarm system."
    assert anonymize_resume(text, profile) == text  # 'Al' is too short to replace safely


def test_same_resume_with_swapped_identity_becomes_identical():
    a = anonymize_resume(RESUME, PROFILE)
    swapped = (RESUME.replace("Priya Nair", "John Smith").replace("Ms. Nair", "Mr. Smith")
               .replace("priya.nair", "john.smith").replace("Kochi", "Boston").replace("University of Kerala", "MIT")
               .replace("She built", "He built").replace("her team", "his team").replace("her work", "his work")
               .replace("Nair", "Smith"))
    profile_b = ParsedProfile(name="John Smith", email="john.smith@example.com", phone="+91 98000 10002",
                              location="Boston, India", education=[Education(degree="B.Sc", institution="MIT")])
    assert anonymize_resume(swapped, profile_b) == a
