import { NextResponse } from "next/server";
import {
  generateFromReference,
  parseSelectedRecord,
  recordHasUsableFacts,
} from "@/lib/reference-generate";

export const runtime = "nodejs";

type Body = {
  kind?: unknown;
  record?: unknown;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = parseSelectedRecord(body.kind, body.record);
  if (!record) {
    return NextResponse.json(
      {
        error:
          "Expected { kind: 'message'|'calendar'|'document'|'call', record: object with real fields }",
      },
      { status: 400 }
    );
  }

  if (!recordHasUsableFacts(record)) {
    return NextResponse.json(
      {
        error:
          "Selected record has no usable fields. Add real data before generating.",
        suggestion: "",
        facts: [],
      },
      { status: 422 }
    );
  }

  const result = await generateFromReference(record);

  if (!result.suggestion) {
    return NextResponse.json(
      {
        error: "Could not generate a message from the selected record.",
        suggestion: "",
        facts: result.facts,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    suggestion: result.suggestion,
    facts: result.facts,
    source: result.source,
    kind: record.kind,
  });
}
