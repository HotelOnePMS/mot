# The always-on agent on WhatsApp

Owners, managers and front desk can use the hotel agent from WhatsApp: ask about the hotel, make changes, and get told when something needs them. It is the same agent as the console's **Agent** screen, with the same tools, the same permissions and the same activity log. Guests' WhatsApp (the phone line's agent in ElevenLabs) is separate and works on a different number.

- **Ask and act.** "Brief me", "who's arriving today?", "check in Rosa Diaz", "mark 204 clean", "raise rates 10% this weekend". Look-ups answer straight away. Changes come back as a plan, and nothing happens until the person replies **YES** (or **NO** to drop it). It is the same signed, single-use, 10-minute plan the console confirms.
- **Always on.** The agent keeps an eye on each hotel and messages the right people when there is something to act on: overdue check-outs, late or unconfirmed arrivals, arrivals without a room, room types short of clean rooms, dirty rooms nobody is assigned to, guest messages and booking requests, card disputes, PMS work that failed or needs a person, and OTA connections that stopped syncing. It also sends a morning brief at 8am hotel time. Each alert lists its fix as a numbered reply: "1" runs it through the agent, so a change still needs a YES. Alerts are quiet from 10pm to 7am hotel time (card disputes come through anyway), and each problem is sent once.
- **Owner-set access.** On **Setup → Agent access**, the owner chooses, per hotel, what managers, front desk and housekeeping may do through the agent (in the console and on WhatsApp), who may use WhatsApp, and which alerts each role gets. Owners always have everything. See [ROLES.md](ROLES.md#agent-access).

Other chat commands: a number picks an option, **HOTELS** or **switch to Harbor Inn** changes hotel (an exact name wins over a longer one; HOTELS numbers the first nine, and "switch to" finds any of them; neither drops a plan waiting at the hotel the chat stays on), **ALERTS OFF** / **ALERTS ON**, **DETAILS** repeats the last alert (and its numbers work again), **HELP**, and **UNLINK** disconnects the phone. Only a yes ("YES", "yes please", "go ahead") confirms a change. "OK", "thanks" and reactions such as 👍 never do: with a plan waiting they get a reminder to reply YES or NO, and a question asked in between leaves the plan waiting until it expires. When an alert went out as a template (more than 24 hours after the person last wrote), their next message gets the whole alert first. If that message is a number, "ok", "yes", "no" or the template's **Show me** button, they get only the alert, so nothing runs before they have read it (only a YES or NO to a plan still waiting is taken as the answer to that plan). An alert sent while they're chatting numbers its replies on from the list they were reading, so a number they send still picks what they saw; when past nine numbers, an option shows the command to send instead. If more alerts go out before they have read it (as templates, or as a normal message after a YES or NO opened the 24-hour window), each is added to the one waiting and numbered on from it, so they see them all, oldest first, and every number works. When that would pass nine numbers or about 12,000 characters, the newest alerts start a fresh message numbered from 1, with a note to send "brief me" for the current picture. A held alert is only shown while the person still works at a hotel where the agent on WhatsApp is on for them. An alert past the ninth number shows the command to send, and for another hotel says to switch first. An alert too long for one WhatsApp message, and **DETAILS** after it, comes as several messages.

## How a phone is linked

1. In the console, **Account → Security → WhatsApp → Link my WhatsApp** shows a one-time code (valid for 10 minutes, single use). **Cancel** stops the code at once, and so does signing out everywhere before it is used.
2. From the phone, send `LINK ABCD-EFGH` to the staff number. The page shows the phone as linked, and the account gets an email about it.

The number is proven by the phone that sent the code (Meta signs every webhook), and the account by the signed-in console. Nobody types a number that could be wrong or belong to someone else. Linking is per person. Anything that signs the person out everywhere also ends the link: "sign out everywhere", a new password, two-step sign-in turned on or off, a role or email change, or deactivation. They link again from the same page. The person's hotels and the hotel's agent access are read again on every message, so changes there apply at once.

## Setting it up on Meta's side

You need a phone number that is **not** already on the WhatsApp app and **not** the guest number used by the phone line in ElevenLabs.

1. **Meta app.** At [developers.facebook.com](https://developers.facebook.com/apps), create an app of type *Business* in your Meta business portfolio and add the **WhatsApp** product. It creates a WhatsApp Business Account for you.
2. **Phone number.** In *WhatsApp → API Setup*, add your number, verify it by SMS or call, and submit a display name (for example "HotelOne Team"). Copy the **Phone number ID** into `WHATSAPP_PHONE_NUMBER_ID`.
3. **Permanent token.** In *Business settings → Users → System users*, add a system user (Admin) and assign it the app and the WhatsApp account with full control. Generate a token with `whatsapp_business_messaging` and `whatsapp_business_management` and put it in `WHATSAPP_ACCESS_TOKEN`. The 24-hour token on the API Setup page is only for trying things out.
4. **App secret.** *App settings → Basic → App secret* goes into `WHATSAPP_APP_SECRET`. HotelOne checks every webhook against it.
5. **Verify token.** Make up a long random string (`openssl rand -hex 24`) and put it in `WHATSAPP_VERIFY_TOKEN`.
6. **Deploy.** Set the variables on Vercel (plus `WHATSAPP_DISPLAY_NUMBER=+1…` so the console can show the number and an "Open WhatsApp" button) and redeploy.
7. **Webhook.** In *WhatsApp → Configuration*, set the callback URL to `https://hotelone.site/api/webhooks/whatsapp` and the verify token from step 5. Choose *Verify and save*, then subscribe to the **messages** field. If messages don't arrive, subscribe the app to the WhatsApp account: `POST https://graph.facebook.com/v23.0/<WABA_ID>/subscribed_apps` with the token.
8. **Go live.** Add a privacy policy URL (`https://hotelone.site/privacy`) under *App settings → Basic* and switch the app to **Live**. In development mode WhatsApp only delivers to up to five test numbers you list in API Setup.
9. **Alert template.** WhatsApp only allows free-form messages for 24 hours after a person's last message. For alerts after that, create a template in *WhatsApp Manager → Message templates*: category **Utility**, name `hotel_alert`, language English, body `{{1}}: {{2}}. Reply to see the details and what you can do.` (sample values "Harbor Inn" and "2 overdue check-outs"), and optionally a quick-reply button **Show me**. When it is approved, set `WHATSAPP_ALERT_TEMPLATE=hotel_alert` (and `WHATSAPP_ALERT_TEMPLATE_LANG` if the language code isn't `en`). Without a template, alerts reach only people who wrote in the last 24 hours.
10. **Payment method.** Template messages are billed by Meta per message. Add a payment method to the WhatsApp account in *WhatsApp Manager → Payment settings*. Replies within the 24-hour window are free.

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | The staff number's Phone number ID (Cloud API) |
| `WHATSAPP_ACCESS_TOKEN` | System user token with `whatsapp_business_messaging` |
| `WHATSAPP_APP_SECRET` | App secret: checks the `X-Hub-Signature-256` of every webhook |
| `WHATSAPP_VERIFY_TOKEN` | Your random string for Meta's webhook verification |
| `WHATSAPP_DISPLAY_NUMBER` | Optional: the number as people dial it, shown in the console |
| `WHATSAPP_ALERT_TEMPLATE`, `WHATSAPP_ALERT_TEMPLATE_LANG` | Optional: the approved alert template and its language (default `en`) |
| `WHATSAPP_GRAPH_VERSION` | Optional: Graph API version (default `v23.0`) |
| `CRON_SECRET` | Bearer token for the alert rounds (shared with the channel cron) |

The feature is off, and its webhook answers 404, until the first four are set.

## Keeping the agent's rounds going

Guest messages, card disputes and PMS work that needs a person trigger alerts the moment they happen, and the agent also looks around while people use the console or the chat. For the morning brief and the time-based alerts (overdue check-outs and so on), call the rounds endpoint every 15 minutes:

```
GET https://hotelone.site/api/cron/agent-watch
Authorization: Bearer $CRON_SECRET
```

- **Vercel Pro:** add `{ "path": "/api/cron/agent-watch", "schedule": "*/15 * * * *" }` to `crons` in `vercel.json`. Hobby plans only allow daily crons, and a more frequent one fails the deploy.
- **Any plan:** a free scheduler such as cron-job.org with that URL and header, or a scheduled GitHub Actions workflow that runs `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://hotelone.site/api/cron/agent-watch`. On a private repository that uses Actions minutes.

Running it more often never sends anything twice: each alert is recorded once per hotel (`agent_notices`) and claimed for each person just before it is sent. A send that fails is tried again in the next round. Each person gets at most one message per round, covering all their hotels, with up to six alerts (urgent first); the rest follow in the next round.

## Where the code is

| | |
| --- | --- |
| `src/app/api/webhooks/whatsapp/route.ts` | Webhook: Meta's verification, signature check, replies after the 200 |
| `src/server/whatsapp/cloud.ts` | Cloud API: config, signatures, parsing, sending text and templates |
| `src/server/whatsapp/link.ts` | Linking a phone with a one-time code |
| `src/server/whatsapp/staff.ts` | The chat: commands, the agent, YES/NO, hotels |
| `src/server/whatsapp/format.ts` | The agent's blocks as WhatsApp text with numbered replies |
| `src/server/agent/policy.ts` | Agent access per hotel and role |
| `src/server/agent/watch.ts` | The always-on agent's rounds and alerts |
| `src/app/api/cron/agent-watch/route.ts` | The rounds endpoint |
