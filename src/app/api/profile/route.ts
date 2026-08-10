/* GET/PATCH /api/profile — profile + preferences (wake word, equipment,
   eating window, preferred workout time). PATCH merges into preferences. */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { queryOne } from "@/lib/db";

export const GET = route(async () => {
  const profile = await queryOne(`select * from user_profile limit 1`);
  return json({ profile });
});

const schema = z.object({
  name: z.string().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = route(async (req) => {
  const b = schema.parse(await req.json());
  const profile = await queryOne(
    `update user_profile set
       name = coalesce($1, name),
       preferences = preferences || coalesce($2::jsonb, '{}'::jsonb),
       updated_at = now()
     returning *`,
    [b.name ?? null, b.preferences ? JSON.stringify(b.preferences) : null]
  );
  return json({ profile });
});
