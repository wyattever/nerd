// frontend/lib/debugLog.ts
//
// Lightweight structured console logger for local debugging.
// Every call is tagged, timestamped, and counted per (tag, event) pair —
// a fast-climbing counter on one event is the signature of a loop.
// Logging only. Does not alter any application state or control flow.

type LogTag = "research" | "sse" | "lists" | "candidate" | "product" | "editor";

const callCounters: Record<string, number> = {};

function nextCount(key: string): number {
  callCounters[key] = (callCounters[key] ?? 0) + 1;
  return callCounters[key];
}

function timestamp(): string {
  return new Date().toISOString().split("T")[1].replace("Z", "");
}

export function debugLog(tag: LogTag, event: string, data?: unknown): void {
  const count = nextCount(`${tag}:${event}`);
  const prefix = `[${timestamp()}] [${tag}] ${event} (#${count})`;
  if (data !== undefined) {
    // eslint-disable-next-line no-console
    console.log(prefix, data);
  } else {
    // eslint-disable-next-line no-console
    console.log(prefix);
  }
}

export function debugWarn(tag: LogTag, event: string, data?: unknown): void {
  const count = nextCount(`${tag}:${event}`);
  const prefix = `[${timestamp()}] [${tag}] ${event} (#${count})`;
  if (data !== undefined) {
    // eslint-disable-next-line no-console
    console.warn(prefix, data);
  } else {
    // eslint-disable-next-line no-console
    console.warn(prefix);
  }
}