/* GET /api/nutrition/barcode/:code — packaged food lookup (Open Food Facts) */
import { route, json } from "@/lib/api";
import { lookupBarcode } from "@/lib/nutrition/providers";

export const GET = route(async (_req, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const food = await lookupBarcode(code);
  if (!food) return json({ error: "not found" }, { status: 404 });
  return json({ food });
});
