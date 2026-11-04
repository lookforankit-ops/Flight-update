# ✈ Flight Update

A small web app that reads the flight booking emails in your Gmail and lists all of your **upcoming flights**: route, date, times, airline, booking reference, passenger and seat. Each flight links back to its email.

- **Private:** it runs entirely in your browser and asks Google only for read-only Gmail access (`gmail.readonly`). There is no backend, and your email never goes anywhere except between your browser and Google.
- **Accurate where possible:** it first reads the [schema.org `FlightReservation`](https://developers.google.com/gmail/markup/reference/flight-reservation) data that most airlines and travel agencies put in their emails (Gmail reads the same data). If that is missing, it falls back to reading the email text (flight numbers like `6E 2134`, airport codes like `(DEL)` or `DEL → BOM`, dates and times).
- **Google Calendar sync:** add one flight, or all upcoming flights at once, to your Google Calendar. Events are placed at the airport's local time (an overnight DEL → LHR flight ends the next morning, London time) and include the booking reference, passenger and seat. Syncing again updates an event instead of duplicating it. If a flight's time changes, the card shows **Update in Calendar**. If a cancellation email arrives, it shows **Remove from Calendar**.
- **Controls:** the Gmail button at the top signs you in, then rescans your mail. The calendar button next to it syncs all flights to Google Calendar; its red badge shows how many need syncing. Each flight row also has its own calendar button: blue means add, green means it's in your calendar (tap to open the event), an orange dot means update, red means remove.
- **Airline logos:** loaded by airline code from public logo services (`pics.avs.io`, then `images.kiwi.com`), with a coloured code badge if neither has one. This is the only request the app makes outside Google, and it only shares the airline codes.
- **Web check-in agent:** the **🛂 Web check-in** button on each upcoming flight hands it to the [check-in agent](checkin-agent/README.md). The agent runs on your computer and completes online check-in with Claude. It asks you for passport/visa details, picks seats by your rules, and asks before any fee.
- **De-duplicated:** confirmation, change and check-in emails for the same flight are merged into one entry. Newer emails win, and a later "cancelled" email marks the flight as cancelled.

## Quick start

```bash
npm start          # or: python3 -m http.server 8000
```

Open <http://localhost:8000> and click **Try demo** to see it working with sample data.

## Connect your Gmail (one-time, about 5 minutes)

Google requires every app that reads Gmail to have its own OAuth client ID:

1. Open the [Google Cloud Console](https://console.cloud.google.com/), then create a project (or pick an existing one).
2. Go to **APIs & Services → Library** and **Enable** both the **Gmail API** and the **Google Calendar API**.
3. Go to **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type: **External**. App name: anything (e.g. "Flight Update").
   - Under **Audience / Test users**, add your own Gmail address.
   - Under **Data access / Scopes**, add `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/calendar.events`.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** `http://localhost:8000` (plus any other URL you host the app on).
5. Copy the client ID (`…apps.googleusercontent.com`) and either:
   - paste it into `config.js`, or
   - paste it into the app's **Settings** panel (it is saved in your browser only).
6. Click **Sign in with Google**. Because the app is in "testing" mode, Google shows an "unverified app" screen; click **Continue**. The app then scans your mail and lists your upcoming flights.
7. Click **📅 Add to Google Calendar** on a flight, or **Sync N flights to Google Calendar** at the top. The first time, Google asks for calendar permission. The app only creates, updates or deletes its own flight events, in your primary calendar.

## Settings

- **Gmail search query:** which emails get scanned. The default searches the last year for booking phrases (*PNR*, *booking ID*, *e-ticket*, *itinerary*, *booking confirmation*…) and travel sites (SmartBuy, Goibibo, MakeMyTrip, Cleartrip, Yatra, EaseMyTrip, ixigo). You can narrow it (e.g. add `from:(indigo OR airindia OR emirates)`) or widen it (e.g. `newer_than:2y`).
- **Max emails to scan:** defaults to 600. If more emails match the search, the app says so, because older bookings would be left out.
- **Calendar alerts:** popup alerts on each flight event, by default 1 day and 3 hours before departure (e.g. `2 days, 4h, 30m`, up to 5). After changing them, tap the calendar button to update existing events.
- **Check-in agent address:** where the check-in agent runs (default `http://localhost:8787`).
- **Show past flights / Show cancelled:** toggles in the list.

The results of the last scan are cached in your browser so the list shows right away next time. **Sign out** clears them and revokes the tokens.

Which flights are in your calendar is remembered in this browser. Each event also has a fixed ID derived from its flight number and date. So syncing from another device updates the existing event rather than adding a second one.

## Hosting it (GitHub Pages)

The workflow `.github/workflows/pages.yml` tests and publishes the web app on every push, at `https://lookforankit-ops.github.io/Flight-update/`. The check-in agent isn't published; it runs on a computer.

One-time setup:
1. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Then re-run the latest "Deploy to GitHub Pages" workflow from the **Actions** tab, or push any change.
2. On your Google OAuth client, add `https://lookforankit-ops.github.io` (no path) as an **Authorized JavaScript origin**.
3. Open the site on your phone, open Settings (the sliders button), and paste your client ID. You can also put it in `config.js`; it isn't a secret.
4. In Safari use **Share → Add to Home Screen**, or in Chrome use **⋮ → Add to Home screen**. It then opens full-screen like an app.

## Development

```
index.html, styles.css, config.js
src/parser.js    flight extraction (JSON-LD + text heuristics), merging, filtering (pure, no DOM)
src/gmail.js     Gmail REST calls and MIME decoding
src/calendar.js  flight -> Calendar event (time zones, overnight arrivals), upsert/delete
src/airports.js  airport -> time zone table for flights read from email text
src/app.js       UI and Google sign-in
src/samples.js   demo emails
checkin-agent/   the web check-in agent (see its README)
test/            parser and calendar tests
```

```bash
npm test
```

Before committing a change to the web app, run `node scripts/stamp-version.mjs`. It adds a new version to every script and stylesheet reference, so phones fetch the new files instead of using cached ones. The version is shown in Settings.

Emails without structured data are parsed heuristically, so unusual layouts can be missed or misread. Flights found this way are labelled "Read from email text". If an email is missed, add a sample of it to `test/parser.test.js` and adjust `parseHeuristic`.
