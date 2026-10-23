"""Event broker behind the server-sent-events stream.

Work runs on background threads (ffmpeg and faster-whisper both block), while
the HTTP layer is asyncio. The broker is the seam: ``publish`` is safe from any
thread, ``subscribe`` hands an async iterator to a single SSE response.
"""

from __future__ import annotations

import asyncio
import threading
from collections import deque
from typing import Any

MAX_REPLAY = 200


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()
        self._recent: deque[dict[str, Any]] = deque(maxlen=MAX_REPLAY)
        self._seq = 0

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, event: dict[str, Any]) -> None:
        with self._lock:
            self._seq += 1
            event = {"seq": self._seq, **event}
            self._recent.append(event)
            subscribers = list(self._subscribers)
            loop = self._loop
        for queue in subscribers:
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(self._offer, queue, event)
            else:
                self._offer(queue, event)

    @staticmethod
    def _offer(queue: asyncio.Queue, event: dict[str, Any]) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            # A stalled client must never block the worker threads. Drop the
            # oldest event instead; the renderer refetches job state on resume.
            try:
                queue.get_nowait()
                queue.put_nowait(event)
            except Exception:
                pass

    def subscribe(self, since: int | None = None) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=512)
        with self._lock:
            self._subscribers.add(queue)
            if since is not None:
                for event in self._recent:
                    if event["seq"] > since:
                        self._offer(queue, event)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        with self._lock:
            self._subscribers.discard(queue)

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subscribers)


broker = EventBroker()
