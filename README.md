# Gatherly AI

Gatherly AI is a responsive event-planning workspace for weddings, birthdays, community gatherings, and custom occasions. Plan around one event at a time: track an editable budget and checklist, find nearby public business listings, keep a vendor shortlist, and prepare invitations that the user sends from their own email app.

## What works

- A no-account sample workspace to explore the product without exposing private data.
- Google sign-in and a private Firestore workspace when Firebase is configured.
- Event-specific vendor categories; optional Google Places search; users contact and confirm vendors themselves.
- Gemini first-draft plans with budget, contingency, timeline tasks, and vendor categories. Figures are planning estimates, never quotes or confirmed availability.
- Guest list and `mailto:` invitations. Gatherly does not send email in the background or request contact-book access.
- Mobile navigation and layouts, keyboard-operable controls, visible focus, status announcements, and reduced-motion support.

## Local development

Requirements: Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run dev
npm run check
npm test
npm run build
```

Copy `.env.example` to `.env.local`. Firebase values are web-app configuration, not server secrets. The app falls back to clearly labelled sample data until a Firebase web app is configured. Set `VITE_DEMO_MODE=false` for an authenticated workspace. Enable Google as a sign-in provider and create Firestore in the Firebase console. Publish the included `firestore.rules` before using the app.

### Google services

1. **Firebase Authentication** — enable the Google provider; add the deployed domain to authorized domains.
2. **Cloud Firestore** — create a database and deploy the included owner-only rules (`firebase deploy --only firestore:rules`). Events are scoped to `users/{uid}/events/{eventId}`.
3. **Firebase AI Logic** — enable Gemini Developer API in the Firebase console guided setup. Calls go directly from the browser through Firebase AI Logic; no Gemini key is shipped. Choose a Gemini model available in your Firebase project and set it in `src/lib/ai.ts` if required.
4. **Optional Google Maps Platform** — enable **Maps JavaScript API** and **Places API (New)**, add a browser key as `VITE_GOOGLE_MAPS_API_KEY`, and restrict it to the deployed website referrers and those APIs. Places requires a billing-enabled Maps project and may incur charges; the app works without it. Location lookup uses the Maps JavaScript geocoder. Location permission is optional; city entry is supported.
5. **Firebase App Check** — register reCAPTCHA v3, set `VITE_RECAPTCHA_V3_SITE_KEY`, and enforce App Check for supported Firebase services after verifying tokens in production.

No Calendar API or contact permissions are required. The guest flow opens the user's email client and requires their action. A phone call, shortlist, or “Confirmed” label is not a vendor booking transaction.

## Deploy to Firebase Hosting

Install the Firebase CLI locally, authenticate (`firebase login`), select your project (`firebase use <project-id>`), and build/deploy:

```sh
npm run build
firebase deploy --only hosting,firestore:rules
```

Add the deployed domain to Firebase Auth authorized domains and to the Maps key HTTP referrer restrictions. Never commit `.env.local`, private service-account keys, App Check debug tokens, or credentials. Browser Firebase configuration is expected to be public; access control relies on Authentication, Firestore Security Rules, API restrictions, and App Check.

## Data and privacy notes

This client-only prototype stores signed-in events in the user's Firestore path. The AI prompt sends event type, city, event date, guest count, budget, style, and optional notes to Gemini through Firebase AI Logic. Do not put guest names, email addresses, or phone numbers in AI notes. Sample vendors and people are illustrative. Google Places listing content is supplied by Google and should be treated as a listing, not a verified recommendation. Add a privacy notice and production support/retention policy before public use.

## Repository size

Keep generated `node_modules/` and `dist/` out of Git (already ignored); commit source, lockfile, and Firebase configuration only. This keeps the public repository small and reproducible.
