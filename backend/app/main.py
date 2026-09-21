from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db, init_db
from app.llm.client import LLMError
from app.routers import candidates, jobs


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="AI HR Recruitment System", lifespan=lifespan)

@app.exception_handler(LLMError)
async def llm_error_handler(_: Request, exc: LLMError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


app.include_router(jobs.router)
app.include_router(candidates.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """Reports config and DB status. Does not call the LLM (that would spend quota)."""
    settings = get_settings()
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "database": "ok",
        "llm": {
            "base_url": settings.llm_base_url,
            "model_large": settings.llm_model_large,
            "model_small": settings.llm_model_small,
            "api_key_configured": bool(settings.llm_api_key),
        },
    }
