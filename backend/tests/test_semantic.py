from app.services.embeddings import semantic_score


def test_related_text_scores_higher_than_unrelated(embedder):
    query = "python fastapi postgresql rest apis backend"
    close = semantic_score(embedder, query, ["built rest apis with python fastapi and postgresql"])
    far = semantic_score(embedder, query, ["designed brand logos and posters in photoshop"])
    assert close > far
    assert 0 <= far <= close <= 100


def test_only_the_best_chunks_count():
    class Fixed:
        def embed(self, texts):
            import numpy as np

            # query = axis 0; chunk similarities: 1.0, 0.0, 0.0
            return np.array([[1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0]], dtype=np.float32)

    score = semantic_score(Fixed(), "q", ["a", "b", "c"], top_k=1)
    assert score == 100.0  # best chunk is a perfect match, the rest are ignored
    assert semantic_score(Fixed(), "q", ["a", "b", "c"], top_k=3) < 100.0


def test_nothing_to_compare_gives_none(embedder):
    assert semantic_score(embedder, "python", []) is None
    assert semantic_score(embedder, "python", ["", "  "]) is None
    assert semantic_score(embedder, "  ", ["python"]) is None


def test_scores_are_clamped_to_0_100():
    class Perfect:
        def embed(self, texts):
            import numpy as np

            return np.ones((len(texts), 2), dtype=np.float32) / np.sqrt(2)

    assert semantic_score(Perfect(), "q", ["a"]) == 100.0
