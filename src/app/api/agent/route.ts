import { genericBaseline, runTastecraft } from "@/lib/agent";
import { encodeLine } from "@/lib/ndjson";
import type { AgentEvent, AgentRequest } from "@/lib/types";

export const maxDuration = 300;

function clean(s: unknown, max = 80): string {
  return typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  let body: Partial<AgentRequest>;
  try {
    body = (await request.json()) as Partial<AgentRequest>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const req: AgentRequest = {
    restaurant: clean(body.restaurant),
    city: clean(body.city, 60),
    goal: clean(body.goal, 120) || undefined,
    lens: body.lens
      ? { age: clean(body.lens.age, 20) || undefined, gender: clean(body.lens.gender, 10) || undefined }
      : undefined,
  };
  if (!req.restaurant || !req.city) {
    return Response.json({ error: "restaurant and city are required" }, { status: 400 });
  }

  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeLine(e));
        } catch {
          closed = true;
        }
      };
      const baseline = genericBaseline(req)
        .then((text) => emit({ type: "baseline", text }))
        .catch(() => undefined);
      try {
        await runTastecraft(req, emit, request.signal);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Unexpected error" });
      }
      await baseline;
      emit({ type: "done", elapsed_ms: Date.now() - started });
      closed = true;
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
