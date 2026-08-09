/* POST /api/nutrition/weekly-plan — weekly AI nutritionist.
   Analyzes actual eating patterns + adherence + calendar, generates a food
   plan (meal templates, training/rest-day portions, snacks, backup protein)
   and a store-grouped shopping list.
   GET — latest plan + shopping list. */
import { route, json } from "@/lib/api";
import { query, queryOne, todayLocal, weekStartOf } from "@/lib/db";
import { getLlm, LlmTool } from "@/lib/llm";
import { buildSnapshot, renderSnapshot } from "@/lib/snapshot";

export const GET = route(async () => {
  const list = await queryOne(`select * from shopping_lists order by created_at desc limit 1`);
  const recipes = await query(`select * from recipes order by created_at desc limit 20`);
  const plan = await queryOne(
    `select * from coach_decisions where kind='weekly_plan' order by made_at desc limit 1`
  );
  return json({ shopping_list: list, recipes, plan });
});

const PLAN_TOOL: LlmTool = {
  name: "weekly_food_plan",
  description: "Produce the weekly food plan and shopping list.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "2-3 sentence plan rationale based on observed patterns" },
      meal_templates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            when: { type: "string", description: "e.g. 'first meal', 'post-workout', 'dinner'" },
            items: { type: "array", items: { type: "string" }, description: "foods with portions" },
            approx_kcal: { type: "number" },
            approx_protein_g: { type: "number" },
            training_day_adjustment: { type: "string" },
            rest_day_adjustment: { type: "string" },
          },
          required: ["name", "items", "approx_kcal", "approx_protein_g"],
        },
      },
      snacks: { type: "array", items: { type: "string" } },
      backup_protein: { type: "array", items: { type: "string" } },
      shopping_list: {
        type: "array",
        items: {
          type: "object",
          properties: {
            store: { type: "string", description: "e.g. Costco, Supermarket" },
            category: { type: "string", description: "e.g. Protein, Produce, Dairy" },
            item: { type: "string" },
            quantity: { type: "string" },
          },
          required: ["store", "category", "item"],
        },
      },
    },
    required: ["summary", "meal_templates", "shopping_list"],
  },
};

export const POST = route(async () => {
  const weekStart = weekStartOf(todayLocal());
  const [snapshot, mealHistory, corrections] = await Promise.all([
    buildSnapshot(),
    query(
      `select description, meal_type, kcal, protein_g,
              (eaten_at at time zone $1)::date::text as date
       from meals where status <> 'planned' and eaten_at > now() - interval '14 days'
       order by eaten_at desc limit 60`,
      [process.env.COACH_TZ || "America/New_York"]
    ),
    query(
      `select description, correction_note from meal_items
       where corrected order by updated_at desc limit 10`
    ),
  ]);

  const llm = getLlm();
  const res = await llm.complete({
    system:
      `You are a practical nutritionist planning next week's food for one person. ` +
      `Build around foods they demonstrably eat and enjoy (see history); fill protein gaps; ` +
      `respect calorie/protein targets, training days, eating window, and calendar events. ` +
      `Group the shopping list by store (Costco for bulk staples, Supermarket for the rest unless history suggests otherwise).\n\n` +
      `=== STATE ===\n${renderSnapshot(snapshot)}\n\n=== MEALS LAST 14 DAYS ===\n${JSON.stringify(mealHistory)}\n\n` +
      `=== PORTION CORRECTIONS ===\n${JSON.stringify(corrections)}`,
    messages: [{ role: "user", content: "Generate this week's food plan and shopping list." }],
    tools: [PLAN_TOOL],
    toolChoice: { name: "weekly_food_plan" },
    maxTokens: 3000,
  });

  const call = res.toolCalls.find((c) => c.name === "weekly_food_plan");
  if (!call) return json({ error: "planner returned nothing" }, { status: 500 });
  const plan = call.input;

  const list = await queryOne(
    `insert into shopping_lists (week_start, items, status, notes)
     values ($1,$2,'active',$3) returning *`,
    [weekStart, JSON.stringify(plan.shopping_list ?? []), plan.summary as string]
  );

  // store meal templates as recipes for reuse
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of (plan.meal_templates ?? []) as any[]) {
    await query(
      `insert into recipes (name, description, ingredients, per_serving, tags, source)
       values ($1,$2,$3,$4,$5,'weekly_plan')`,
      [t.name, [t.when, t.training_day_adjustment, t.rest_day_adjustment].filter(Boolean).join(" | "),
       JSON.stringify(t.items ?? []),
       JSON.stringify({ kcal: t.approx_kcal, protein_g: t.approx_protein_g }),
       ["weekly_plan"]]
    );
  }

  await query(
    `insert into coach_decisions (kind, decision, reasoning, context, status)
     values ('weekly_plan', $1, $2, $3, 'proposed')`,
    ["Weekly food plan + shopping list generated", plan.summary as string,
     JSON.stringify({ week_start: weekStart, plan })]
  );

  return json({ plan, shopping_list: list });
});
