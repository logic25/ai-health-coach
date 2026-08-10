/* GET/POST /api/admin/setup — initialize the database (migrations + seed)
   right after deploying, straight from the phone browser:

     https://<your-app>/api/admin/setup?token=<HEALTH_IMPORT_TOKEN>

   Idempotent: re-running applies only new migrations and never duplicates
   seed data. GET is allowed (with the token) purely so it works from a
   phone address bar. */
import { route, json } from "@/lib/api";
import { runMigrations, runSeed } from "@/lib/setup";

async function handle(req: Request): Promise<Response> {
  const token = process.env.HEALTH_IMPORT_TOKEN;
  const url = new URL(req.url);
  const supplied =
    url.searchParams.get("token") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || supplied !== token) {
    return json({ error: "unauthorized — pass ?token=<HEALTH_IMPORT_TOKEN>" }, { status: 401 });
  }
  const migrations = await runMigrations();
  const seed = await runSeed();
  return json({
    ok: true,
    migrations_applied: migrations,
    seed,
    next: "Open the app root and add it to your home screen.",
  });
}

export const GET = route(handle);
export const POST = route(handle);
