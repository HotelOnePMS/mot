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

## Editing the folio (`folio.edit`)

The owner (and platform admins) can change **anything on a folio** from the reservation page: the room line's description and amount, each tax or fee, extra charges (add, change, remove, with a date), allowances (amount and reason), and payments recorded at the desk (cash, the hotel's own terminal, paid another way: amount, what was handed back, method, date, note, or remove it). Card payments through Stripe keep Stripe's amount and date (give money back with Refund); only their note changes. The room and its charges are written back to the booking (subtotal = room, total = room + charges), so balances, payment status, reports and check-out all follow. A change made against a line someone else changed meanwhile is refused (409). Cancelled and no-show stays can't be edited (reinstate first).

*Set a total…* makes several lines come to one amount ("room and tax together $50"): the room and percentage taxes share it in proportion (a 12% tax stays 12% of the room), fixed fees keep theirs, and the room line takes the rounding so it adds up to the cent. The agent does the same with `edit_folio`, through a plan the person confirms.

Every change is in the activity log as `FOLIO_EDIT`, with who, what it was before and after, and the optional reason.

**Usual charges** (*Settings → Usual charges*): a hotel's regular extras with their price, per stay, per night or each ("Pet fee", $50 per stay). Whoever has `charges.manage` (managers and owners) or `folio.edit` at the hotel can change the list; anyone who can see folios sees it. The folio's *Add charge* dialog offers them and can save a new one ("Remember this price"); the agent uses them for a charge asked for by name, and "pet fee is always $50" saves or changes one (after the person confirms). Changes are logged as `SAVED_CHARGE_CREATED` / `_UPDATED` / `_DELETED`.

## Disputes (`disputes.view`, `disputes.manage`)

Owners, managers and platform admins see card disputes (`/admin/disputes`) and the evidence for them, and can ask the agent to prepare the document for a dispute or a chargeback reported outside Stripe. Only owners and platform admins (`disputes.manage`) submit evidence to Stripe, from the page or by confirming the agent's plan; the step is checked again when it runs and is logged as `DISPUTE_EVIDENCE_SUBMITTED`. Front desk and housekeepers don't see disputes, and the agent doesn't describe a dispute on screen to them.

## The agent's tools

Each of the agent's tools needs the permission of the screen it stands in for, checked when the step is planned and again, as the person confirming, when it runs: the logs need `activity.view` (the channel sync log also `channels.view`); recording a payment `payments.collect`; a refund `payments.refund` (and `folio.adjust` to also lower what the stay costs); the card authorization form `booking.cardAuth`; the do-not-rent list `dnr.view` to check and `dnr.manage` to change; guest messages `requests.view`; the night audit `audit.run`; a room type's settings `inventory.write`; channel status `channels.view`. When a role can't, the agent says who can instead of looking for another way.

## Owner-granted permissions (Settings → Permissions)

Owners can give other roles, **at their own hotel only**, permissions that are owner-only by default. The list is fixed in code (`GRANTABLE_PERMISSIONS` in `src/server/authz.ts`, with the roles each can go to); today it is `folio.edit` for managers and the front desk. Grants are stored per hotel and role (`RolePermissionGrant`), checked with `canAtProperty` / `requirePropertyPermission`, and sent to the console per hotel (`StaffProperty.grantedPermissions`, so `can()` reflects them). Giving or taking one back is logged as `PERMISSION_GRANT` / `PERMISSION_REVOKE`. Only owners and platform admins (`permissions.manage`) can change them.

## Free-text PMS driving (`bridge.use`)

`bridge.use` lets someone send free-text instructions to the hotel's own PMS through the connected browser/MCP session, which acts with the hotel's PMS login and bypasses HotelOne's per-action roles. It is **owner/manager/admin only** by default, and so is the *Your PMS* page (`/admin/connect`). The front-desk agent at PMS-bridge hotels will say it can't send work to the PMS. To give a specific front-desk role this access, add `'FRONT_DESK'` to `bridge.use` in `PERMISSIONS` and to `/admin/connect` in `CONSOLE_ACCESS` (or, once it is in `GRANTABLE_PERMISSIONS`, an owner can allow it under Settings → Permissions).

## Reports (`reports.view`)

Front desk, managers, owners and platform admins can run reports at `/admin/reports` (also linked from the front desk): arrivals, departures, in house, cancellations and no-shows, occupancy, revenue, or a custom report with their own dates, filters (status, room type, source, payment method) and columns. Housekeepers can't. Every CSV download is written to the hotel's activity log as `REPORT_EXPORTED` (who, which dates, which columns), because it takes guest details off the system. Saved reports live in the browser of the person who saved them.
