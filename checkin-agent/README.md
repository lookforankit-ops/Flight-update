# 🛂 Check-in Agent

An AI agent that does **online check-in** for flights found by the Flight Update app. It runs on your computer, opens a visible browser window, and works through the airline's check-in pages with Claude. You can watch every step.

## What it asks you, and when

| Situation | What happens |
|---|---|
| Passport, visa, nationality, date of birth, address… | You're asked to fill in a form. Values can be remembered on this computer if you tick the box. |
| Declarations (dangerous goods, health, travel documents) | You're shown what it says and asked to confirm. |
| Seat selection | Your seat rules (below) decide. Otherwise you choose from a list. |
| Anything that costs money | You're asked first, with the amount. The agent never types card/UPI/bank details: you pay yourself in the browser window. |
| CAPTCHA, OTP, login | The agent pauses until you've done it in the browser window. |
| Final "complete check-in" step | You confirm a one-line summary. |
| Check-in not open yet | It tells you when it opens and can wait and start automatically. |

### Seat rules (for one traveller)

1. A **free window seat in a row where the aisle seat is booked and the middle seat is empty**. This gives you the best chance of an empty seat next to you.
2. Otherwise, **any free window seat**.
3. Otherwise, you're asked. This covers only paid window seats left, aisle/middle only, several passengers on the booking, or anything else. Your options include free aisle/middle seats, the cheapest paid window seats, or skipping seat selection.

Within a rule, the seat nearest the front wins. If your assigned seat already meets the best rule available, it's kept.

### Safety rules enforced in code (not just asked of the AI)

- **No surprise payments:** any click on something showing a price (e.g. "Seat 3A ₹450", "Add baggage ₹1,500") or a payment step ("Pay now", "Checkout") is blocked until you allow it.
- **No card details:** the agent refuses to type into payment card fields.
- **Private details stay private:** the AI only sees placeholders like `{{passport_number}}`. The real values are typed into the airline site by this program, and are removed from any page text before it's sent to Claude.
- Seat choice is made by the rules above in code, not by the model.
- The local server only listens on `127.0.0.1` and rejects requests from other websites.

## Setup

Requires Node.js 18+ and an [Anthropic API key](https://console.anthropic.com/).

```bash
cd checkin-agent
npm install
npx playwright install chromium
export ANTHROPIC_API_KEY=sk-ant-...      # or: ant auth login
npm start                                 # → http://localhost:8787
```

Then in the Flight Update app, click **🛂 Web check-in** on any upcoming flight. The agent page opens with the flight filled in; click **Start web check-in**. Keep that page open: questions for you appear there, with a browser notification if the tab is in the background.

You can also enter a flight by hand on that page, or use the terminal:

```bash
npm run checkin -- '{"flightNumber":"6E2134","date":"2026-11-20","departureTime":"06:15","from":"DEL","to":"BLR","confirmation":"ZX4R9T","passenger":"Asha Rao"}'
```

Boarding passes the agent downloads are saved in `checkin-agent/boarding-passes/`.

## Notes

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`, effort `high`). If a request is declined by a safety check, the API automatically retries it on a fallback model (`fallbacks: "default"`). You can override with `CHECKIN_MODEL`, `CHECKIN_EFFORT` and `CHECKIN_MAX_STEPS` (default 150). One check-in usually takes a few dozen model calls.
- **Airlines:** check-in pages and opening windows are in `src/airlines.js` (IndiGo, Air India, SpiceJet, Akasa, Emirates, Qatar, Etihad, Singapore, BA, Lufthansa, US carriers, …). Windows are typical values and can differ by route. For other airlines the agent asks you for the check-in page URL.
- Airline websites change often and some use bot protection. When the agent gets stuck, it hands over to you, or stops and explains why.
- `.traveller-profile.json` (remembered details, readable only by you), `.browser-profile/` (cookies) and `boarding-passes/` are git-ignored. Delete them to forget everything.
- `HEADLESS=1` hides the browser window. That's not recommended, because you can't step in.

## Tests

```bash
npm test
```

These cover the seat rules, the fee and payment detection, and placeholder handling. One end-to-end test runs the real agent code and browser against a fake airline site (`test/fixtures/airline.html`), with a scripted stand-in for Claude. It checks that:
- passport values reach the page but never the model
- the rule-1 seat is chosen
- a baggage fee click is blocked when you say no
- the card field is refused
- the boarding pass is saved
