// Tastecraft as an MCP server, so existing agents (Claude Desktop, Cursor, a POS assistant…)
// can ask for a restaurant's taste profile or a full playbook.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { runTastecraft } from "@/lib/agent";
import { acquireLiveRun, describeLiveFailure } from "@/lib/limits";
import { qlooConfigured } from "@/lib/qloo";
import { audienceAffinity, audienceDemographics, findRestaurant, resolveRestaurant, tasteTags } from "@/lib/qloo-tasks";
import type { AgentEvent, Playbook } from "@/lib/types";

export const maxDuration = 300;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "taste_profile",
      {
        title: "Restaurant taste profile",
        description:
          "Fast, no-LLM taste profile of a restaurant's audience from Qloo: the restaurant entity (with how sure the match is and alternatives), local places, artists and brands its guests love (with 0-100 affinity), dishes/cuisines/vibes they over-index on, and their age/gender skew. Scores are aggregate tendencies, not predictions about individual guests. If the match is ambiguous, show the alternatives to the user and call again with entity_id.",
        inputSchema: z.object({
          restaurant: z.string().min(2).max(80),
          city: z.string().min(2).max(60),
          entity_id: z.string().max(64).optional(),
        }),
      },
      async ({ restaurant, city, entity_id }) => {
        if (!qlooConfigured()) return fail("Qloo is not configured on this server.");
        const { selected: match, resolution } = resolveRestaurant(restaurant, city, await findRestaurant(restaurant, city), entity_id);
        if (!match) return fail(`No Qloo match for ${restaurant} in ${city}.`);
        const ids = [match.entity_id];
        const [places, artists, brands, dishes, cuisines, vibe, demographics] = await Promise.all([
          audienceAffinity({ entityIds: ids, domain: "place", city, take: 10 }),
          audienceAffinity({ entityIds: ids, domain: "artist", city, take: 10 }),
          audienceAffinity({ entityIds: ids, domain: "brand", city, take: 10 }),
          tasteTags({ entityId: match.entity_id, city, family: "dishes", take: 10 }).catch(() => []),
          tasteTags({ entityId: match.entity_id, city, family: "cuisines", take: 10 }).catch(() => []),
          tasteTags({ entityId: match.entity_id, city, family: "ambience", take: 10 }).catch(() => []),
          audienceDemographics(match.entity_id).catch(() => null),
        ]);
        const pct = (a?: number) => (a == null ? null : Math.round(a * 100));
        return text({
          restaurant: { entity_id: match.entity_id, name: match.name, address: match.subtitle, tags: match.all_tags.slice(0, 12) },
          match: { status: resolution.status, how: resolution.match, alternatives: resolution.alternatives },
          guests_also_love: {
            places: places.map((e) => ({ name: e.name, affinity: pct(e.affinity) })),
            artists: artists.map((e) => ({ name: e.name, affinity: pct(e.affinity) })),
            brands: brands.map((e) => ({ name: e.name, affinity: pct(e.affinity) })),
          },
          cravings: {
            dishes: dishes.map((t) => ({ name: t.name, affinity: pct(t.affinity) })),
            cuisines: cuisines.map((t) => ({ name: t.name, affinity: pct(t.affinity) })),
            vibe: vibe.map((t) => ({ name: t.name, affinity: pct(t.affinity) })),
          },
          demographics,
          source: "Qloo Insights API (aggregated, privacy-first taste signals)",
        });
      },
    );

    server.registerTool(
      "taste_playbook",
      {
        title: "Full taste playbook",
        description:
          "Runs the Tastecraft agent (Qloo + Claude, ~1 minute): menu moves with verified evidence, an event, local marketing, a supplier shopping list and a 7-day launch plan. Rate-limited.",
        inputSchema: z.object({
          restaurant: z.string().min(2).max(80),
          city: z.string().min(2).max(60),
          entity_id: z.string().max(64).optional(),
          goal: z.string().max(120).optional(),
          language: z.enum(["English", "Español"]).optional(),
        }),
      },
      async ({ restaurant, city, entity_id, goal, language }) => {
        if (!qlooConfigured()) return fail("Qloo is not configured on this server.");
        const gate = acquireLiveRun("mcp");
        if (!gate.ok) return fail(gate.reason);
        let playbook: Playbook | null = null;
        let error: string | null = null;
        try {
          await runTastecraft({ restaurant, city, entity_id, goal, language }, (e: AgentEvent) => {
            if (e.type === "playbook") playbook = e.playbook;
            if (e.type === "error") error = e.message;
          });
        } catch (err) {
          error = describeLiveFailure(err);
        } finally {
          gate.release();
        }
        return playbook ? text(playbook) : fail(error ?? "No playbook was produced.");
      },
    );
  },
  { serverInfo: { name: "tastecraft", version: "1.0.0" } },
);

export { handler as GET, handler as POST };
