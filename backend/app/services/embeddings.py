"""Local text embeddings (MiniLM via ONNX, no PyTorch) and the semantic-fit score built on them."""

import threading
from functools import lru_cache
from typing import Protocol

import numpy as np

from app.config import BACKEND_DIR

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_DIR = BACKEND_DIR / "data" / "models"

# Cosine similarity of related text lands around 0.5, unrelated around 0.3 with this model.
SIM_FLOOR, SIM_CEIL = 0.25, 0.60


class Embedder(Protocol):
    def ensure_loaded(self) -> None: ...

    def embed(self, texts: list[str]) -> np.ndarray:
        """Unit-length row vectors, one per text."""
        ...


class FastEmbedder:
    def __init__(self, model_name: str = MODEL_NAME):
        self.model_name = model_name
        self._model = None
        self._lock = threading.Lock()  # loading and inference are serialised; both are fast

    def ensure_loaded(self) -> None:
        with self._lock:
            if self._model is None:
                from fastembed import TextEmbedding

                MODEL_DIR.mkdir(parents=True, exist_ok=True)
                self._model = TextEmbedding(self.model_name, cache_dir=str(MODEL_DIR))

    def embed(self, texts: list[str]) -> np.ndarray:
        self.ensure_loaded()
        with self._lock:
            vectors = np.array(list(self._model.embed(texts)), dtype=np.float32)
        return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


@lru_cache
def get_embedder() -> Embedder:
    return FastEmbedder()


def semantic_score(embedder: Embedder, query: str, chunks: list[str], top_k: int = 2) -> float | None:
    """0-100: how closely the best few resume chunks match the job. None if there is nothing to compare."""
    chunks = [c for c in chunks if c.strip()]
    if not query.strip() or not chunks:
        return None
    vectors = embedder.embed([query, *chunks])
    similarities = vectors[1:] @ vectors[0]
    best = float(np.mean(np.sort(similarities)[::-1][:top_k]))
    scaled = (best - SIM_FLOOR) / (SIM_CEIL - SIM_FLOOR)
    return round(100 * min(1.0, max(0.0, scaled)), 1)
