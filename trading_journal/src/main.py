"""FastAPI entrypoint: wires routers + serves the built frontend (SPA)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from src import config
from src.db import init_db
from src.routers import (
    accounts, admin, analytics, backtest, econ, fills, journal, live, meta, playbooks,
    prop, settings as settings_router, system, tags, trades,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from src import eventlog
    eventlog.success("app", f"{config.APP_NAME} v{config.APP_VERSION} started")
    from src import scheduler
    try:
        scheduler.start()
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  scheduler start failed: {e}")
    yield
    try:
        scheduler.shutdown()
    except Exception:
        pass


app = FastAPI(title=config.APP_NAME, version=config.APP_VERSION, lifespan=lifespan)

app.include_router(accounts.router)
app.include_router(trades.router)
app.include_router(fills.router)
app.include_router(analytics.router)
app.include_router(admin.router)
app.include_router(meta.router)
app.include_router(tags.router)
app.include_router(live.router)
app.include_router(playbooks.router)
app.include_router(backtest.router)
app.include_router(journal.router)
app.include_router(econ.router)
app.include_router(system.router)
app.include_router(prop.router)
app.include_router(settings_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": config.APP_NAME, "version": config.APP_VERSION}


# --- uploaded screenshots ---------------------------------------------------
if config.UPLOADS_DIR.exists():
    app.mount("/uploads", StaticFiles(directory=str(config.UPLOADS_DIR)), name="uploads")


# --- SPA static hosting -----------------------------------------------------
class SPAStaticFiles(StaticFiles):
    """Serve the built frontend and fall back to index.html for client routes."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("api"):
                return await super().get_response("index.html", scope)
            raise


if config.STATIC_DIR.exists():
    app.mount("/", SPAStaticFiles(directory=str(config.STATIC_DIR), html=True), name="static")
else:
    @app.get("/")
    def _root():
        return JSONResponse({
            "message": f"{config.APP_NAME} API is running. Frontend not built yet.",
            "docs": "/docs",
            "health": "/api/health",
        })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
