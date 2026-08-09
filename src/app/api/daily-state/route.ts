/* POST /api/daily-state — subjective energy/hunger/soreness/pain sliders */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { queryOne, todayLocal } from "@/lib/db";
import { refreshTodayRecovery } from "@/lib/recovery";

const schema = z.object({
  date: z.string().optional(),
  energy: z.number().int().min(1).max(10).optional(),
  hunger: z.number().int().min(1).max(10).optional(),
  soreness: z.number().int().min(1).max(10).optional(),
  stress: z.number().int().min(1).max(10).optional(),
  mood: z.string().optional(),
  notes: z.string().optional(),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  const date = b.date ?? todayLocal();
  const row = await queryOne(
    `insert into daily_states (date, energy, hunger, soreness, stress, mood, notes, source)
     values ($1,$2,$3,$4,$5,$6,$7,'manual')
     on conflict (date) do update set
       energy=coalesce(excluded.energy, daily_states.energy),
       hunger=coalesce(excluded.hunger, daily_states.hunger),
       soreness=coalesce(excluded.soreness, daily_states.soreness),
       stress=coalesce(excluded.stress, daily_states.stress),
       mood=coalesce(excluded.mood, daily_states.mood),
       notes=coalesce(excluded.notes, daily_states.notes),
       updated_at=now()
     returning *`,
    [date, b.energy ?? null, b.hunger ?? null, b.soreness ?? null,
     b.stress ?? null, b.mood ?? null, b.notes ?? null]
  );
  const recovery = await refreshTodayRecovery(date);
  return json({ daily_state: row, recovery });
});
