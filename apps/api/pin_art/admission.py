import math
import time
from collections import deque


class ExportRateLimit:
    def __init__(self, limit=6, window=60, clock=time.monotonic):
        if limit < 1 or window <= 0 or not math.isfinite(window):
            raise ValueError("Use a positive export limit and finite window")
        self.limit = limit
        self.window = window
        self.clock = clock
        self.attempts = deque()

    def admit(self):
        now = self.clock()
        while self.attempts and self.attempts[0] <= now - self.window:
            self.attempts.popleft()
        if len(self.attempts) >= self.limit:
            return max(1, math.ceil(self.attempts[0] + self.window - now))
        self.attempts.append(now)
        return 0
