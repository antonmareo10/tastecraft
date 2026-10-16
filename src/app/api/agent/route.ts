import { genericBaseline, runTastecraft } from "@/lib/agent";
import { acquireLiveRun, clientIp } from "@/lib/limits";
import { encodeLine } from "@/lib/ndjson";
import { qlooConfigured } from "@/lib/qloo";
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
    language: body.language === "Español" ? "Español" : "English",
    followup:
      body.followup && typeof body.followup.question === "string" && body.followup.restaurant?.entity_id
        ? {
            question: clean(body.followup.question, 300),
            restaurant: {
              entity_id: clean(body.followup.restaurant.entity_id, 80),
              name: clean(body.followup.restaurant.name, 80),
              tags: Array.isArray(body.followup.restaurant.tags)
                ? body.followup.restaurant.tags.slice(0, 15).map((t) => clean(t, 40))
                : [],
            },
            playbook_headline: clean(body.followup.playbook_headline, 240) || undefined,
          }
        : undefined,
  };
  if (!req.restaurant || !req.city) {
    return Response.json({ error: "restaurant and city are required" }, { status: 400 });
  }

  const started = Date.now();

  if (process.env.NODE_ENV === "development" && process.env.TASTECRAFT_FIXTURE === "1") {
    const { FIXTURE } = await import("@/dev/fixture");
    const fixtureStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const e of FIXTURE) {
          controller.enqueue(encodeLine(e));
          await new Promise((r) => setTimeout(r, 250));
        }
        controller.enqueue(encodeLine({ type: "done", elapsed_ms: Date.now() - started }));
        controller.close();
      },
    });
    return new Response(fixtureStream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
  }

  if (!qlooConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Live mode is not configured on this server yet. Open one of the recorded real runs instead." },
      { status: 503 },
    );
  }
  const gate = acquireLiveRun(clientIp(request));
  if (!gate.ok) return Response.json({ error: gate.reason }, { status: 429 });

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
      const baseline = (req.followup ? Promise.reject() : genericBaseline(req))
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
      gate.release();
      controller.close();
    },
    cancel() {
      gate.release();
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
