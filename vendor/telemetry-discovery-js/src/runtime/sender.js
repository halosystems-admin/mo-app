export class BufferedSender {
  constructor(config) {
    this.config = config;
    this.queue = [];
    this.flushTimer = null;
    this.activeFlushes = 0;
    this.stats = {
      enqueued: 0,
      sent: 0,
      dropped_queue_full: 0,
      dropped_sender_error: 0,
      flush_errors: 0
    };
  }

  enqueue(event) {
    if (this.queue.length >= this.config.performance.queueMaxEvents) {
      this.stats.dropped_queue_full += 1;
      return;
    }

    this.queue.push(event);
    this.stats.enqueued += 1;
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, this.config.performance.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  async flush() {
    if (this.activeFlushes >= this.config.performance.maxConcurrentFlushes) {
      return;
    }

    const batch = this.queue.splice(0, this.config.performance.batchSize);
    if (batch.length === 0) {
      return;
    }

    this.activeFlushes += 1;
    try {
      await this.sendBatch(batch);
      this.stats.sent += batch.length;
    } catch (error) {
      this.stats.flush_errors += 1;
      if (isRetryableSendError(error)) {
        this.queue.unshift(...batch);
        this.scheduleFlush();
      } else {
        this.stats.dropped_sender_error += batch.length;
      }
    } finally {
      this.activeFlushes -= 1;
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  async sendBatch(events) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.performance.requestTimeoutMs);
    timeout.unref?.();

    try {
      const response = await fetch(`${this.config.endpoint}/v1/events/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.token}`
        },
        body: JSON.stringify({ events }),
        signal: controller.signal
      });

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        const error = new Error(`batch send failed with status ${response.status}`);
        error.status = response.status;
        error.details = details;
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isRetryableSendError(error) {
  if (error?.name === "AbortError") {
    return true;
  }

  const status = error?.status;
  if (typeof status === "number") {
    return status >= 500 || status === 429;
  }

  return true;
}
