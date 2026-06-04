import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api import events
from app.api.endpoints import convert, download, inspect, monitor, stac, uploads, weather_download
from app.core.config import settings
from app.services.convert.jobs import convert_job_manager

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="Local File STAC API Test Service")
templates = Jinja2Templates(directory="app/templates")
observer = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    global observer
    convert_job_manager.bind_loop(asyncio_loop())
    if not settings.enable_data_watch:
        logger.info("Data watchdog disabled.")
        return

    watch_path = settings.data_root
    if not os.path.exists(watch_path):
        logger.warning("Local data root does not exist; watchdog disabled: %s", watch_path)
        return

    from watchdog.observers.polling import PollingObserver as Observer

    event_handler = events.WatcherHandler(asyncio_loop())
    observer = Observer()
    observer.schedule(event_handler, watch_path, recursive=True)
    observer.start()
    logger.info("Watchdog started: %s", watch_path)


@app.on_event("shutdown")
async def shutdown_event():
    if observer and observer.is_alive():
        observer.stop()
        observer.join(timeout=5)


def asyncio_loop():
    import asyncio

    return asyncio.get_running_loop()


app.include_router(monitor.router, prefix="/monitor", tags=["Monitoring"])
app.include_router(inspect.router, prefix="/inspect", tags=["Inspection"])
app.include_router(events.router, prefix="/events", tags=["Realtime"])
app.include_router(download.router, prefix="/download")
app.include_router(weather_download.router, prefix="/weather/download")
app.include_router(convert.router, prefix="/convert")
app.include_router(stac.router, prefix="/stac")
app.include_router(uploads.router, prefix="/uploads", tags=["Uploads"])

app.mount("/data", StaticFiles(directory=settings.data_root), name="local_data")


@app.get("/", response_class=HTMLResponse)
async def monitor_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="monitor.html",
        context={"api_context_path": settings.api_context_path},
    )
