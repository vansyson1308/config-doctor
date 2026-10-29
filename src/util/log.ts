// Structured logging to Forge logs (viewable with `forge logs`). Never logs secrets or payload bodies.
function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export const log = {
  info(message: string, data?: Record<string, unknown>): void {
    console.info(JSON.stringify({ level: 'info', message, ...data }));
  },
  error(message: string, err?: unknown): void {
    console.error(JSON.stringify({ level: 'error', message, error: err === undefined ? undefined : describe(err) }));
  },
};
