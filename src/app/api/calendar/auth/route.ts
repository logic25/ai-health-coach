/* GET /api/calendar/auth — redirect to Google OAuth consent */
import { NextResponse } from "next/server";
import { route, json } from "@/lib/api";
import { authUrl } from "@/lib/calendar";

export const GET = route(async () => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 424 });
  }
  return NextResponse.redirect(authUrl());
});
