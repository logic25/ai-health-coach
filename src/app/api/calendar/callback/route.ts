/* GET /api/calendar/callback — OAuth code exchange, then back to Today */
import { NextResponse } from "next/server";
import { route, json } from "@/lib/api";
import { exchangeCode, syncEvents } from "@/lib/calendar";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return json({ error: "missing code" }, { status: 400 });
  await exchangeCode(code);
  try { await syncEvents(7); } catch { /* sync on next use */ }
  return NextResponse.redirect(new URL("/", url.origin));
});
