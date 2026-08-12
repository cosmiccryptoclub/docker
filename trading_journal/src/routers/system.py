"""System: event log + scheduled-task introspection."""
from typing import Optional

from fastapi import APIRouter, HTTPException

from src import eventlog

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/logs")
def logs(level: Optional[str] = None, source: Optional[str] = None, limit: int = 300):
    return {"entries": eventlog.entries(level, source, limit), "sources": eventlog.sources()}


@router.get("/tasks")
def tasks():
    from src import scheduler
    return {"jobs": scheduler.list_jobs(), "running": scheduler.scheduler.running}


@router.post("/tasks/{job_id}/run")
def run_task(job_id: str):
    from src import scheduler
    if not scheduler.run_job_now(job_id):
        raise HTTPException(404, f"Unknown job '{job_id}'")
    return {"status": "started"}
