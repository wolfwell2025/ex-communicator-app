import { NextResponse } from "next/server";
import {
  checkTone,
  coerceToneContext,
  isToneObjective,
} from "@/lib/tone-check";

export const runtime = "nodejs";

type Body = {
  text?: unknown;
  objective?: unknown;
  context?: unknown;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (typeof body.text !== "string") {
    return NextResponse.json(
      {
        error:
          "Expected { text: string, objective?: string, context?: object }",
      },
      { status: 400 }
    );
  }

  const text = body.text.slice(0, 10000);
  const objective = isToneObjective(body.objective) ? body.objective : undefined;
  const context = coerceToneContext(body.context);
  const result = await checkTone(text, objective, context);

  return NextResponse.json({
    flagged: result.flagged,
    ...(result.severity ? { severity: result.severity } : {}),
    warning: result.warning,
    suggestion: result.suggestion,
    ...(result.objective ? { objective: result.objective } : {}),
  });
}
