# Parenting team naming

**Decision (John Tozer, 2026-09-27):** User-facing product language is **Parenting team** (and natural variants such as "your parenting team", "Parenting team name").

## What stays `household` in code

Database tables (`households`, `household_members`, `household_invites`), column names (`household_id`), RPCs (`create_household`, `is_household_member`, …), Storage path conventions, and TypeScript identifiers (`Household`, `householdId`, …) keep the `household_*` names. Renaming them would touch every migration, RLS policy, and foreign key.

Only **labels, empty states, invites, banners, and other copy** shown to people use Parenting team.

## Membership roles

Stored on `household_members.role` (snake_case). Display labels:

| Key | Label |
| --- | --- |
| `parent` | Parent |
| `caregiver` | Caregiver |
| `legal` | Legal |
| `kid` | Kid |
| `grandparent` | Grandparent |
| `family_member` | Family member |

Migration `010_parenting_team_roles.sql` expands the check constraint from `parent|other`, maps existing `other` → `caregiver`, and allows members to update the parenting team name and their own role.

Paste that file in the Supabase SQL Editor after `001` (and ideally after `009`).

## Invite email

Create invite emails the accept link via Resend (`POST /api/invites/send`). See `INVITE-EMAIL-SETUP.md`. Copy link remains the manual fallback.
