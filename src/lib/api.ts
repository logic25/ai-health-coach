import { NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: any) => Promise<Response>;

/** Wrap a route handler with uniform error handling. */
export function route(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}:`, e);
      const message = e instanceof Error ? e.message : "internal error";
      const status = message.includes("not connected") || message.includes("No LLM") ? 424 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export function json(data: unknown, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}
