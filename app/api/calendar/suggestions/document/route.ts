import { NextResponse } from "next/server";
import { ensureDocumentSuggestions } from "@/lib/calendar-suggestions";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

/**
 * Ensure date suggestions exist for a document (title/description) and
 * return pending ones for the current user.
 * Body: { documentId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { household, error: hhErr } = await ensureHousehold(supabase);
  if (hhErr || !household) {
    return NextResponse.json(
      { error: hhErr || "No household" },
      { status: 400 }
    );
  }

  let body: { documentId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, title, description, household_id")
    .eq("id", body.documentId)
    .eq("household_id", household.id)
    .maybeSingle();

  if (docErr || !doc) {
    return NextResponse.json(
      { error: docErr?.message || "Document not found" },
      { status: 404 }
    );
  }

  const { suggestions, error } = await ensureDocumentSuggestions(supabase, {
    householdId: household.id,
    userId: user.id,
    documentId: doc.id,
    title: doc.title,
    description: doc.description,
  });

  if (error) {
    const needsMigration =
      error.toLowerCase().includes("calendar_suggestions") ||
      error.toLowerCase().includes("schema cache");
    return NextResponse.json(
      { suggestions: [], error, needsMigration },
      { status: needsMigration ? 200 : 400 }
    );
  }

  return NextResponse.json({ suggestions });
}
