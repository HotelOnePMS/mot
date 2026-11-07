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

## Front desk money

Front desk takes payments and deposits (`payments.collect`), sees the folio (`folio.view`) and runs the guided check-in, including the guest's ID photo (`guestId.view`, every view logged). Check-out needs the balance at zero. Two exceptions are **owner/manager/admin only**, each with a required reason and an audit entry:

- `folio.adjust`: lower what a stay costs with an allowance (service recovery, unused nights, a rate correction), or remove one. A refund can add a matching allowance.
- `booking.checkoutWithBalance`: check a guest out while money is still owed (billed to a company, paying later). What was owed and why is kept with the booking; the balance can still be collected afterwards.

Refunding cards (`payments.refund`) and handing back cash paid toward the stay are owner/manager/admin too.

## Free-text PMS driving (`bridge.use`)

`bridge.use` lets someone send free-text instructions to the hotel's own PMS through the connected browser/MCP session, which acts with the hotel's PMS login and bypasses HotelOne's per-action roles. It is **owner/manager/admin only** by default, and so is the *Your PMS* page (`/admin/connect`). The front-desk agent at PMS-bridge hotels will say it can't send work to the PMS. To give a specific front-desk role this access, add `'FRONT_DESK'` to `bridge.use` in `PERMISSIONS` and to `/admin/connect` in `CONSOLE_ACCESS` (owner-configurable roles arrive in the follow-up permissions PR).
