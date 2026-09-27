export type HouseholdRole = "parent" | "other";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
};

export type Household = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
};

export type HouseholdMember = {
  household_id: string;
  user_id: string;
  role: HouseholdRole;
  created_at: string;
};

export type Message = {
  id: string;
  household_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  thread_id: string | null;
};

export type MessageWithSender = Message & {
  sender_email: string | null;
  sender_display_name: string | null;
};

export type MessageThread = {
  id: string;
  household_id: string;
  subject: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ThreadParticipant = {
  thread_id: string;
  user_id: string;
  created_at: string;
};

export type HouseholdMemberProfile = {
  user_id: string;
  role: HouseholdRole;
  email: string | null;
  display_name: string | null;
};

export type ThreadListItem = MessageThread & {
  participants: HouseholdMemberProfile[];
  last_message: MessageWithSender | null;
  message_count: number;
  /** Lowercased bodies joined for client search. */
  search_text: string;
};

export type CalendarEventType =
  | "parenting_time"
  | "school"
  | "medical"
  | "activity"
  | "other";

/** private = only creator; pending = proposed (not on shared grid); shared = household-visible */
export type CalendarVisibility = "private" | "pending" | "shared";

export type CalendarEventSource =
  | "manual"
  | "google"
  | "apple"
  | "outlook"
  | "other";

export type CalendarEvent = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  event_type: CalendarEventType;
  visibility: CalendarVisibility;
  proposed_at: string | null;
  proposed_by: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  source: CalendarEventSource;
  external_id: string | null;
  connection_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PersonalCalendarProvider = "google" | "apple" | "outlook" | "other";

export type PersonalCalendarConnectionStatus =
  | "disconnected"
  | "pending"
  | "connected"
  | "error";

/**
 * One row per selected calendar (personal / work / family shared, etc.).
 * Imported events are always private until explicitly proposed in-app.
 */
export type PersonalCalendarConnection = {
  id: string;
  user_id: string;
  provider: PersonalCalendarProvider;
  status: PersonalCalendarConnectionStatus;
  label: string | null;
  /** Inbound import from Google (default on). */
  sync_enabled: boolean;
  /** Outbound push of app-owned events (default off, opt-in). */
  export_enabled: boolean;
  /** Granted OAuth scopes string; used to detect missing write access. */
  scopes: string | null;
  external_account_email: string | null;
  external_calendar_id: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CalendarSuggestionStatus = "pending" | "accepted" | "dismissed";

export type CalendarSuggestionSourceType = "message" | "document";

export type CalendarSuggestion = {
  id: string;
  household_id: string;
  source_type: CalendarSuggestionSourceType;
  source_key: string;
  source_ids: string[];
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: CalendarSuggestionStatus;
  suggested_visibility: "private" | "pending";
  created_for: string;
  proposer_id: string | null;
  event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type HouseholdInviteStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export type HouseholdInvite = {
  id: string;
  household_id: string;
  email: string;
  email_normalized: string;
  token: string;
  invited_by: string;
  status: HouseholdInviteStatus;
  created_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  expires_at: string;
};

export type HouseholdInvitePeek = {
  id: string;
  household_id: string;
  household_name: string;
  email: string;
  status: HouseholdInviteStatus;
  expires_at: string;
  invited_by_label: string;
};

export type DocumentCategory =
  | "decree"
  | "school"
  | "medical"
  | "legal"
  | "expense"
  | "other";

/** private = uploader only; pending = proposed; shared = household vault */
export type DocumentVisibility = "private" | "pending" | "shared";

export type HouseholdDocument = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  category: DocumentCategory;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  visibility: DocumentVisibility;
  proposed_at: string | null;
  proposed_by: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};

export type ExpenseCategory =
  | "medical"
  | "school"
  | "activity"
  | "childcare"
  | "clothing"
  | "other";

export type ExpenseStatus =
  | "draft"
  | "requested"
  | "accepted"
  | "declined"
  | "paid"
  | "canceled";

export type Expense = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  category: ExpenseCategory;
  amount_cents: number;
  currency: string;
  incurred_on: string;
  requester_id: string;
  share_cents: number;
  status: ExpenseStatus;
  document_id: string | null;
  requested_at: string | null;
  responded_at: string | null;
  responded_by: string | null;
  paid_at: string | null;
  paid_noted_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseWithDocument = Expense & {
  document_title?: string | null;
  document_file_name?: string | null;
};
