import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DocumentCategory,
  DocumentVisibility,
  HouseholdDocument,
} from "./types";

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  decree: "Decree / order",
  school: "School",
  medical: "Medical",
  legal: "Legal",
  expense: "Expense / receipt",
  other: "Other",
};

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "decree",
  "school",
  "medical",
  "legal",
  "expense",
  "other",
];

export const DOCUMENT_VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  private: "Private (only you)",
  pending: "Proposed (awaiting accept)",
  shared: "Shared with parenting team",
};

/** Categories that default to shared on upload (decree vault use-case). */
export const SHARED_BY_DEFAULT_CATEGORIES: DocumentCategory[] = [
  "decree",
  "school",
  "medical",
  "legal",
];

export const DOCUMENTS_BUCKET = "documents";
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MiB

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const SELECT_COLS =
  "id, household_id, title, description, category, file_path, file_name, mime_type, size_bytes, visibility, proposed_at, proposed_by, accepted_at, accepted_by, uploaded_by, created_at, updated_at";

function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, "_").trim() || "file";
  return base.slice(0, 180);
}

export function buildStoragePath(
  householdId: string,
  userId: string,
  fileName: string
): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${householdId}/${userId}/${id}-${sanitizeFileName(fileName)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function listDocuments(
  supabase: SupabaseClient,
  householdId: string,
  options?: { category?: DocumentCategory | "all" }
): Promise<{ documents: HouseholdDocument[]; error: string | null }> {
  let query = supabase
    .from("documents")
    .select(SELECT_COLS)
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });

  if (options?.category && options.category !== "all") {
    query = query.eq("category", options.category);
  }

  const { data, error } = await query;
  if (error) {
    return { documents: [], error: error.message };
  }
  return { documents: (data ?? []) as HouseholdDocument[], error: null };
}

/** Shared docs only — for Reference picker / tone context. */
export async function listSharedDocuments(
  supabase: SupabaseClient,
  householdId: string,
  options?: { limit?: number }
): Promise<{ documents: HouseholdDocument[]; error: string | null }> {
  let query = supabase
    .from("documents")
    .select(SELECT_COLS)
    .eq("household_id", householdId)
    .eq("visibility", "shared")
    .order("created_at", { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) {
    return { documents: [], error: error.message };
  }
  return { documents: (data ?? []) as HouseholdDocument[], error: null };
}

export type UploadDocumentInput = {
  title: string;
  description?: string | null;
  category: DocumentCategory;
  file: File;
  /** Default shared for decree vault; set true to keep private until propose. */
  keepPrivate?: boolean;
};

export async function uploadDocument(
  supabase: SupabaseClient,
  args: {
    householdId: string;
    userId: string;
    input: UploadDocumentInput;
  }
): Promise<{ document: HouseholdDocument | null; error: string | null }> {
  const title = args.input.title.trim();
  if (!title) {
    return { document: null, error: "Title is required." };
  }
  const file = args.input.file;
  if (!file || file.size <= 0) {
    return { document: null, error: "Choose a file to upload." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      document: null,
      error: `File is too large (max ${formatFileSize(MAX_DOCUMENT_BYTES)}).`,
    };
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return {
      document: null,
      error:
        "File type not allowed. Use PDF, image, Word, Excel, CSV, or plain text.",
    };
  }

  const visibility: DocumentVisibility = args.input.keepPrivate
    ? "private"
    : "shared";
  const filePath = buildStoragePath(
    args.householdId,
    args.userId,
    file.name || "document"
  );

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(filePath, file, {
      contentType: mime,
      upsert: false,
    });

  if (uploadError) {
    return { document: null, error: uploadError.message };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("documents")
    .insert({
      household_id: args.householdId,
      uploaded_by: args.userId,
      title,
      description: args.input.description?.trim() || null,
      category: args.input.category,
      file_path: filePath,
      file_name: sanitizeFileName(file.name || "document"),
      mime_type: mime,
      size_bytes: file.size,
      visibility,
      accepted_at: visibility === "shared" ? now : null,
      accepted_by: visibility === "shared" ? args.userId : null,
    })
    .select(SELECT_COLS)
    .single();

  if (error) {
    // Best-effort cleanup of orphaned storage object
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    return { document: null, error: error.message };
  }
  return { document: data as HouseholdDocument, error: null };
}

export async function deleteDocument(
  supabase: SupabaseClient,
  doc: HouseholdDocument,
  userId: string
): Promise<{ error: string | null }> {
  if (doc.uploaded_by !== userId) {
    return { error: "Only the uploader can delete this document." };
  }
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
  if (error) {
    return { error: error.message };
  }
  const { error: storageError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .remove([doc.file_path]);
  // Row is gone; surface storage cleanup failure but do not block UX
  if (storageError) {
    return { error: null };
  }
  return { error: null };
}

export async function getDocumentDownloadUrl(
  supabase: SupabaseClient,
  filePath: string,
  expiresIn = 120
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, expiresIn);
  if (error) {
    return { url: null, error: error.message };
  }
  return { url: data?.signedUrl ?? null, error: null };
}

export async function proposeDocument(
  supabase: SupabaseClient,
  documentId: string,
  userId: string
): Promise<{ document: HouseholdDocument | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("documents")
    .update({
      visibility: "pending",
      proposed_at: now,
      proposed_by: userId,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", documentId)
    .eq("uploaded_by", userId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { document: null, error: error.message };
  }
  return { document: data as HouseholdDocument, error: null };
}

export async function cancelDocumentProposal(
  supabase: SupabaseClient,
  documentId: string,
  userId: string
): Promise<{ document: HouseholdDocument | null; error: string | null }> {
  const { data, error } = await supabase
    .from("documents")
    .update({
      visibility: "private",
      proposed_at: null,
      proposed_by: null,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", documentId)
    .eq("uploaded_by", userId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { document: null, error: error.message };
  }
  return { document: data as HouseholdDocument, error: null };
}

export async function acceptDocument(
  supabase: SupabaseClient,
  documentId: string,
  userId: string
): Promise<{ document: HouseholdDocument | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("documents")
    .update({
      visibility: "shared",
      accepted_at: now,
      accepted_by: userId,
    })
    .eq("id", documentId)
    .eq("visibility", "pending")
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { document: null, error: error.message };
  }
  return { document: data as HouseholdDocument, error: null };
}

export async function declineDocument(
  supabase: SupabaseClient,
  documentId: string
): Promise<{ document: HouseholdDocument | null; error: string | null }> {
  const { data, error } = await supabase
    .from("documents")
    .update({
      visibility: "private",
      proposed_at: null,
      proposed_by: null,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", documentId)
    .eq("visibility", "pending")
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { document: null, error: error.message };
  }
  return { document: data as HouseholdDocument, error: null };
}

export async function unshareDocument(
  supabase: SupabaseClient,
  documentId: string,
  userId: string
): Promise<{ document: HouseholdDocument | null; error: string | null }> {
  const { data, error } = await supabase
    .from("documents")
    .update({
      visibility: "private",
      proposed_at: null,
      proposed_by: null,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", documentId)
    .eq("uploaded_by", userId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { document: null, error: error.message };
  }
  return { document: data as HouseholdDocument, error: null };
}

/** Docs shown in the main vault list for this user. */
export function documentsForVaultList(
  documents: HouseholdDocument[],
  userId: string
): HouseholdDocument[] {
  return documents.filter(
    (d) =>
      d.visibility === "shared" ||
      (d.uploaded_by === userId &&
        (d.visibility === "private" || d.visibility === "pending"))
  );
}

/** Pending proposals from others awaiting accept/decline. */
export function incomingDocumentShareRequests(
  documents: HouseholdDocument[],
  userId: string
): HouseholdDocument[] {
  return documents.filter(
    (d) => d.visibility === "pending" && d.uploaded_by !== userId
  );
}

/** Map shared DB rows to reference-picker / tone-context shape. */
export function documentsToPickerItems(documents: HouseholdDocument[]) {
  return documents
    .filter((d) => d.visibility === "shared")
    .map((d) => ({
      id: d.id,
      title: d.title,
      kindLabel: DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category,
      updatedAt: d.updated_at,
      snippet: d.description,
    }));
}
