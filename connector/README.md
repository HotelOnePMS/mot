# HotelOne Connector

Lets the HotelOne agent (and voice) work a hotel's **existing** PMS — no migration needed.

| Mode | Where it runs | Who signs in to the PMS |
| --- | --- | --- |
| **Desktop** | A front-desk computer at the hotel | Staff, once, in the connector's browser window. Logins never leave the computer. |
| **Cloud** | HotelOne infrastructure (`worker`) | The worker, with a login sealed in the HotelOne vault (AES-256-GCM). The AI never sees it — it asks for a credential and the worker types it. |

## How it works

1. Staff ask the agent something ("check in the Smiths in room 204"). Changes become a plan that a person confirms; look-ups go straight through.
2. The confirmed task is queued for the hotel's connection.
3. The connector claims it, opens the PMS, and loops: **screenshot → HotelOne server → next browser actions**. The computer-use model runs on the HotelOne server; the connector holds no API keys.
4. The result ("DONE: checked in Jordan Smith to 204") shows up live in the agent conversation and on the *Your PMS* page.

Guardrails sent with every task: change only what was asked, never delete reservations, issue refunds, change users or export data, and stop with `NEEDS_HELP` whenever something is ambiguous. Look-up tasks are read-only. Each task stops after 60 steps.

The script lives at `public/downloads/hotelone-connector.mjs` and is served at `/downloads/hotelone-connector.mjs` (the *Your PMS* page links to it).

## Desktop setup

```bash
curl -O https://hotelone.site/downloads/hotelone-connector.mjs
npm i playwright && npx playwright install chromium
# In HotelOne: Your PMS → Desktop connector → Create pairing code
node hotelone-connector.mjs pair ABC234 --server https://hotelone.site --name "Front desk PC"
node hotelone-connector.mjs run
```

Sign in to your PMS in the browser window that opens and leave it running. The pairing token is stored in `~/.hotelone/connector.json` (permissions 600). Disconnect it any time from the console.

## Cloud worker (HotelOne operators)

```bash
HOTELONE_SERVER=https://hotelone.site BRIDGE_WORKER_SECRET=… node hotelone-connector.mjs worker
```

Each task gets a fresh, isolated browser context. Server needs `OPENAI_API_KEY`, `HOTELONE_VAULT_KEY` (or the older `STAYOS_VAULT_KEY`), `BRIDGE_WORKER_SECRET`; optionally `BRIDGE_OPERATOR_MODEL` (default `computer-use-preview`) and `BRIDGE_OPERATOR_TOOL=computer` for the GA computer tool.

## Computers set up before the rename (StayOS)

`hotelone-connector.mjs` is a drop-in replacement for `stayos-connector.mjs`:

- It keeps using an existing `~/.stayos` folder, so the computer stays paired and signed in to the PMS — no new pairing code needed.
- `STAYOS_SERVER` still works in place of `HOTELONE_SERVER`.
- `/downloads/stayos-connector.mjs` is still served, so existing shortcuts and scheduled tasks keep working; switch them to the new file at your convenience.

A connector keeps talking to the address it was paired with. After a move to a new domain, it keeps working as long as the old address is reachable; pair it again to use the new one.

## Moving to HotelOne later

Everything the agent learns about your rooms and guests can be imported when you switch. Until then, nothing in your PMS changes without a person confirming it.
