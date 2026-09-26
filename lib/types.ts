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
};

export type MessageWithSender = Message & {
  sender_email: string | null;
  sender_display_name: string | null;
};
