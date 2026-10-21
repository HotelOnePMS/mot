# Roles, access and sessions

Roles (`ADMIN` platform operator, `OWNER`, `MANAGER`, `FRONT_DESK`, `HOUSEKEEPER`) map to permissions in `src/server/authz.ts` (`PERMISSIONS`). Every staff API route and agent tool checks a permission **and** that the property is one the person is assigned to (`UserPropertyAssignment`).

## Rules enforced on team changes (`/api/admin/users`)

- **Owners are protected.** A co-owner cannot change another owner's email, password, role, status, properties or delete them. Only that owner, or a platform admin, can. A change that would leave a hotel with no active owner (demote, deactivate, delete, unassign) is refused for owners; platform admins can override.
- **Every team change is audited** (activity log of each affected property; Activity page): `TEAM_ADD`, `TEAM_ROLE_CHANGE`, `TEAM_PROPERTIES_CHANGE`, `TEAM_ACTIVATE`, `TEAM_DEACTIVATE`, `TEAM_EMAIL_CHANGE`, `TEAM_PASSWORD_RESET` (admin-set, emailed-link, or self-service), `TEAM_UPDATE`, `TEAM_DELETE`. Entries hold actor, target id, and before/after values; passwords and hashes are never stored. A platform-level account with no property is written to the server log instead (no property to attach it to).
- **Duplicate emails**: non-admins get a generic message, so a hotel owner can't probe whether an address has an account.
- **Temporary passwords**: a password chosen by someone else sets `mustChangePassword`. The console redirects to `/account/password` and staff APIs return 403 `PASSWORD_CHANGE_REQUIRED` until the person picks their own.

## Sessions

`User.sessionVersion` is copied into the session token at sign-in. The JWT callback (`src/lib/auth.ts`) re-reads the account on every use and ends the session when the account is missing or inactive, or the version no longer matches. The version is bumped on role, active-status, password (admin set, reset link, self change) and email changes. Google sign-in refuses deactivated accounts.

The middleware (`src/middleware.ts`) only has the cookie, so it is a coarse gate. `src/app/admin/layout.tsx` re-checks the account and role against the database on every full page load, and every API route does on every call. (Next.js does not re-run a layout during client-side navigation, so a stale tab can show a screen shell until its next API call or reload; the data calls are refused.)

## Rooms and housekeeping

Housekeepers may change a room's status only for rooms with an open cleaning task assigned to them or unassigned (same rule as task updates); working an unassigned room claims it.

## Team directory

`users.view` (emails and phone numbers, guests) is owner/manager/admin. Front desk and housekeepers use `/api/admin/team` for assignment pickers: names of the housekeeping team only, no emails.

## Free-text PMS driving (`bridge.use`)

`bridge.use` lets someone send free-text instructions to the hotel's own PMS through the connected browser/MCP session, which acts with the hotel's PMS login and bypasses HotelOne's per-action roles. It is **owner/manager/admin only** by default, and so is the *Your PMS* page (`/admin/connect`). The front-desk agent at PMS-bridge hotels will say it can't send work to the PMS. An owner can give front desk this through the agent on *Setup → Agent access* ("Work in the hotel's own PMS"); the *Your PMS* page itself stays owner/manager.

## Agent access

On *Setup → Agent access* (`/admin/agent-access`, `agent.policy`: owners and platform admins), the owner decides per hotel what managers, front desk and housekeeping may do **through the agent**, in the console and on WhatsApp, and which alerts the always-on agent sends each role (owners choose their own alerts too). Each switch is a group of permissions (`CAPABILITIES` in `src/server/agent/policy.ts`). Only differences from the role defaults are stored (`agent_policies`), so a role keeps following the defaults until someone changes it.

- **How it applies.** An agent run uses `agentActor()`: the person's own role and hotels, narrowed to the one hotel the run is about, with that hotel's grants and revocations attached (`Actor.overrides`). `can()` honours them (revoked beats granted beats role), so every check inside the agent — read tools, write planners, domain services and plan confirmation — follows the switches. Confirmation re-reads them, so a plan made before a switch was turned off can't run after.
- **Limits.** Only permissions on the page can be granted, and only ones owners hold. Owners and platform admins can't be restricted.
- **The console's own screens** keep the plain role rules. Turning a capability off stops it in the agent, not on the classic screens; a housekeeper given the agent uses it on WhatsApp (the console's agent screen stays front desk and up).
- **WhatsApp** needs both *Use the agent* and *Use the agent on WhatsApp* (`whatsapp.use`) at the hotel; a person can link a phone if any of their hotels allows it.
- **Look-ups** use the same permissions as the classic screens (`READ_PERMISSION` in `tools.ts`): occupancy, revenue and forecasts need `analytics.view` (managers and owners unless granted), availability needs `rates.view`, the activity log `activity.view`.
- Every change is in the activity log (`AGENT_ACCESS`), with each switch that changed.
