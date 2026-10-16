// Harness probe endpoint (branch harness-probe). GET returns readiness only and makes no Qloo call.
// With HARNESS_PROBE_ROUTE=1 on the server, `?q=<concept>` also runs the harness find_tags workflow,
// which proves the bundled harness executes inside the Next.js server. Not meant for production as is.
import { findTags, harnessReadiness } from "@/lib/qloo-harness";

export const maxDuration = 60;

export async function GET(request: Request) {
  // Reading the request first keeps this handler request-time (Cache Components would otherwise prerender it).
  const q = new URL(request.url).searchParams.get("q")?.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80);
  const readiness = await harnessReadiness();
  if (process.env.HARNESS_PROBE_ROUTE === "1" && q) {
    return Response.json({ readiness, find_tags: await findTags({ query: q, limit: 5 }, { timeoutMs: 20_000 }) });
  }
  return Response.json(readiness, { headers: { "cache-control": "no-store" } });
}
