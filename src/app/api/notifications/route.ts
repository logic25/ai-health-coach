/* GET /api/notifications | PATCH — dismiss { id } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { query } from "@/lib/db";

export const GET = route(async () => {
  const rows = await query(
    `select * from notifications where dismissed_at is null and due_at <= now()
     order by due_at desc limit 10`
  );
  return json({ notifications: rows });
});

const schema = z.object({ id: z.string() });

export const PATCH = route(async (req) => {
  const b = schema.parse(await req.json());
  await query(`update notifications set dismissed_at=now() where id=$1`, [b.id]);
  return json({ ok: true });
});
