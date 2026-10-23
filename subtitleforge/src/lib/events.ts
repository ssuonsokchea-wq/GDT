/**
 * The event stream.
 *
 * One `EventSource` carries every job's progress. `EventSource` reconnects on
 * its own, and the backend replays anything missed since the last sequence
 * number it saw, so a renderer reload during a two-hour render rejoins the
 * stream without losing the progress bar.
 */

import { eventStreamUrl } from './api';
import type { BackendEvent } from '@/types/api';

type Handler = (event: BackendEvent) => void;

export class EventStream {
  private source: EventSource | null = null;
  private handlers = new Set<Handler>();
  private lastSeq = 0;
  private reconnectTimer: number | undefined;
  private connectedHandlers = new Set<(connected: boolean) => void>();

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this.connectedHandlers.add(handler);
    return () => this.connectedHandlers.delete(handler);
  }

  start(): void {
    this.stop();
    let source: EventSource;
    try {
      source = new EventSource(eventStreamUrl(this.lastSeq || undefined));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.source = source;

    source.onopen = () => this.setConnected(true);

    source.onmessage = (message) => this.dispatch(message.data);
    // Named events arrive on their own listeners, not onmessage.
    for (const name of [
      'job.queued',
      'job.started',
      'job.progress',
      'job.succeeded',
      'job.failed',
      'job.cancelled',
      'batch.finished',
    ]) {
      source.addEventListener(name, (message) => this.dispatch((message as MessageEvent<string>).data));
    }

    source.onerror = () => {
      this.setConnected(false);
      // EventSource retries by itself, but a backend restart changes the port,
      // so we rebuild the connection from the current handle instead.
      this.scheduleReconnect();
    };
  }

  private dispatch(raw: string): void {
    let event: BackendEvent;
    try {
      event = JSON.parse(raw) as BackendEvent;
    } catch {
      return;
    }
    if (typeof event.seq === 'number') this.lastSeq = Math.max(this.lastSeq, event.seq);
    for (const handler of this.handlers) handler(event);
  }

  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.start(), 2000);
  }

  private setConnected(connected: boolean): void {
    for (const handler of this.connectedHandlers) handler(connected);
  }

  stop(): void {
    window.clearTimeout(this.reconnectTimer);
    this.source?.close();
    this.source = null;
  }
}

export const eventStream = new EventStream();
