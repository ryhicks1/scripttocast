/**
 * Next.js signals control flow by throwing. `redirect()` and `notFound()` throw
 * to unwind, and reading `cookies()` throws during static generation so the
 * framework learns the route must be rendered dynamically.
 *
 * These are not failures, and catching them breaks rendering — a swallowed
 * DYNAMIC_SERVER_USAGE looks exactly like the service being down. Any catch
 * block wrapping a framework call should re-throw when this returns true.
 *
 * Detected via the `digest` marker rather than `isDynamicServerError`, which is
 * only reachable through a private import path.
 */
export function isFrameworkControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return false;
  return digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_");
}
