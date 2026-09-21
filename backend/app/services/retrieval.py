"""Find the parts of the job description and company info that are relevant to a question.

The documents are split by their Markdown headings, so each chunk is one coherent topic that can be
cited by name. Relevance is the same local embedding similarity used by the Matcher.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.services.embeddings import Embedder

MAX_CHUNK_CHARS = 1200

# A short list such as "Python / FastAPI / Docker" says little about *what kind* of information it is, so
# similarity to a question like "which skills are required?" is low. The Job Studio always writes these
# headings, so retrieval is told what each one is for. This only affects ranking; the model still reads the real text.
HEADING_HINTS = {
    "must have": "required skills, requirements, qualifications, what you need to apply",
    "nice to have": "preferred, optional and bonus skills, not required",
    "what you'll do": "responsibilities, duties and day-to-day work",
    "what we offer": "benefits, perks and compensation",
    "about the role": "summary of the role and the team",
}


@dataclass(frozen=True)
class Chunk:
    id: str  # "job:2" or "company:5": what the model cites
    source: str  # "job" | "company"
    title: str
    text: str

    @property
    def label(self) -> str:
        return ("Job description" if self.source == "job" else "Company") + f": {self.title}"


def chunk_markdown(markdown: str, source: str) -> list[Chunk]:
    """One chunk per heading. A heading with no text of its own is skipped; long sections are cut at paragraph ends."""
    chunks: list[Chunk] = []
    title, lines = "Overview", []

    def flush() -> None:
        body = "\n".join(lines).strip()
        if not body:
            return
        pieces, current = [], ""
        for paragraph in re.split(r"\n\s*\n", body):
            if current and len(current) + len(paragraph) > MAX_CHUNK_CHARS:
                pieces.append(current)
                current = ""
            current = f"{current}\n\n{paragraph}".strip()
        pieces.append(current)
        for piece in pieces:
            chunks.append(Chunk(f"{source}:{len(chunks)}", source, title, piece))

    for line in markdown.splitlines():
        heading = re.match(r"^(#{1,3})\s+(.*\S)\s*$", line)
        if heading:
            flush()
            title, lines = heading.group(2), []
        else:
            lines.append(line)
    flush()
    return chunks


def load_company_info(path: Path) -> tuple[str, list[Chunk]]:
    """(company name, chunks). A missing file simply means there is no company info to cite."""
    if not path.exists():
        return "our company", []
    text = path.read_text(encoding="utf-8")
    name = re.search(r"^#\s+(.+?)\s*$", text, re.MULTILINE)
    return (name.group(1) if name else "our company"), chunk_markdown(text, "company")


def retrieve(question: str, chunks: list[Chunk], embedder: Embedder, k: int = 4) -> list[tuple[Chunk, float]]:
    """The `k` chunks most similar to the question, best first, with their cosine similarity."""
    if not chunks or not question.strip():
        return []
    def searchable(chunk: Chunk) -> str:
        hint = HEADING_HINTS.get(chunk.title.lower().strip(), "") if chunk.source == "job" else ""
        return f"{chunk.title} ({hint}). {chunk.text}" if hint else f"{chunk.title}. {chunk.text}"

    vectors = embedder.embed([question, *[searchable(c) for c in chunks]])
    similarities = vectors[1:] @ vectors[0]
    order = np.argsort(-similarities)[:k]
    return [(chunks[i], float(similarities[i])) for i in order]
