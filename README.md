# Gatherly AI

Gatherly AI is a responsive event-planning workspace for weddings, birthdays, community gatherings, and custom occasions. Plan around one event at a time: track an editable budget and checklist, find nearby public business listings, keep a vendor shortlist, and prepare invitations that the user sends from their own email app.

## What works

- A public landing page with Google sign-in, plus persistent About, Privacy, and Terms pages.
- Google sign-in and a private Firestore workspace when Firebase is configured.
- Event-specific vendor categories; five-at-a-time nearby OpenStreetMap discovery with Google Maps-grounded Gemini fallback when local map data is sparse; users contact and confirm vendors themselves.
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

Copy `.env.example` to `.env.local`. Firebase values are web-app configuration, not server secrets. AI plan generation uses Gemini 3.5 Flash-Lite with a short structured response and a Gemini Flash fallback; if Gemini quota is unavailable, it creates an explicitly labeled editable starter plan. Vendor discovery geocodes with Photon, checks nearby OpenStreetMap records, then uses Google Maps grounding when local coverage is empty. If Gemini quota is exhausted too, it provides a direct Google Maps search link instead of inventing a business. Results are constrained to the geocoded city and returned five at a time. Vite embeds `VITE_` values in the browser bundle; do not commit `.env.local`. The planner never creates sample events. Without Firebase configuration, the landing page stays available and the sign-in action explains what setup is missing. Enable Google as a sign-in provider and create Firestore in the Firebase console. Publish the included `firestore.rules` before using the app.

### Google services

1. **Firebase Authentication** — enable the Google provider; add the deployed domain to authorized domains. Set the Google Auth Platform branding name to **Gatherly AI** so consent screens do not show the generated project name. Google currently requires an application home page, privacy-policy URL, and developer contact email before it will save branding. The Firebase auth handler normally uses the project's `firebaseapp.com` domain. To use `gatherlyai.web.app` as `authDomain`, set `VITE_FIREBASE_AUTH_DOMAIN=gatherlyai.web.app` and add `https://gatherlyai.web.app/__/auth/handler` to the OAuth web client's authorized redirect URIs; the Firebase Hosting reserved auth endpoints must remain available.
2. **Cloud Firestore** — create a database and deploy the included owner-only rules (`firebase deploy --only firestore:rules`). Events are scoped to `users/{uid}/events/{eventId}`.
3. **Gemini API** — event plans use Gemini 3.5 Flash-Lite first, with a concise JSON response and Gemini 3.8 Flash fallback. When OpenStreetMap has no nearby results, vendor discovery uses Gemini Google Maps grounding centered on the searched city's geocoded coordinates. The configured Google AI Studio auth keys are embedded in this browser prototype; restrict them to Gemini API and rotate them after the demo. Google Maps results include cited map listings; ratings, photos, and phone numbers are not guaranteed. Location permission is optional; city or neighbourhood entry is supported. Google reports a monthly no-cost Maps grounding allowance; usage beyond current quotas can be billed.
4. **Optional Google Maps Platform** — Maps JavaScript API and Places API (New) are not required for the current place-discovery flow.
5. **Firebase App Check** — register reCAPTCHA Enterprise, set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, and enforce App Check for supported Firebase services after verifying tokens in production.

No Calendar API or contact permissions are required. The guest flow opens the user's email client and requires their action. A phone call, shortlist, or “Confirmed” label is not a vendor booking transaction.

## Deploy to Firebase Hosting

Install the Firebase CLI locally, authenticate (`firebase login`), select your project (`firebase use <project-id>`), and build/deploy:

```sh
npm run build
firebase deploy --only hosting,firestore:rules
```

Add the deployed domain to Firebase Auth authorized domains and restrict any Gemini key to the Gemini API and appropriate referrers. Never commit `.env.local`, private service-account keys, App Check debug tokens, or credentials. Browser Firebase configuration is expected to be public; access control relies on Authentication, Firestore Security Rules, API restrictions, and App Check.

## Data and privacy notes

This client-only prototype stores signed-in events in the user's Firestore path. AI planning sends event type, city, event date, guest count, budget, style, and optional notes to Gemini. Place discovery sends the selected category and city (or coordinates after the user chooses location access) to Photon for geocoding, Overpass for nearby OpenStreetMap records, and Google Maps grounding when needed. Do not put guest names, email addresses, or phone numbers in AI notes. Verify search results and vendor details directly before making arrangements. Review and update the Privacy page and data-retention process before public use.

## Repository size

Keep generated `node_modules/` and `dist/` out of Git (already ignored); commit source, lockfile, and Firebase configuration only. This keeps the public repository small and reproducible.
