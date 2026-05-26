import asyncio
import logging

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse
from watchdog.events import FileSystemEventHandler

logger = logging.getLogger("uvicorn.error")
router = APIRouter()
connected_queues: set[asyncio.Queue] = set()


class WatcherHandler(FileSystemEventHandler):
    def __init__(self, loop):
        self.loop = loop

    def _trigger_refresh(self, event_type, path):
        logger.info("Watchdog detected %s: %s", event_type, path)
        for queue in list(connected_queues):
            self.loop.call_soon_threadsafe(queue.put_nowait, "refresh")

    def on_moved(self, event):
        if not event.is_directory:
            self._trigger_refresh("moved", event.dest_path)

    def on_created(self, event):
        if not event.is_directory:
            self._trigger_refresh("created", event.src_path)

    def on_closed(self, event):
        if not event.is_directory:
            self._trigger_refresh("closed", event.src_path)

    def on_deleted(self, event):
        self._trigger_refresh("deleted", event.src_path)


@router.get("/watch")
async def message_stream(request: Request):
    queue = asyncio.Queue()
    connected_queues.add(queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                data = await queue.get()
                yield {"data": data}
        finally:
            connected_queues.discard(queue)

    return EventSourceResponse(event_generator())
