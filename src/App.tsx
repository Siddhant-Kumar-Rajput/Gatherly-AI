import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Compass, ExternalLink, Heart, LayoutDashboard, LoaderCircle, MapPin, Menu, Plus, Search, Send, Sparkles, Users, X } from "lucide-react";
import { categoriesFor, budgetRemaining, budgetUsed, completionPercent, daysUntil, emailInviteUrl, eventKindLabel, formatEventDate, formatINR } from "./lib/domain";
import { firebaseConfigured } from "./lib/config";
import type { EventKind, EventRecord, EventVendor, PlanTask } from "./types";
import type { GroundedPlace } from "./lib/groundedPlaces";

type User = { uid: string; displayName: string; email: string; photoURL?: string };
const kinds: EventKind[] = ["Wedding", "Birthday", "Community", "Custom"];
const money = (n: number) => formatINR(n, true);
const newId = () => crypto.randomUUID();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [route, setRoute] = useState(window.location.pathname);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [screen, setScreen] = useState<"overview" | "event">("overview");
  const [dialog, setDialog] = useState<"event" | "ai" | "guest" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [placeResults, setPlaceResults] = useState<GroundedPlace[]>([]);
  const [placePage, setPlacePage] = useState(0);
  const [locationCoordinates, setLocationCoordinates] = useState<{ latitude: number; longitude: number } | undefined>();
  const active = events.find((event) => event.id === activeId) || events[0];

  const navigate = (path: string) => {
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setRoute(path);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  useEffect(() => {
    const onPopState = () => { setRoute(window.location.pathname); window.scrollTo({ top: 0, behavior: "auto" }); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (authReady && route === "/app" && !user) navigate("/");
  }, [authReady, route, user]);

  useEffect(() => {
    if (!firebaseConfigured) return;
    let cancelled = false;
    let unsubscribe = () => {};
    void import("./lib/firebase").then(({ auth }) => {
      if (cancelled) return;
      if (!auth) { setAuthReady(true); return; }
      return import("firebase/auth").then(({ onAuthStateChanged }) => {
        if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, (signed) => {
        setUser(signed ? { uid: signed.uid, displayName: signed.displayName || "Gatherly member", email: signed.email || "", photoURL: signed.photoURL || undefined } : null);
        setAuthReady(true);
        if (signed) {
          setEvents([]);
          setActiveId("");
          setScreen("overview");
          setDialog(null);
          setMenuOpen(false);
        } else {
          setEvents([]);
          setActiveId("");
        }
      });
      });
    }).catch(() => { setAuthReady(true); setNotice("Firebase could not initialize. Check your project configuration."); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!user || !firebaseConfigured) return;
    let cancelled = false;
    let unsubscribe = () => {};
    void import("./lib/firebase").then(({ watchEvents }) => {
      if (cancelled) return;
      unsubscribe = watchEvents(user.uid, (cloudEvents) => {
        const syncedEvents = cloudEvents.map((event) => ({ ...event, isSample: false }));
        setEvents(syncedEvents);
        setActiveId((current) => syncedEvents.some((event) => event.id === current) ? current : syncedEvents[0]?.id || "");
      }, () => setNotice("Could not sync your events. Check your Firestore rules and connection."));
    }).catch(() => setNotice("Cloud sync could not start. Check your Firebase configuration."));
    return () => { cancelled = true; unsubscribe(); };
  }, [user]);

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); }, [notice]);

  const persist = async (event: EventRecord) => {
    setEvents((all) => all.some((item) => item.id === event.id) ? all.map((item) => item.id === event.id ? event : item) : [event, ...all]);
    if (user) {
      try { const { saveEvent } = await import("./lib/firebase"); await saveEvent(user.uid, event); } catch { setNotice("Saved locally for this session, but cloud sync failed. Check your Firebase rules."); }
    }
  };

  const login = async () => {
    if (!firebaseConfigured) { setNotice("Google sign-in is not configured yet. Add the Firebase web app settings to .env.local."); return; }
    setBusy("login");
    try { const { signInWithGoogle } = await import("./lib/firebase"); const signed = await signInWithGoogle(); setUser({ uid: signed.uid, displayName: signed.displayName || "Gatherly member", email: signed.email || "", photoURL: signed.photoURL || undefined }); navigate("/app"); setNotice("Signed in with Google."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Google sign-in failed."); }
    finally { setBusy(""); }
  };

  const logout = async () => { const { signOutUser } = await import("./lib/firebase"); await signOutUser(); setUser(null); setEvents([]); setActiveId(""); setScreen("overview"); navigate("/"); setNotice("You are signed out."); };

  const createEvent = (form: FormData) => {
    const kind = form.get("kind") as EventKind;
    const customKind = String(form.get("customKind") || "").trim();
    const event: EventRecord = {
      id: newId(), title: String(form.get("title")).trim(), kind, customKind: kind === "Custom" ? customKind : undefined,
      date: String(form.get("date")), city: String(form.get("city")).trim(), guests: Math.max(1, Number(form.get("guests"))), budget: Math.max(0, Number(form.get("budget"))), style: "",
      budgetLines: [], tasks: [], vendorCategories: categoriesFor(kind, customKind), vendors: [], guestsList: [], isSample: false,
    };
    setEvents((all) => [event, ...all]); setActiveId(event.id); setScreen("event"); setDialog(null); void persist(event); navigate("/app"); setNotice("Your event workspace is ready.");
  };

  const updateEvent = (patch: Partial<EventRecord>) => { if (!active) return; void persist({ ...active, ...patch }); };

  const toggleTask = (taskId: string) => updateEvent({ tasks: active.tasks.map((task) => task.id === taskId ? { ...task, done: !task.done } : task) });
  const setVendorStatus = (vendorId: string, status: EventVendor["status"]) => updateEvent({ vendors: active.vendors.map((vendor) => vendor.id === vendorId ? { ...vendor, status } : vendor) });

  const runAI = async (budget: number, guests: number, date: string, preferences: string) => {
    setBusy("ai");
    try {
      const { generateEventPlan } = await import("./lib/ai");
      const plan = await generateEventPlan({ ...active, budget, guests, date }, preferences);
      const updated: EventRecord = {
        ...active, budget, guests, date, aiSummary: plan.summary, aiIdeas: plan.ideas,
        budgetLines: plan.budgetLines.map((line) => ({ id: newId(), category: line.category, estimate: line.highEstimate, status: "estimate" as const })),
        tasks: plan.tasks.map((task) => ({ id: newId(), ...task, done: false })), vendorCategories: plan.vendorCategories,
      };
      await persist(updated); setDialog(null); setNotice("Your first-pass plan is ready. Estimates are illustrative, not vendor quotes.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not generate the plan."); }
    finally { setBusy(""); }
  };

  const addGuest = (form: FormData) => {
    const name = String(form.get("name")).trim(); const email = String(form.get("email")).trim();
    if (!name) return;
    updateEvent({ guestsList: [...active.guestsList, { id: newId(), name, email: email || undefined, invited: false }] }); setDialog(null);
  };

  const addPlaces = async (nextPage = false) => {
    if (!cityDraft.trim()) { setNotice("Enter a city or neighbourhood to search for local vendors."); return; }
    const category = query || active.vendorCategories[0] || "event vendors";
    setBusy("places");
    try {
      const { searchGroundedPlaces } = await import("./lib/groundedPlaces");
      const previous = nextPage ? placeResults : [];
      const places = await searchGroundedPlaces({ category, location: cityDraft, coordinates: locationCoordinates, excludeNames: previous.map((place) => place.name) });
      setPlaceResults(nextPage ? [...previous, ...places.filter((place) => !previous.some((old) => old.mapsUrl === place.mapsUrl))] : places);
      setPlacePage(nextPage ? placePage + 1 : 1);
      if (nextPage && !places.length) setNotice("No more distinct grounded places came back for this search.");
      else if (!places.length) setNotice("No grounded place results were returned. Try a broader category or nearby city.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load vendor results."); }
    finally { setBusy(""); }
  };

  const addGroundedPlace = (place: GroundedPlace) => {
    if (!active || active.vendors.some((vendor) => vendor.mapsUrl === place.mapsUrl)) { setNotice("This place is already in your shortlist."); return; }
    const vendor: EventVendor = { id: place.id, placeId: place.id, name: place.name, category: query || active.vendorCategories[0] || "Vendor", status: "Interested", mapsUrl: place.mapsUrl, rating: place.rating, source: "google" };
    updateEvent({ city: cityDraft || active.city, vendors: [...active.vendors, vendor] });
    setNotice(`${place.name} added to your interested vendors.`);
  };

  const requestLocation = () => {
    if (!navigator.geolocation) { setNotice("Location access is not available in this browser. Enter a city instead."); return; }
    setBusy("location");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      setBusy("");
      setLocationCoordinates({ latitude: coords.latitude, longitude: coords.longitude });
      setCityDraft("Near my current location");
      setNotice("Location ready. Choose a category and search to find nearby options.");
    }, () => { setBusy(""); setNotice("Location was not shared. You can enter a city manually."); }, { timeout: 10000, maximumAge: 300000 });
  };

  const filteredEvents = events.filter((event) => `${event.title} ${event.city} ${event.kind}`.toLowerCase().includes(query.toLowerCase()));
  if (!authReady) return <div className="loading-screen" role="status"><LogoMark/><p>Getting your celebration space ready…</p></div>;
  if (route === "/privacy" || route === "/about" || route === "/terms") return <InfoPage route={route} onNavigate={navigate} />;
  if (route !== "/app") return <Landing onLogin={login} onOpenApp={() => navigate("/app")} signedIn={Boolean(user)} onDismiss={() => setNotice("")} busy={busy === "login"} configured={firebaseConfigured} notice={notice}/>;
  if (!user) return <div className="loading-screen" role="status"><LogoMark/><p>Opening your private workspace…</p></div>;
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Main navigation">
      <div className="brand"><LogoMark/><span>Gatherly<span className="brand-ai"> AI</span></span><button className="mobile-close icon-button" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18}/></button></div>
      <div className="workspace-label">Your workspace</div>
      <nav className="nav-list">
        <button className={`nav-item ${screen === "overview" ? "selected" : ""}`} onClick={() => { setScreen("overview"); setMenuOpen(false); }}><LayoutDashboard size={17}/>Overview</button>
        <button className={`nav-item ${screen === "event" ? "selected" : ""}`} onClick={() => { setScreen("event"); setMenuOpen(false); }}><CalendarDays size={17}/>My events<span className="nav-count">{events.length}</span></button>
      </nav>
      <div className="sidebar-label-row"><span>Upcoming</span><button className="icon-button mini" aria-label="Create event" onClick={() => setDialog("event")}><Plus size={15}/></button></div>
      <div className="event-nav-list">{events.slice(0, 4).map((event) => <button key={event.id} className={`event-nav ${activeId === event.id ? "active" : ""}`} onClick={() => { setActiveId(event.id); setScreen("event"); setMenuOpen(false); }}><span className={`event-dot ${event.kind.toLowerCase()}`}></span><span className="nav-event-title">{event.title}</span><ChevronRight size={14}/></button>)}</div>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => setNotice("Need help? Review the README for setup and privacy details.")}><CircleHelp size={17}/>Help & support</button>
        <div className="user-block">{user?.photoURL ? <img src={user.photoURL} alt=""/> : <span className="avatar">{user?.displayName?.[0] || "G"}</span>}<div className="user-meta"><strong>{user?.displayName || "Gatherly member"}</strong><small>{user?.email || "Signed in"}</small></div><button className="icon-button" aria-label="Sign out" onClick={logout}><ChevronDown size={16}/></button></div>
      </div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)}></button>}
    <main className="main-content">
      <header className="mobile-header"><button className="icon-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={19}/></button><span>Gatherly<span className="brand-ai"> AI</span></span><button className="icon-button" aria-label="Create event" onClick={() => setDialog("event")}><Plus size={20}/></button></header>
      <div className="content-wrap">
        <div className="topline"><span>{screen === "overview" ? new Intl.DateTimeFormat("en-IN", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()) : <><button className="back-link" onClick={() => setScreen("overview")}><ArrowLeft size={14}/> Events</button><span className="crumb-divider">/</span>{active?.title || "Your events"}</>}</span><button className="avatar top-avatar" aria-label={user ? `Signed in as ${user.displayName}` : "Guest profile"} onClick={user ? logout : login}>{user?.photoURL ? <img src={user.photoURL} alt=""/> : user?.displayName?.[0] || "G"}</button></div>
        {screen === "overview" ? <>
          <section className="greeting-row"><div><h1>Make room for <em>the good stuff.</em></h1><p className="subtitle">The details are in good hands. Here’s what’s taking shape.</p></div><button className="primary-button" onClick={() => setDialog("event")}><Plus size={17}/>Plan an event</button></section>
          <section className="overview-layout">
            <div className="overview-main">
              <div className="section-head"><div><h2>Your celebrations</h2><p>Every gathering, thoughtfully in progress.</p></div><button className="text-button" onClick={() => setScreen("event")}>All events <ArrowRight size={15}/></button></div>
              <div className="event-grid">{filteredEvents.map((event) => <EventCard key={event.id} event={event} onOpen={() => { setActiveId(event.id); setScreen("event"); }} />)}</div>
              {filteredEvents.length === 0 && <div className="empty-state">{query ? `No events match “${query}”. Try another search.` : "No events yet. Create your first celebration to get started."}</div>}
              <div className="section-head upcoming-title"><div><h2>Coming up next</h2><p>A quick look at what needs your attention.</p></div><button className="circle-arrow" aria-label="View next event" onClick={() => { const next = [...events].sort((a,b) => a.date.localeCompare(b.date))[0]; if(next){setActiveId(next.id);setScreen("event");}}}><ArrowDownRight size={17}/></button></div>
              <div className="task-preview">{events.flatMap((event) => event.tasks.filter((task) => !task.done).map((task) => ({ ...task, eventTitle: event.title, eventId: event.id }))).slice(0, 4).map((task) => <button className="task-row" key={`${task.eventId}-${task.id}`} onClick={() => { setActiveId(task.eventId); setScreen("event"); }}><span className="task-check"></span><span className="task-main"><strong>{task.title}</strong><small>{task.eventTitle}</small></span><span className="task-date">{formatEventDate(task.dueDate, { day: "numeric", month: "short" })}</span><ChevronRight size={15}/></button>)}{events.every((event) => event.tasks.every((task) => task.done)) && <div className="empty-state">You’re all caught up. Add an event to start planning.</div>}</div>
            </div>
            <aside className="overview-rail">
              <div className="section-head rail-heading"><div><h2>At a glance</h2><p>Your planning, in a nutshell.</p></div></div>
              <div className="glance-card"><div className="glance-top"><span className="glance-icon"><CalendarDays size={17}/></span><span>In the calendar</span></div><div className="glance-number">{events.length} <small>events</small></div><div className="glance-divider"></div><div className="glance-facts"><span>Next celebration</span><strong>{events.length ? [...events].sort((a,b)=>a.date.localeCompare(b.date))[0].title : "Nothing planned yet"}</strong></div></div>
              <div className="rail-section-title">A helpful nudge</div><div className="nudge-card"><span className="nudge-icon"><Sparkles size={17}/></span><h3>Start with the big three.</h3><p>Set your date, guest count, and budget. Gatherly can turn them into a first-pass plan in moments.</p><button className="text-button" onClick={() => events.length ? setDialog("ai") : setDialog("event")}>{events.length ? "Try AI planner" : "Plan your first event"} <ArrowRight size={15}/></button></div>
              <div className="privacy-note"><span className="privacy-dot"></span><p>Your event details are stored in your private workspace.</p></div>
            </aside>
          </section>
        </> : active ? <EventWorkspace event={active} onUpdate={updateEvent} onToggleTask={toggleTask} onVendorStatus={setVendorStatus} onAI={() => setDialog("ai")} onAddGuest={() => setDialog("guest")} onAddPlaces={addPlaces} onAddGroundedPlace={addGroundedPlace} placeResults={placeResults.slice(Math.max(0, placePage - 1) * 5, placePage * 5)} hasNextPlaces={placeResults.length === placePage * 5} placesConfigured={Boolean(import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY_2 || import.meta.env.VITE_GEMINI_API_KEY_3)} busy={busy} query={query} setQuery={setQuery} cityDraft={cityDraft || active.city} setCityDraft={(value) => { setCityDraft(value); setLocationCoordinates(undefined); }} onLocation={requestLocation} onNotice={setNotice} /> : <div className="empty-state">No events yet. Create your first celebration to start planning.</div>}
      </div>
      <AppFooter onNavigate={navigate}/>
    </main>
    {dialog === "event" && <Dialog title="A new reason to celebrate" subtitle="Let’s make a little space for something wonderful." onClose={() => setDialog(null)}><EventForm onSubmit={createEvent}/></Dialog>}
    {dialog === "ai" && active && <Dialog title="Your plan, with a little help" subtitle="A useful first draft. You stay in charge of every decision." onClose={() => setDialog(null)}><AIForm event={active} busy={busy === "ai"} onSubmit={runAI}/></Dialog>}
    {dialog === "guest" && <Dialog title="Who’s on the list?" subtitle="Add people one at a time. Invitations are always sent by you." onClose={() => setDialog(null)}><GuestForm onSubmit={addGuest}/></Dialog>}
    {notice && <div className="toast" role="status"><CheckCircle2 size={17}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={15}/></button></div>}
  </div>;
}

function Landing({ onLogin, onOpenApp, signedIn, onDismiss, busy, configured, notice }: { onLogin: () => void; onOpenApp: () => void; signedIn: boolean; onDismiss: () => void; busy: boolean; configured: boolean; notice: string }) {
  return <main className="landing-page">
    <nav className="landing-nav" aria-label="Welcome navigation"><a className="landing-brand" href="#home" aria-label="Gatherly AI home"><LogoMark/><span>Gatherly<span> AI</span></span></a><div className="landing-nav-actions"><a href="#how-it-works">How it works</a>{signedIn ? <button className="landing-signin landing-signup" onClick={onOpenApp}>Open planner</button> : <><button className="landing-text-signin" onClick={onLogin} disabled={busy}>Sign in</button><button className="landing-signin landing-signup" onClick={onLogin} disabled={busy}>Create account</button></>}</div></nav>
    <section className="landing-hero" id="home"><div className="landing-copy"><p className="landing-eyebrow"><span></span> A calmer way to bring people together</p><h1>Make room for <em>the good stuff.</em></h1><p className="landing-lede">One thoughtful place to plan the celebration, find local vendors, keep your budget on track, and bring your people along.</p><div className="landing-actions">{signedIn ? <button className="landing-google" onClick={onOpenApp}><ArrowRight size={18}/>Open your planner</button> : <button className="landing-google" onClick={onLogin} disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <GoogleMark/>}{busy ? "Connecting to Google…" : "Continue with Google"}</button>}</div><p className="landing-auth-note">{signedIn ? "Your account is ready. Continue to your private event workspace." : "New to Gatherly? Google creates your account when you continue. Your private plans sync to your account."}</p>{!configured && <p className="landing-config-note" role="status">Google sign-in needs Firebase web app settings in <code>.env.local</code>.</p>}</div><div className="landing-art" role="img" aria-label="A celebration table set for a warm, intimate gathering"><div className="art-orbit orbit-one"></div><div className="art-orbit orbit-two"></div><div className="art-sun"></div><div className="art-table"><div className="art-cloth"></div><div className="art-vase"><i></i><i></i><i></i><b></b></div><div className="art-candle candle-one"></div><div className="art-candle candle-two"></div><div className="art-plate plate-one"></div><div className="art-plate plate-two"></div></div><div className="art-card"><span><Sparkles size={15}/></span><div><strong>Your plans, in one place</strong><small>Ideas · checklist · local vendors</small></div></div></div></section>
    <section className="landing-features" aria-label="Ways Gatherly helps"><article><span className="feature-icon"><CalendarDays size={18}/></span><h2>Wedding days</h2><p>Coordinate venues, catering, guest details and the moments in between.</p></article><article><span className="feature-icon"><Sparkles size={18}/></span><h2>Birthdays & milestones</h2><p>Shape a celebration around your people, style and budget.</p></article><article><span className="feature-icon"><Compass size={18}/></span><h2>Community gatherings</h2><p>Keep local options, volunteers and next steps easy to find.</p></article></section>
    <section className="landing-how" id="how-it-works"><div><p className="landing-eyebrow"><span></span> Thoughtful planning, one step at a time</p><h2>From first idea to <em>“see you there.”</em></h2></div><div className="how-steps"><p><CalendarDays size={18}/><strong>Start with the essentials</strong><small>Set a date, city, guest count and maximum budget.</small></p><p><Sparkles size={18}/><strong>Build a plan that fits</strong><small>Use Gemini for a first draft of ideas, budget ranges and a checklist.</small></p><p><Compass size={18}/><strong>Choose your own vendors</strong><small>Shortlist local listings and contact each vendor directly.</small></p></div></section>
    <section className="landing-cta"><div><p className="landing-eyebrow"><span></span> Your next gathering starts here</p><h2>Ready when you are.</h2><p>{signedIn ? "Your workspace is ready." : "Sign in to keep your event plans with you."}</p></div>{signedIn ? <button className="landing-google" onClick={onOpenApp}><ArrowRight size={18}/>Open your planner</button> : <button className="landing-google" onClick={onLogin} disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <GoogleMark/>}{busy ? "Connecting to Google…" : "Continue with Google"}</button>}</section>
    <AppFooter onNavigate={(path) => { window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); }} />
    {notice && <div className="toast" role="status"><CheckCircle2 size={17}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss notice" onClick={onDismiss}><X size={15}/></button></div>}
  </main>;
}

function AppFooter({ onNavigate }: { onNavigate: (path: string) => void }) {
  return <footer className="landing-footer"><a className="landing-brand" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}><LogoMark/><span>Gatherly<span> AI</span></span></a><p>Plan with care. Confirm every detail directly with your vendors.</p><nav aria-label="Footer"><a href="/privacy" onClick={(event) => { event.preventDefault(); onNavigate("/privacy"); }}>Privacy</a><a href="/about" onClick={(event) => { event.preventDefault(); onNavigate("/about"); }}>About</a><a href="/terms" onClick={(event) => { event.preventDefault(); onNavigate("/terms"); }}>Terms</a><a href="https://github.com/Siddhant-Kumar-Rajput/Gatherly-AI" target="_blank" rel="noreferrer">Source code</a></nav></footer>;
}

function InfoPage({ route, onNavigate }: { route: string; onNavigate: (path: string) => void }) {
  const content = route === "/privacy" ? {
    title: "Privacy, in plain language",
    intro: "Gatherly AI stores the information you choose to add so you can plan your events. You stay in control of location sharing and vendor contact.",
    sections: [["Information in your plans", "Your event title, type, date, city, guest count, budget, checklist, vendor shortlist and guest details are stored in your Firebase account. Firestore rules scope event data to the signed-in account."], ["Google services", "Google Sign-In authenticates your account. If you request an AI plan, event type, city, date, guest count, budget and optional style notes are sent to Gemini through Firebase AI Logic to generate the draft. If you search for local vendors, the selected category and city—or device coordinates when you choose to share location—are sent to Gemini with Grounding with Google Maps enabled. Google Maps place names and source links appear with results."], ["Location and invitations", "Device location is only requested after you choose the location button and approve the browser prompt. You can type a city instead. Gatherly does not read your contacts or send invitations automatically; invitation links open your email app for you to review and send."], ["Your choices", "You can use the app without sharing device location. Avoid putting sensitive personal details in AI planning notes. For help with access or data deletion, contact the developer using the public source repository until an in-app deletion control is available."]],
  } : route === "/about" ? {
    title: "A little more about Gatherly",
    intro: "Gatherly AI is a planning assistant for weddings, birthdays, and community events, built to make the moving parts feel more manageable.",
    sections: [["What it helps with", "Create an event workspace, keep a high-side budget estimate and checklist, search for local vendor listings, track your shortlist, and draft personalized ideas with Gemini."], ["The person building it", "Gatherly AI is created by Siddhant Kumar Rajput for Prompt Wars Virtual, Challenge Five."], ["Open source", "Review the project and contact the developer through the public GitHub repository."]],
  } : {
    title: "Terms of use",
    intro: "Gatherly AI helps organize plans. It does not provide vendor bookings, quotes, guarantees, or professional advice.",
    sections: [["Planning suggestions", "AI generated ideas, schedules and budget figures are drafts. Check details, prices, availability, safety and suitability with the relevant people and vendors."], ["Vendor listings", "Grounded place names and links come from Google Maps. Details such as ratings, photos, addresses, and opening hours may not be available in every search. Confirm current information and all arrangements directly with a vendor. Saving a vendor or marking it confirmed in your workspace is not a booking or payment."], ["Your account", "Use your own Google account and keep your sign-in secure. Do not add sensitive personal information to AI notes. By using the app, you understand that its features are provided as a planning aid."]],
  };
  return <main className="info-page"><nav className="landing-nav" aria-label="Site navigation"><a className="landing-brand" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}><LogoMark/><span>Gatherly<span> AI</span></span></a><button className="landing-signin landing-signup" onClick={() => onNavigate("/")}>Home</button></nav><article><a className="back-link" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}><ArrowLeft size={14}/> Gatherly AI</a><h1>{content.title}</h1><p className="info-intro">{content.intro}</p>{content.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}{route === "/about" && <a className="primary-button" href="https://github.com/Siddhant-Kumar-Rajput/Gatherly-AI" target="_blank" rel="noreferrer">View public repository <ExternalLink size={15}/></a>}</article><AppFooter onNavigate={onNavigate}/></main>;
}

function LogoMark() { return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="20" height="20" fill="none"><path d="M16 3.5c1.7 6.2 5 9.5 12.5 12.5C21 19 17.7 22.3 16 28.5 14.3 22.3 11 19 3.5 16 11 13 14.3 9.7 16 3.5Z" fill="currentColor"/><circle cx="25.5" cy="6.5" r="2.5" fill="#E8B26F"/><circle cx="6.5" cy="25.5" r="2" fill="#E8B26F"/></svg></span>; }
function GoogleMark() { return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M21.35 12.2c0-.7-.06-1.37-.18-2.02H12v3.82h5.23a4.48 4.48 0 0 1-1.94 2.94v2.4h3.15c1.84-1.7 2.91-4.2 2.91-7.14Z"/><path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.15-2.4c-.87.58-1.98.93-3.3.93-2.54 0-4.7-1.72-5.47-4.04H3.27v2.48A9.73 9.73 0 0 0 12 21.6Z"/><path fill="#FBBC05" d="M6.53 13.73A5.85 5.85 0 0 1 6.23 12c0-.6.1-1.18.3-1.73V7.8H3.27A9.73 9.73 0 0 0 2.23 12c0 1.57.38 3.05 1.04 4.2l3.26-2.47Z"/><path fill="#EA4335" d="M12 6.23c1.44 0 2.73.5 3.75 1.48l2.8-2.8A9.36 9.36 0 0 0 12 2.4a9.73 9.73 0 0 0-8.73 5.4l3.26 2.47c.77-2.32 2.93-4.04 5.47-4.04Z"/></svg>; }

function EventCard({ event, onOpen }: { event: EventRecord; onOpen: () => void }) {
  const complete = completionPercent(event);
  const d = daysUntil(event.date);
  return <button className={`event-card ${event.kind.toLowerCase()}`} onClick={onOpen}>
    <span className="card-topline"><span className={`kind-pill ${event.kind.toLowerCase()}`}>{eventKindLabel(event)}</span><span className="days-pill">{d < 0 ? "Date passed" : d === 0 ? "Today" : `${d} days to go`}</span></span>
    <span className="event-card-title">{event.title}</span><span className="event-card-meta"><span><CalendarDays size={14}/>{formatEventDate(event.date, { day: "numeric", month: "short", year: "numeric" })}</span><span><MapPin size={14}/>{event.city}</span></span>
    <span className="card-rule"></span><span className="event-card-bottom"><span><Users size={15}/>{event.guests} guests</span><span className="budget-mini"><span className="mini-progress"><i style={{ width: `${Math.min(100, event.budget ? budgetUsed(event) / event.budget * 100 : 0)}%` }}></i></span>{money(budgetRemaining(event))} left</span></span>
    <span className="event-progress"><span><i style={{ width: `${complete}%` }}></i></span><small>{complete}% checklist</small></span>
  </button>;
}

function EventWorkspace({ event, onUpdate, onToggleTask, onVendorStatus, onAI, onAddGuest, onAddPlaces, onAddGroundedPlace, placeResults, hasNextPlaces, placesConfigured, busy, query, setQuery, cityDraft, setCityDraft, onLocation, onNotice }: {
  event: EventRecord; onUpdate: (patch: Partial<EventRecord>) => void; onToggleTask: (id: string) => void; onVendorStatus: (id: string, status: EventVendor["status"]) => void; onAI: () => void; onAddGuest: () => void; onAddPlaces: (nextPage?: boolean) => void; onAddGroundedPlace: (place: GroundedPlace) => void; placeResults: GroundedPlace[]; hasNextPlaces: boolean; placesConfigured: boolean; busy: string; query: string; setQuery: (q: string) => void; cityDraft: string; setCityDraft: (c: string) => void; onLocation: () => void; onNotice: (s: string) => void;
}) {
  const [tab, setTab] = useState<"overview" | "vendors" | "guests">("overview");
  const [expanded, setExpanded] = useState<string | null>(null);
  const categories = event.vendorCategories.length ? event.vendorCategories : categoriesFor(event.kind, event.customKind);
  const used = budgetUsed(event); const remaining = budgetRemaining(event); const tasksDone = event.tasks.filter((task) => task.done).length;
  const sortedTasks = [...event.tasks].sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  return <>
    <div className="event-title-row"><div><p className="event-context">{eventKindLabel(event)} · Event workspace</p><h1>{event.title}</h1><div className="event-byline"><span><CalendarDays size={15}/>{formatEventDate(event.date)}</span><span><MapPin size={15}/>{event.city}</span><span><Users size={15}/>{event.guests} guests</span></div></div><button className="primary-button" onClick={onAI}><Sparkles size={17}/>AI plan</button></div>
    <div className="workspace-tabs" role="tablist" aria-label="Event sections">{([ ["overview","Overview"], ["vendors",`Vendors${event.vendors.length ? ` · ${event.vendors.length}` : ""}`], ["guests",`Guest list${event.guestsList.length ? ` · ${event.guestsList.length}` : ""}`] ] as const).map(([id,label]) => <button role="tab" aria-selected={tab===id} className={tab===id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "overview" && <>
      {event.aiSummary && <div className="ai-summary"><span><Sparkles size={17}/></span><p>{event.aiSummary}<small>AI first draft · Review estimates with local vendors</small>{event.aiIdeas?.length ? <span className="ai-ideas" aria-label="Personalized ideas">{event.aiIdeas.map((idea,index)=><span key={`${index}-${idea}`}>{idea}</span>)}</span> : null}</p><button className="icon-button" aria-label="Dismiss AI summary" onClick={() => onUpdate({ aiSummary: undefined, aiIdeas: undefined })}><X size={15}/></button></div>}
      <div className="workspace-grid"><div className="workspace-left">
        <section className="panel budget-panel"><div className="panel-title"><div><h2>Budget, at a glance</h2><p>Planning estimates · INR</p></div><button className="icon-button" aria-label="Generate budget plan" onClick={onAI}><Sparkles size={17}/></button></div><div className="budget-stats"><div><span>Planning budget</span><strong>{formatINR(event.budget)}</strong></div><div><span>Estimate / quotes</span><strong>{formatINR(used)}</strong></div><div><span>Still available</span><strong className={remaining < 0 ? "negative-text" : "teal-text"}>{formatINR(remaining)}</strong></div></div><div className="budget-bar"><i style={{ width: `${Math.max(0, Math.min(100, event.budget ? used / event.budget * 100 : 0))}%` }}></i></div>
          <div className="budget-lines">{event.budgetLines.length ? event.budgetLines.map((line) => <div className="budget-line" key={line.id}><span className="line-dot"></span><span className="line-label">{line.category}<small>{line.status === "estimate" ? "Planning estimate" : line.status === "quoted" ? "Vendor quote" : "Paid"}</small></span><strong>{formatINR(line.quoted ?? line.estimate)}</strong><button className="icon-button mini" aria-label={`Edit ${line.category} budget`} onClick={() => { const value = window.prompt(`Enter updated estimate for ${line.category} (INR):`, String(line.quoted ?? line.estimate)); if (value && Number.isFinite(Number(value))) onUpdate({ budgetLines: event.budgetLines.map((item) => item.id === line.id ? { ...item, quoted: Number(value), status: "quoted" } : item) }); }}><ChevronDown size={15}/></button></div>) : <div className="inline-empty">No budget breakdown yet. Ask AI for an editable first draft.</div>}</div>
          <button className="panel-link" onClick={onAI}>Build or refresh budget <ArrowRight size={15}/></button>
        </section>
        <section className="panel checklist-panel"><div className="panel-title"><div><h2>A few things to do</h2><p>{tasksDone} of {event.tasks.length} complete · {event.tasks.length - tasksDone} still on the list</p></div><button className="text-button" onClick={onAI}>AI timeline <ArrowRight size={15}/></button></div>
          {sortedTasks.length ? <div className="checklist">{sortedTasks.map((task) => <TaskRow key={task.id} task={task} onToggle={() => onToggleTask(task.id)}/>)}</div> : <div className="inline-empty">The timeline is a blank page. Generate a plan to add thoughtful next steps.</div>}
          {event.tasks.length > 0 && <button className="panel-link" onClick={() => onNotice("Timeline is editable through the AI plan. More task editing is coming soon.")}>See full timeline <ArrowRight size={15}/></button>}
        </section>
      </div><aside className="workspace-right">
        <div className="side-heading"><h2>Venue & vendor shortlist</h2><button className="text-button" onClick={() => setTab("vendors")}>See all <ArrowRight size={15}/></button></div>
        <section className="panel vendor-panel"><div className="vendor-intro"><span className="vendor-sparkle"><Compass size={17}/></span><div><strong>Find the right people</strong><p>Five grounded options at a time. You confirm directly.</p></div></div><div className="location-controls"><label className="sr-only" htmlFor="vendor-city">Search area</label><input id="vendor-city" value={cityDraft} onChange={(e)=>setCityDraft(e.target.value)} placeholder="City or neighbourhood"/><button className="icon-button" aria-label="Use my location" onClick={onLocation}><MapPin size={16}/></button></div><div className="search-row"><label className="sr-only" htmlFor="vendor-category">Vendor category</label><input id="vendor-category" list="vendor-category-options" value={query || categories[0]} onChange={(e)=>setQuery(e.target.value)} placeholder="Cafe, cake shop, banquet…"/><datalist id="vendor-category-options">{categories.map((category)=><option key={category} value={category}/>)}</datalist><button className="search-button" disabled={busy === "places" || !placesConfigured} onClick={()=>onAddPlaces(false)}>{busy === "places" ? <LoaderCircle className="spin" size={16}/> : <Search size={16}/>}<span>Find</span></button></div>{!placesConfigured && <p className="maps-key-note">Add a Gemini AI Studio key as <code>VITE_GEMINI_API_KEY</code> to enable Google Maps-grounded search. No Maps Platform billing key is needed.</p>}
          {placeResults.length > 0 && <><p className="grounding-attribution">Places grounded by <span translate="no">Google Maps</span> · Showing {placeResults.length} options</p><div className="grounded-results">{placeResults.map((place)=><GroundedPlaceCard key={place.id} place={place} saved={event.vendors.some((vendor)=>vendor.mapsUrl===place.mapsUrl)} onInterested={()=>onAddGroundedPlace(place)}/>)}</div>{hasNextPlaces && <button className="panel-link" disabled={busy === "places"} onClick={()=>onAddPlaces(true)}>{busy === "places" ? "Finding more…" : "Next five places"}<ArrowRight size={15}/></button>}</>}
          <div className="vendor-shortlist">{event.vendors.slice(0, 3).map((vendor) => <VendorRow key={vendor.id} vendor={vendor} expanded={expanded===vendor.id} onExpand={()=>setExpanded(expanded===vendor.id?null:vendor.id)} onStatus={onVendorStatus}/>)}</div>
          {!event.vendors.length && <div className="vendor-empty"><div className="empty-illustration"><MapPin size={20}/></div><strong>Your shortlist starts here</strong><p>Search grounded local listings for {eventKindLabel(event).toLowerCase()} vendors. Compare and contact them yourself.</p></div>}
          <button className="panel-link" onClick={()=>setTab("vendors")}>{event.vendors.length ? "Open shortlist" : "Browse vendor categories"}<ArrowRight size={15}/></button>
        </section>
        <section className="invite-card"><div className="invite-icon"><Send size={17}/></div><h3>Good things are better together.</h3><p>Put your people on the guest list. Invitations open in your own email app.</p><button className="outline-button" onClick={onAddGuest}><Plus size={15}/>Add a guest</button></section>
        <div className="event-note"><Clock3 size={15}/><span>{daysUntil(event.date) < 0 ? "This date has passed" : daysUntil(event.date) === 0 ? "The celebration is today" : `${daysUntil(event.date)} days until the celebration`}</span></div>
      </aside></div>
    </>}
    {tab === "vendors" && <section className="panel full-panel"><div className="panel-title"><div><h2>Vendor shortlist</h2><p>Interested vendors are saved here. Confirm after you contact and agree with them.</p></div></div><div className="vendor-category-chips">{categories.map((c)=><button key={c} className={`category-chip ${query===c?"selected":""}`} onClick={()=>setQuery(c)}>{c}</button>)}</div><div className="vendor-search-large"><input aria-label="City" value={cityDraft} onChange={(e)=>setCityDraft(e.target.value)} placeholder="City or neighbourhood"/><input aria-label="Vendor type" list="vendor-category-options" value={query || categories[0]} onChange={(e)=>setQuery(e.target.value)} placeholder="Cafe, cake shop, banquet…"/><datalist id="vendor-category-options">{categories.map((c)=><option key={c} value={c}/>)}</datalist><button className="primary-button" disabled={busy === "places" || !placesConfigured} onClick={()=>onAddPlaces(false)}>{busy === "places"?<LoaderCircle className="spin" size={16}/>:<Search size={16}/>}Find local vendors</button></div>{!placesConfigured && <p className="maps-key-note">Set <code>VITE_GEMINI_API_KEY</code> to enable Google Maps-grounded discovery. A Maps Platform billing key is not required.</p>}{placeResults.length > 0 && <><p className="grounding-attribution">Places grounded by <span translate="no">Google Maps</span> · Showing {placeResults.length} options</p><div className="grounded-results">{placeResults.map((place)=><GroundedPlaceCard key={place.id} place={place} saved={event.vendors.some((vendor)=>vendor.mapsUrl===place.mapsUrl)} onInterested={()=>onAddGroundedPlace(place)}/>)}</div>{hasNextPlaces && <button className="panel-link" disabled={busy === "places"} onClick={()=>onAddPlaces(true)}>{busy === "places" ? "Finding more…" : "Next five places"}<ArrowRight size={15}/></button>}</>}{event.vendors.length ? <div className="vendor-list">{event.vendors.map(vendor=><VendorRow key={vendor.id} vendor={vendor} expanded={expanded===vendor.id} onExpand={()=>setExpanded(expanded===vendor.id?null:vendor.id)} onStatus={onVendorStatus}/>)}</div> : <div className="empty-state wide-empty"><Compass size={22}/><strong>Your shortlist is ready for its first name.</strong><p>Choose a category and search to find local options.</p></div>}</section>}
    {tab === "guests" && <section className="panel full-panel"><div className="panel-title"><div><h2>The people who make it special</h2><p>{event.guestsList.length} guests · invitations are opened and sent by you</p></div><button className="primary-button" onClick={onAddGuest}><Plus size={16}/>Add guests</button></div>{event.guestsList.length ? <div className="guest-list">{event.guestsList.map(guest=><div className="guest-row" key={guest.id}><span className="guest-avatar">{guest.name[0]}</span><span className="guest-name"><strong>{guest.name}</strong><small>{guest.email || "No email added"}</small></span><span className={`guest-status ${guest.invited?"sent":"pending"}`}>{guest.invited?"Invitation prepared":"Not invited"}</span><a className="outline-button compact" href={emailInviteUrl(event, guest.name, guest.email)} onClick={()=>onUpdate({ guestsList:event.guestsList.map(item=>item.id===guest.id?{...item,invited:true}:item)})}><Send size={14}/>Prepare invite</a></div>)}</div> : <div className="empty-state wide-empty"><Users size={22}/><strong>Every good gathering starts with its people.</strong><p>Add guests, then open a personal invitation in your email app.</p><button className="outline-button" onClick={onAddGuest}><Plus size={15}/>Add first guest</button></div>}</section>}
  </>;
}

function VendorRow({ vendor, expanded, onExpand, onStatus }: { vendor: EventVendor; expanded: boolean; onExpand: () => void; onStatus: (id: string, status: EventVendor["status"]) => void }) {
  return <div className="vendor-row-wrap"><div className="vendor-row"><button className="vendor-row-main" onClick={onExpand} aria-expanded={expanded}><span className="vendor-initial">{vendor.name[0]}</span><span className="vendor-name"><strong>{vendor.name}</strong><small>{vendor.category}{vendor.rating ? ` · Rating ${vendor.rating}${vendor.reviewCount ? ` (${vendor.reviewCount})` : ""}` : ""}</small></span></button><button className={`status-button ${vendor.status.toLowerCase()}`} onClick={()=>onStatus(vendor.id,vendor.status === "Confirmed" ? "Interested" : "Confirmed")} aria-label={`${vendor.status === "Confirmed" ? "Mark as interested" : "Confirm"} ${vendor.name}`}>{vendor.status === "Confirmed" ? <><Check size={13}/>Confirmed</> : <><Heart size={13}/>Interested</>}</button></div>{expanded && <div className="vendor-details">{vendor.address && <p><MapPin size={14}/>{vendor.address}</p>}{vendor.phone && <a href={`tel:${vendor.phone}`}><span>Call vendor</span>{vendor.phone}</a>}{vendor.mapsUrl && <a href={vendor.mapsUrl} target="_blank" rel="noreferrer"><span>Open in Google Maps</span><ExternalLink size={13}/></a>}{vendor.source==="sample"&&<small>Illustrative sample vendor. Not a real booking.</small>}{!vendor.phone&&!vendor.mapsUrl&&!vendor.address&&<p>Contact information is not available here.</p>}</div>}</div>;
}

function GroundedPlaceCard({ place, saved, onInterested }: { place: GroundedPlace; saved: boolean; onInterested: () => void }) {
  return <article className="grounded-place-card">
    {place.photoUrl ? <img className="grounded-place-photo" src={place.photoUrl} alt={`${place.name}`} loading="lazy"/> : <span className="grounded-place-placeholder" aria-hidden="true"><MapPin size={20}/></span>}
    <div className="grounded-place-copy"><strong>{place.name}</strong>{place.rating ? <span className="place-rating" aria-label={`Rating ${place.rating} out of 5`}>★ {place.rating.toFixed(1)}</span> : null}{place.description && <small>{place.description}</small>}<a href={place.mapsUrl} target="_blank" rel="noreferrer">Open in Google Maps <ExternalLink size={13}/></a></div>
    <button className={`status-button ${saved ? "confirmed" : ""}`} onClick={onInterested} disabled={saved}>{saved ? <><Check size={13}/>Saved</> : <><Heart size={13}/>Interested</>}</button>
  </article>;
}

function TaskRow({ task, onToggle }: { task: PlanTask; onToggle: () => void }) {
  return <div className={`check-row ${task.done ? "done" : ""}`}><button className="check-control" aria-label={`${task.done ? "Mark incomplete" : "Mark complete"}: ${task.title}`} aria-pressed={task.done} onClick={onToggle}>{task.done&&<Check size={13}/>}</button><span className="check-copy"><strong>{task.title}</strong><small>{task.category}</small></span><span className="check-date">{formatEventDate(task.dueDate, { day: "numeric", month: "short" })}</span></div>;
}

function Dialog({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};document.addEventListener("keydown",onKey);return()=>document.removeEventListener("keydown",onKey);},[onClose]);
  return <div className="dialog-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-head"><div><p className="event-context">Gatherly AI</p><h2 id="dialog-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>{children}</section></div>;
}

function EventForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const [kind,setKind]=useState<EventKind>("Birthday");
  return <form className="form-stack" action={(data)=>onSubmit(data)}><label>What are we celebrating?<input name="title" autoFocus required maxLength={80} placeholder="Mira's 30th birthday"/></label><label>Event type<select name="kind" value={kind} onChange={(e)=>setKind(e.target.value as EventKind)}>{kinds.map(k=><option key={k}>{k}</option>)}</select></label>{kind==="Custom"&&<label>Tell us the occasion<input name="customKind" required maxLength={40} placeholder="A retirement brunch"/></label>}<div className="form-two"><label>Date<input name="date" type="date" min={new Date().toISOString().slice(0,10)} required /></label><label>Guest count<input name="guests" type="number" min="1" max="100000" required /></label></div><label>City or neighbourhood<input name="city" required maxLength={100} placeholder="Bengaluru, Karnataka"/></label><label>Planning budget <span className="field-note">(INR)</span><input name="budget" type="number" min="0" max="1000000000" step="1000" required /></label><p className="form-note"><MapPin size={14}/>Location is optional to share. You can type a city instead.</p><button className="primary-button full-button" type="submit"><Plus size={16}/>Create event workspace</button></form>;
}

function AIForm({ event, busy, onSubmit }: { event: EventRecord; busy: boolean; onSubmit: (budget: number, guests: number, date: string, preferences: string) => void }) {
  return <form className="form-stack" onSubmit={(e)=>{e.preventDefault();const data=new FormData(e.currentTarget);onSubmit(Number(data.get("budget")),Number(data.get("guests")),String(data.get("date")),String(data.get("preferences")));}}><div className="form-two"><label>Maximum budget (INR)<input name="budget" type="number" min="1000" max="1000000000" required defaultValue={event.budget}/></label><label>Guest count<input name="guests" type="number" min="1" max="100000" required defaultValue={event.guests}/></label></div><label>Celebration date<input name="date" type="date" required defaultValue={event.date}/></label><label>Style or preferences <span className="field-note">(optional)</span><textarea name="preferences" maxLength={600} rows={3} placeholder="Rooftop dinner, vegetarian menu, relaxed and playful…"/></label><div className="ai-caveat"><Sparkles size={15}/><p>Gemini makes a planning draft, not a booking. Budget figures are high-side estimates and should be verified with vendors.</p></div><button className="primary-button full-button" type="submit" disabled={busy}>{busy?<><LoaderCircle className="spin" size={16}/>Making your first draft…</>:<><Sparkles size={16}/>Create my plan</>}</button></form>;
}

function GuestForm({ onSubmit }: { onSubmit: (data: FormData) => void }) { return <form className="form-stack" action={onSubmit}><label>Guest name<input name="name" autoFocus required maxLength={80} placeholder="Aarav Mehta"/></label><label>Email <span className="field-note">(optional)</span><input name="email" type="email" maxLength={254} placeholder="name@domain.test"/></label><p className="form-note"><Send size={14}/>Gatherly opens your email app; it never sends invitations without your action.</p><button className="primary-button full-button" type="submit"><Plus size={16}/>Add to guest list</button></form>; }
