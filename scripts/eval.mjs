// Ablation eval: the same model with and without Qloo, on real restaurants.
// Usage: node scripts/eval.mjs [baseUrl] [limit]
// Requires the app running with live keys (ANTHROPIC_API_KEY, QLOO_API_KEY).
// Writes eval/results.local.json (contains Qloo-derived names: NOT committed) and eval/JUDGE_SUMMARY.md (aggregates only).
// Optional and costly (a full agent run per restaurant); the committed benchmark is scripts/benchmark.ts.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const baseUrl = process.argv[2] || "http://localhost:3000";
const limit = Number(process.argv[3] || 10);
const restaurants = JSON.parse(fs.readFileSync(new URL("../eval/restaurants.json", import.meta.url), "utf8")).slice(0, limit);
const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const MODEL = env.TASTECRAFT_MODEL || "claude-opus-5-5";

async function runAgent(r) {
  const res = await fetch(`${baseUrl}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(r),
  });
  if (!res.ok) throw new Error(`agent ${res.status}: ${await res.text()}`);
  const events = [];
  const dec = new TextDecoder();
  let buf = "";
  for await (const ch of res.body) {
    buf += dec.decode(ch, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) events.push(JSON.parse(line));
    }
  }
  return events;
}

function playbookText(pb) {
  return [
    pb.headline,
    ...pb.menu_moves.map((m) => `${m.dish}: ${m.description} Why: ${m.why} Evidence: ${m.evidence.map((e) => e.text).join("; ")}`),
    `Event: ${pb.experience.event_idea}. ${pb.experience.event_why}`,
    `Marketing: ${pb.marketing.instagram_post}`,
  ].join("\n");
}

// Blind pairwise judgment with randomized order.
async function judge(r, generic, grounded) {
  const flip = Math.random() < 0.5;
  const [a, b] = flip ? [grounded, generic] : [generic, grounded];
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: `You are an experienced restaurant consultant judging two plans for "${r.restaurant}" in ${r.city} (owner's goal: ${r.goal}).
Score each plan 1-10 on: specificity to THIS restaurant and its actual audience (not advice any restaurant could get), evidence (concrete, checkable facts), and actionability for next week. Then pick the better plan overall.
Reply with JSON only: {"A":{"specificity":n,"evidence":n,"actionability":n},"B":{...},"winner":"A"|"B","reason":"<20 words"}

PLAN A:
${a}

PLAN B:
${b}`,
      },
    ],
  });
  const text = msg.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const groundedKey = flip ? "A" : "B";
  const genericKey = flip ? "B" : "A";
  return {
    grounded: j[groundedKey],
    generic: j[genericKey],
    groundedWins: j.winner === groundedKey,
    reason: j.reason,
  };
}

const results = [];
for (const r of restaurants) {
  process.stdout.write(`\n${r.restaurant}, ${r.city} … `);
  try {
    const t0 = Date.now();
    const events = await runAgent(r);
    const pb = events.find((e) => e.type === "playbook")?.playbook;
    const baseline = events.find((e) => e.type === "baseline")?.text;
    const errors = events.filter((e) => e.type === "tool_end" && e.error).length;
    if (!pb || !baseline) throw new Error("missing playbook or baseline");
    const j = await judge(r, baseline, playbookText(pb));
    results.push({
      ...r,
      seconds: Math.round((Date.now() - t0) / 1000),
      tool_errors: errors,
      verification: pb.verification,
      judge: j,
    });
    process.stdout.write(`verified ${pb.verification?.verified}/${pb.verification?.checked}, grounded wins: ${j.groundedWins}`);
  } catch (err) {
    results.push({ ...r, error: String(err) });
    process.stdout.write(`ERROR ${err}`);
  }
}

fs.mkdirSync(new URL("../eval/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../eval/results.local.json", import.meta.url), JSON.stringify(results, null, 1));

const ok = results.filter((r) => !r.error);
const sum = (f) => ok.reduce((s, r) => s + f(r), 0);
const avg = (f) => (ok.length ? sum(f) / ok.length : 0);
const checked = sum((r) => r.verification?.checked ?? 0);
const verified = sum((r) => r.verification?.verified ?? 0);
const summary = `# Tastecraft ablation eval

Same model (${MODEL}), same restaurant and goal: **with Qloo** (Tastecraft agent) vs **without Qloo** (no tools).
Run on ${new Date().toISOString().slice(0, 10)} over ${ok.length} restaurants (${results.length - ok.length} failed). Blind pairwise judging with randomized order.

| Metric | Without Qloo | With Qloo (Tastecraft) |
|---|---|---|
| Specificity to the restaurant (1-10) | ${avg((r) => r.judge.generic.specificity).toFixed(1)} | ${avg((r) => r.judge.grounded.specificity).toFixed(1)} |
| Evidence (1-10) | ${avg((r) => r.judge.generic.evidence).toFixed(1)} | ${avg((r) => r.judge.grounded.evidence).toFixed(1)} |
| Actionability (1-10) | ${avg((r) => r.judge.generic.actionability).toFixed(1)} | ${avg((r) => r.judge.grounded.actionability).toFixed(1)} |
| Preferred overall | ${ok.filter((r) => !r.judge.groundedWins).length} / ${ok.length} | ${ok.filter((r) => r.judge.groundedWins).length} / ${ok.length} |
| Evidence lines whose cited Qloo names and scores match the run's live responses | n/a | ${verified} / ${checked} (${checked ? Math.round((verified / checked) * 100) : 0}%) |
| Avg. run time | — | ${Math.round(avg((r) => r.seconds))} s |

Raw per-restaurant results contain Qloo-derived data and are kept out of the public repository.
`;
fs.writeFileSync(new URL("../eval/JUDGE_SUMMARY.md", import.meta.url), summary);
console.log("\n\n" + summary);
