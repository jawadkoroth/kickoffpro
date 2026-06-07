import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * KickoffPro observability — per-request correlation context.
 *
 * AsyncLocalStorage gives us request-scoped state without passing
 * a context object through every function call. The middleware
 * wraps each incoming request in `withRequestContext(...)`, so
 * anything invoked during that request (route handler → service
 * → lib → logEvent) automatically picks up the same `request_id`.
 *
 * Outside a request context (e.g. unit tests, server startup,
 * cron-triggered jobs) the getters return `undefined` and callers
 * handle that gracefully.
 */

export interface RequestContext {
  requestId: string;
  /** Optional authenticated user id (set by route handlers when known). */
  actorId?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function setActor(actorId: string | null | undefined): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.actorId = actorId ?? null;
}

/**
 * Opt-in helper for Node route handlers to enter the ALS context
 * using the `x-request-id` header set by `src/middleware.ts`. Any
 * `logEvent()` call inside `fn` auto-attaches the request id. Usage:
 *
 *   export async function POST(req: NextRequest) {
 *     return withRequest(req, async () => handler(req));
 *   }
 *
 * Falls back to a freshly minted id if the header is absent (e.g.
 * direct internal calls that bypass middleware, cron runs).
 */
export function withRequest<T>(
  req: { headers: { get(name: string): string | null } },
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const inbound = req.headers.get('x-request-id');
  const requestId =
    inbound && inbound.length > 0
      ? inbound
      : (() => {
        try {
          return globalThis.crypto.randomUUID().replace(/-/g, '');
        } catch {
          return Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
      })();
  return withRequestContext({ requestId }, fn);
}
