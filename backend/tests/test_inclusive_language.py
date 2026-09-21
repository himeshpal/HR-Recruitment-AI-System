from app.services.inclusive_language import check_inclusive_language


def phrases(text):
    return [f.phrase.lower() for f in check_inclusive_language(text)]


def test_flags_known_biased_terms_with_category_and_suggestion():
    flags = check_inclusive_language("We need a rockstar ninja who is young and aggressive.")
    assert [f.phrase for f in flags] == ["rockstar", "ninja", "young", "aggressive"]
    by_phrase = {f.phrase: f for f in flags}
    assert by_phrase["young"].category == "Age-coded"
    assert by_phrase["aggressive"].suggestion == "proactive"


def test_positions_point_at_the_flagged_text():
    text = "Great guys wanted, and a Rock Star too"
    guys, rock_star = check_inclusive_language(text)
    assert text[guys.start : guys.end] == "guys"
    assert text[rock_star.start : rock_star.end] == "Rock Star"


def test_case_insensitive():
    assert phrases("ROCKSTAR and Ninja") == ["rockstar", "ninja"]


def test_whole_words_only_so_normal_words_are_not_flagged():
    assert phrases("The team will help them shift history. Thehe, hiss, chairs.") == []


def test_gendered_pronouns_and_binary_forms_are_flagged_once_each():
    assert phrases("The candidate will report to his manager; he/she must travel.") == ["his", "he/she"]


def test_overlapping_rules_report_the_longer_match_once():
    assert phrases("native English speaker") == ["native english speaker"]


def test_clean_text_has_no_flags():
    text = "You will build APIs with Python and collaborate with a supportive, diverse team."
    assert check_inclusive_language(text) == []


def test_results_are_sorted_by_position():
    flags = check_inclusive_language("ninja, then whitelist, then rockstar")
    assert [f.start for f in flags] == sorted(f.start for f in flags)
