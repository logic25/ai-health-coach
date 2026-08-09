/* POST /api/health/import — Apple Health ingestion endpoint.
   Auth: Authorization: Bearer <HEALTH_IMPORT_TOKEN>.
   Payload schema: docs/apple-health-schema.md */
import { route, json } from "@/lib/api";
import { importHealthPayload } from "@/lib/applehealth";
import { refreshTodayRecovery } from "@/lib/recovery";

export const POST = route(async (req) => {
  const token = process.env.HEALTH_IMPORT_TOKEN;
  const auth = req.headers.get("authorization") ?? "";
  if (!token || auth !== `Bearer ${token}`) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const result = await importHealthPayload(body);
  // refresh today's recovery with the new data
  try { await refreshTodayRecovery(); } catch { /* non-fatal */ }
  return json(result);
});
