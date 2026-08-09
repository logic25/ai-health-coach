/* GET /api/photos/:id — full image */
import { route, json } from "@/lib/api";
import { queryOne } from "@/lib/db";

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const row = await queryOne(`select url from progress_photos where id=$1`, [id]);
  if (!row) return json({ error: "not found" }, { status: 404 });
  const m = /^data:([^;]+);base64,(.+)$/.exec(row.url);
  if (!m) return json({ url: row.url });
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=3600" },
  });
});
