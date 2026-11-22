export const dynamic = 'force-dynamic';

/** Liveness probe for the web app. */
export function GET(): Response {
  return Response.json({ status: 'ok' });
}
