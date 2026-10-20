import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Compass, ExternalLink, Heart, LayoutDashboard, LoaderCircle, LogIn, MapPin, Menu, Plus, Search, Send, Sparkles, Users, X } from "lucide-react";
import { DEMO_EVENTS } from "./data/demo";
import { categoriesFor, budgetRemaining, budgetUsed, completionPercent, daysUntil, emailInviteUrl, eventKindLabel, formatEventDate, formatINR } from "./lib/domain";
import { demoMode, firebaseConfigured } from "./lib/config";
import type { EventKind, EventRecord, EventVendor, PlanTask } from "./types";

type User = { uid: string; displayName: string; email: string; photoURL?: string };
const kinds: EventKind[] = ["Wedding", "Birthday", "Community", "Custom"];
const money = (n: number) => formatINR(n, true);
const newId = () => crypto.randomUUID();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [events, setEvents] = useState<EventRecord[]>(DEMO_EVENTS);
  const [activeId, setActiveId] = useState(DEMO_EVENTS[1].id);
  const [screen, setScreen] = useState<"overview" | "event">("overview");
  const [dialog, setDialog] = useState<"event" | "ai" | "guest" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const active = events.find((event) => event.id === activeId) || events[0];

  useEffect(() => {
    if (!firebaseConfigured) return;
    let cancelled = false;
    let unsubscribe = () => {};
    void import("./lib/firebase").then(({ auth }) => {
      if (cancelled || !auth) return;
      return import("firebase/auth").then(({ onAuthStateChanged }) => {
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(auth, (signed) => setUser(signed ? { uid: signed.uid, displayName: signed.displayName || "Gatherly member", email: signed.email || "", photoURL: signed.photoURL || undefined } : null));
      });
    }).catch(() => setNotice("Firebase could not initialize. Check your project configuration."));
    return () => { cancelled = true; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!user || !firebaseConfigured || demoMode) return;
    let cancelled = false;
    let unsubscribe = () => {};
    void import("./lib/firebase").then(({ watchEvents }) => {
      if (cancelled) return;
      unsubscribe = watchEvents(user.uid, (cloudEvents) => {
        setEvents((current) => {
          const samples = current.filter((event) => event.isSample);
          return [...samples, ...cloudEvents.map((event) => ({ ...event, isSample: false }))];
        });
      }, () => setNotice("Could not sync your events. Check your Firestore rules and connection."));
    }).catch(() => setNotice("Cloud sync could not start. Check your Firebase configuration."));
    return () => { cancelled = true; unsubscribe(); };
  }, [user]);

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); }, [notice]);

  const persist = async (event: EventRecord) => {
    setEvents((all) => all.some((item) => item.id === event.id) ? all.map((item) => item.id === event.id ? event : item) : [event, ...all]);
    if (!event.isSample && user && !demoMode) {
      try { const { saveEvent } = await import("./lib/firebase"); await saveEvent(user.uid, event); } catch { setNotice("Saved locally for this session, but cloud sync failed. Check your Firebase rules."); }
    }
  };

  const login = async () => {
    setBusy("login");
    try { const { signInWithGoogle } = await import("./lib/firebase"); const signed = await signInWithGoogle(); setUser({ uid: signed.uid, displayName: signed.displayName || "Gatherly member", email: signed.email || "", photoURL: signed.photoURL || undefined }); setNotice("Signed in with Google."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Google sign-in failed."); }
    finally { setBusy(""); }
  };

  const logout = async () => { const { signOutUser } = await import("./lib/firebase"); await signOutUser(); setUser(null); setNotice("You are signed out. Sample events remain available."); };

  const createEvent = (form: FormData) => {
    const kind = form.get("kind") as EventKind;
    const customKind = String(form.get("customKind") || "").trim();
    const event: EventRecord = {
      id: newId(), title: String(form.get("title")).trim(), kind, customKind: kind === "Custom" ? customKind : undefined,
      date: String(form.get("date")), city: String(form.get("city")).trim(), guests: Math.max(1, Number(form.get("guests"))), budget: Math.max(0, Number(form.get("budget"))), style: "",
      budgetLines: [], tasks: [], vendorCategories: categoriesFor(kind, customKind), vendors: [], guestsList: [], isSample: false,
    };
    setEvents((all) => [event, ...all]); setActiveId(event.id); setScreen("event"); setDialog(null); void persist(event); setNotice("Your event workspace is ready.");
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

  const addPlaces = async () => {
    if (!cityDraft.trim()) return;
    setBusy("places");
    try {
      const { searchLocalPlaces } = await import("./lib/maps");
      const places = await searchLocalPlaces(query || active.vendorCategories[0] || "event venue", cityDraft);
      const additions = places.map((place) => ({ id: place.id, placeId: place.id, name: place.name, category: query || active.vendorCategories[0] || "Vendor", status: "Interested" as const, address: place.address, phone: place.phone, mapsUrl: place.mapsUrl, rating: place.rating, reviewCount: place.reviewCount, source: "google" as const }));
      updateEvent({ city: cityDraft, vendors: [...active.vendors, ...additions.filter((place) => !active.vendors.some((vendor) => vendor.placeId === place.placeId))] }); setNotice(`${places.length} Google Maps results added to your shortlist. Contact them to confirm availability.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load vendor results."); }
    finally { setBusy(""); }
  };

  const requestLocation = () => {
    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) { setNotice("Location lookup needs a restricted Google Maps key. You can type a city instead."); return; }
    if (!navigator.geolocation) { setNotice("Location access is not available in this browser. Enter a city instead."); return; }
    setBusy("location");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      setBusy("");
      try {
        const { cityForCoordinates } = await import("./lib/maps");
        const city = await cityForCoordinates(coords.latitude, coords.longitude);
        if (city) setCityDraft(city); else setNotice("We couldn't identify a city from this location. Type it in instead.");
      } catch { setNotice("Could not look up your location. You can enter a city manually."); }
    }, () => { setBusy(""); setNotice("Location was not shared. You can enter a city manually."); }, { timeout: 10000, maximumAge: 300000 });
  };

  const filteredEvents = events.filter((event) => `${event.title} ${event.city} ${event.kind}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Main navigation">
      <div className="brand"><span className="brand-mark"><Sparkles size={17}/></span><span>gatherly<span className="brand-ai">.ai</span></span><button className="mobile-close icon-button" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18}/></button></div>
      <div className="workspace-label">Your workspace</div>
      <nav className="nav-list">
        <button className={`nav-item ${screen === "overview" ? "selected" : ""}`} onClick={() => { setScreen("overview"); setMenuOpen(false); }}><LayoutDashboard size={17}/>Overview</button>
        <button className={`nav-item ${screen === "event" ? "selected" : ""}`} onClick={() => { setScreen("event"); setMenuOpen(false); }}><CalendarDays size={17}/>My events<span className="nav-count">{events.length}</span></button>
      </nav>
      <div className="sidebar-label-row"><span>Upcoming</span><button className="icon-button mini" aria-label="Create event" onClick={() => setDialog("event")}><Plus size={15}/></button></div>
      <div className="event-nav-list">{events.slice(0, 4).map((event) => <button key={event.id} className={`event-nav ${activeId === event.id ? "active" : ""}`} onClick={() => { setActiveId(event.id); setScreen("event"); setMenuOpen(false); }}><span className={`event-dot ${event.kind.toLowerCase()}`}></span><span className="nav-event-title">{event.title}</span><ChevronRight size={14}/></button>)}</div>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => setNotice("Need help? Review the README for setup and privacy details.")}><CircleHelp size={17}/>Help & support</button>
        <div className="user-block">{user?.photoURL ? <img src={user.photoURL} alt=""/> : <span className="avatar">{user?.displayName?.[0] || "G"}</span>}<div className="user-meta"><strong>{user?.displayName || "Guest planner"}</strong><small>{user?.email || (demoMode ? "Demo workspace" : "Sign in to sync")}</small></div><button className="icon-button" aria-label={user ? "Sign out" : "Sign in with Google"} onClick={user ? logout : login}>{user ? <ChevronDown size={16}/> : <LogIn size={16}/>}</button></div>
      </div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)}></button>}
    <main className="main-content">
      <header className="mobile-header"><button className="icon-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={19}/></button><span>gatherly<span className="brand-ai">.ai</span></span><button className="icon-button" aria-label="Create event" onClick={() => setDialog("event")}><Plus size={20}/></button></header>
      <div className="content-wrap">
        <div className="topline"><span>{screen === "overview" ? new Intl.DateTimeFormat("en-IN", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()) : <><button className="back-link" onClick={() => setScreen("overview")}><ArrowLeft size={14}/> Events</button><span className="crumb-divider">/</span>{active.title}</>}</span><button className="avatar top-avatar" aria-label={user ? `Signed in as ${user.displayName}` : "Guest profile"} onClick={user ? logout : login}>{user?.photoURL ? <img src={user.photoURL} alt=""/> : user?.displayName?.[0] || "G"}</button></div>
        {screen === "overview" ? <>
          <section className="greeting-row"><div><h1>Make room for <em>the good stuff.</em></h1><p className="subtitle">The details are in good hands. Here’s what’s taking shape.</p></div><button className="primary-button" onClick={() => setDialog("event")}><Plus size={17}/>Plan an event</button></section>
          <section className="overview-layout">
            <div className="overview-main">
              <div className="section-head"><div><h2>Your celebrations</h2><p>Every gathering, thoughtfully in progress.</p></div><button className="text-button" onClick={() => setScreen("event")}>All events <ArrowRight size={15}/></button></div>
              <div className="event-grid">{filteredEvents.map((event) => <EventCard key={event.id} event={event} onOpen={() => { setActiveId(event.id); setScreen("event"); }} />)}</div>
              {filteredEvents.length === 0 && <div className="empty-state">No events match “{query}”. Try another search.</div>}
              <div className="section-head upcoming-title"><div><h2>Coming up next</h2><p>A quick look at what needs your attention.</p></div><button className="circle-arrow" aria-label="View next event" onClick={() => { const next = [...events].sort((a,b) => a.date.localeCompare(b.date))[0]; if(next){setActiveId(next.id);setScreen("event");}}}><ArrowDownRight size={17}/></button></div>
              <div className="task-preview">{events.flatMap((event) => event.tasks.filter((task) => !task.done).map((task) => ({ ...task, eventTitle: event.title, eventId: event.id }))).slice(0, 4).map((task) => <button className="task-row" key={`${task.eventId}-${task.id}`} onClick={() => { setActiveId(task.eventId); setScreen("event"); }}><span className="task-check"></span><span className="task-main"><strong>{task.title}</strong><small>{task.eventTitle}</small></span><span className="task-date">{formatEventDate(task.dueDate, { day: "numeric", month: "short" })}</span><ChevronRight size={15}/></button>)}{events.every((event) => event.tasks.every((task) => task.done)) && <div className="empty-state">You’re all caught up. Add an event to start planning.</div>}</div>
            </div>
            <aside className="overview-rail">
              <div className="section-head rail-heading"><div><h2>At a glance</h2><p>Your planning, in a nutshell.</p></div></div>
              <div className="glance-card"><div className="glance-top"><span className="glance-icon"><CalendarDays size={17}/></span><span>In the calendar</span></div><div className="glance-number">{events.length} <small>events</small></div><div className="glance-divider"></div><div className="glance-facts"><span>Next celebration</span><strong>{events.length ? [...events].sort((a,b)=>a.date.localeCompare(b.date))[0].title : "Nothing planned yet"}</strong></div></div>
              <div className="rail-section-title">A helpful nudge</div><div className="nudge-card"><span className="nudge-icon"><Sparkles size={17}/></span><h3>Start with the big three.</h3><p>Set your date, guest count, and budget. Gatherly can turn them into a first-pass plan in moments.</p><button className="text-button" onClick={() => setDialog("ai")}>Try AI planner <ArrowRight size={15}/></button></div>
              <div className="privacy-note"><span className="privacy-dot"></span><p>{demoMode ? "You're exploring with sample data. Sign in and connect Firebase to save your own events." : user ? "Your event details stay in your private workspace." : "Sign in with Google to keep your plans across devices."}</p></div>
            </aside>
          </section>
        </> : <EventWorkspace event={active} onUpdate={updateEvent} onToggleTask={toggleTask} onVendorStatus={setVendorStatus} onAI={() => setDialog("ai")} onAddGuest={() => setDialog("guest")} onAddPlaces={addPlaces} busy={busy} query={query} setQuery={setQuery} cityDraft={cityDraft || active.city} setCityDraft={setCityDraft} onLocation={requestLocation} onNotice={setNotice} />}
      </div>
    </main>
    {dialog === "event" && <Dialog title="A new reason to celebrate" subtitle="Let’s make a little space for something wonderful." onClose={() => setDialog(null)}><EventForm onSubmit={createEvent}/></Dialog>}
    {dialog === "ai" && <Dialog title="Your plan, with a little help" subtitle="A useful first draft. You stay in charge of every decision." onClose={() => setDialog(null)}><AIForm event={active} busy={busy === "ai"} onSubmit={runAI}/></Dialog>}
    {dialog === "guest" && <Dialog title="Who’s on the list?" subtitle="Add people one at a time. Invitations are always sent by you." onClose={() => setDialog(null)}><GuestForm onSubmit={addGuest}/></Dialog>}
    {notice && <div className="toast" role="status"><CheckCircle2 size={17}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={15}/></button></div>}
  </div>;
}

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

function EventWorkspace({ event, onUpdate, onToggleTask, onVendorStatus, onAI, onAddGuest, onAddPlaces, busy, query, setQuery, cityDraft, setCityDraft, onLocation, onNotice }: {
  event: EventRecord; onUpdate: (patch: Partial<EventRecord>) => void; onToggleTask: (id: string) => void; onVendorStatus: (id: string, status: EventVendor["status"]) => void; onAI: () => void; onAddGuest: () => void; onAddPlaces: () => void; busy: string; query: string; setQuery: (q: string) => void; cityDraft: string; setCityDraft: (c: string) => void; onLocation: () => void; onNotice: (s: string) => void;
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
        <section className="panel vendor-panel"><div className="vendor-intro"><span className="vendor-sparkle"><Compass size={17}/></span><div><strong>Find the right people</strong><p>Shortlist local options. You confirm directly.</p></div></div><div className="location-controls"><label className="sr-only" htmlFor="vendor-city">Search area</label><input id="vendor-city" value={cityDraft} onChange={(e)=>setCityDraft(e.target.value)} placeholder="City or neighbourhood"/><button className="icon-button" aria-label="Use my location" onClick={onLocation}><MapPin size={16}/></button></div><div className="search-row"><label className="sr-only" htmlFor="vendor-category">Vendor category</label><select id="vendor-category" value={query || categories[0]} onChange={(e)=>setQuery(e.target.value)}>{categories.map((category)=><option key={category}>{category}</option>)}</select><button className="search-button" disabled={busy === "places"} onClick={onAddPlaces}>{busy === "places" ? <LoaderCircle className="spin" size={16}/> : <Search size={16}/>}<span>Find</span></button></div>
          <div className="vendor-shortlist">{event.vendors.slice(0, 3).map((vendor) => <VendorRow key={vendor.id} vendor={vendor} expanded={expanded===vendor.id} onExpand={()=>setExpanded(expanded===vendor.id?null:vendor.id)} onStatus={onVendorStatus}/>)}</div>
          {!event.vendors.length && <div className="vendor-empty"><div className="empty-illustration"><MapPin size={20}/></div><strong>Your shortlist starts here</strong><p>Search Google Maps for local {eventKindLabel(event).toLowerCase()} vendors. Compare and contact them yourself.</p></div>}
          <button className="panel-link" onClick={()=>setTab("vendors")}>{event.vendors.length ? "Open shortlist" : "Browse vendor categories"}<ArrowRight size={15}/></button>
        </section>
        <section className="invite-card"><div className="invite-icon"><Send size={17}/></div><h3>Good things are better together.</h3><p>Put your people on the guest list. Invitations open in your own email app.</p><button className="outline-button" onClick={onAddGuest}><Plus size={15}/>Add a guest</button></section>
        <div className="event-note"><Clock3 size={15}/><span>{daysUntil(event.date) < 0 ? "This date has passed" : daysUntil(event.date) === 0 ? "The celebration is today" : `${daysUntil(event.date)} days until the celebration`}</span></div>
      </aside></div>
    </>}
    {tab === "vendors" && <section className="panel full-panel"><div className="panel-title"><div><h2>Vendor shortlist</h2><p>Interested vendors are saved here. Confirm after you contact and agree with them.</p></div></div><div className="vendor-category-chips">{categories.map((c)=><button key={c} className={`category-chip ${query===c?"selected":""}`} onClick={()=>setQuery(c)}>{c}</button>)}</div><div className="vendor-search-large"><input aria-label="City" value={cityDraft} onChange={(e)=>setCityDraft(e.target.value)} placeholder="City or neighbourhood"/><select aria-label="Vendor type" value={query || categories[0]} onChange={(e)=>setQuery(e.target.value)}>{categories.map((c)=><option key={c}>{c}</option>)}</select><button className="primary-button" disabled={busy === "places"} onClick={onAddPlaces}>{busy === "places"?<LoaderCircle className="spin" size={16}/>:<Search size={16}/>}Find local vendors</button></div>{event.vendors.length ? <div className="vendor-list">{event.vendors.map(vendor=><VendorRow key={vendor.id} vendor={vendor} expanded={expanded===vendor.id} onExpand={()=>setExpanded(expanded===vendor.id?null:vendor.id)} onStatus={onVendorStatus}/>)}</div> : <div className="empty-state wide-empty"><Compass size={22}/><strong>Your shortlist is ready for its first name.</strong><p>Choose a category and search to find local options.</p></div>}</section>}
    {tab === "guests" && <section className="panel full-panel"><div className="panel-title"><div><h2>The people who make it special</h2><p>{event.guestsList.length} guests · invitations are opened and sent by you</p></div><button className="primary-button" onClick={onAddGuest}><Plus size={16}/>Add guests</button></div>{event.guestsList.length ? <div className="guest-list">{event.guestsList.map(guest=><div className="guest-row" key={guest.id}><span className="guest-avatar">{guest.name[0]}</span><span className="guest-name"><strong>{guest.name}</strong><small>{guest.email || "No email added"}</small></span><span className={`guest-status ${guest.invited?"sent":"pending"}`}>{guest.invited?"Invitation prepared":"Not invited"}</span><a className="outline-button compact" href={emailInviteUrl(event, guest.name, guest.email)} onClick={()=>onUpdate({ guestsList:event.guestsList.map(item=>item.id===guest.id?{...item,invited:true}:item)})}><Send size={14}/>Prepare invite</a></div>)}</div> : <div className="empty-state wide-empty"><Users size={22}/><strong>Every good gathering starts with its people.</strong><p>Add guests, then open a personal invitation in your email app.</p><button className="outline-button" onClick={onAddGuest}><Plus size={15}/>Add first guest</button></div>}</section>}
  </>;
}

function VendorRow({ vendor, expanded, onExpand, onStatus }: { vendor: EventVendor; expanded: boolean; onExpand: () => void; onStatus: (id: string, status: EventVendor["status"]) => void }) {
  return <div className="vendor-row-wrap"><div className="vendor-row"><button className="vendor-row-main" onClick={onExpand} aria-expanded={expanded}><span className="vendor-initial">{vendor.name[0]}</span><span className="vendor-name"><strong>{vendor.name}</strong><small>{vendor.category}{vendor.rating ? ` · Rating ${vendor.rating}${vendor.reviewCount ? ` (${vendor.reviewCount})` : ""}` : ""}</small></span></button><button className={`status-button ${vendor.status.toLowerCase()}`} onClick={()=>onStatus(vendor.id,vendor.status === "Confirmed" ? "Interested" : "Confirmed")} aria-label={`${vendor.status === "Confirmed" ? "Mark as interested" : "Confirm"} ${vendor.name}`}>{vendor.status === "Confirmed" ? <><Check size={13}/>Confirmed</> : <><Heart size={13}/>Interested</>}</button></div>{expanded && <div className="vendor-details">{vendor.address && <p><MapPin size={14}/>{vendor.address}</p>}{vendor.phone && <a href={`tel:${vendor.phone}`}><span>Call vendor</span>{vendor.phone}</a>}{vendor.mapsUrl && <a href={vendor.mapsUrl} target="_blank" rel="noreferrer"><span>Open in Google Maps</span><ExternalLink size={13}/></a>}{vendor.source==="sample"&&<small>Illustrative sample vendor. Not a real booking.</small>}{!vendor.phone&&!vendor.mapsUrl&&!vendor.address&&<p>Contact information is not available here.</p>}</div>}</div>;
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
  return <form className="form-stack" action={(data)=>onSubmit(data)}><label>What are we celebrating?<input name="title" autoFocus required maxLength={80} placeholder="Mira's 30th birthday"/></label><label>Event type<select name="kind" value={kind} onChange={(e)=>setKind(e.target.value as EventKind)}>{kinds.map(k=><option key={k}>{k}</option>)}</select></label>{kind==="Custom"&&<label>Tell us the occasion<input name="customKind" required maxLength={40} placeholder="A retirement brunch"/></label>}<div className="form-two"><label>Date<input name="date" type="date" min={new Date().toISOString().slice(0,10)} required defaultValue="2026-12-18"/></label><label>Guest count<input name="guests" type="number" min="1" max="100000" required defaultValue="40"/></label></div><label>City or neighbourhood<input name="city" required maxLength={100} placeholder="Bengaluru, Karnataka"/></label><label>Planning budget <span className="field-note">(INR)</span><input name="budget" type="number" min="0" max="1000000000" step="1000" required defaultValue="150000"/></label><p className="form-note"><MapPin size={14}/>Location is optional to share. You can type a city instead.</p><button className="primary-button full-button" type="submit"><Plus size={16}/>Create event workspace</button></form>;
}

function AIForm({ event, busy, onSubmit }: { event: EventRecord; busy: boolean; onSubmit: (budget: number, guests: number, date: string, preferences: string) => void }) {
  return <form className="form-stack" onSubmit={(e)=>{e.preventDefault();const data=new FormData(e.currentTarget);onSubmit(Number(data.get("budget")),Number(data.get("guests")),String(data.get("date")),String(data.get("preferences")));}}><div className="form-two"><label>Maximum budget (INR)<input name="budget" type="number" min="1000" max="1000000000" required defaultValue={event.budget}/></label><label>Guest count<input name="guests" type="number" min="1" max="100000" required defaultValue={event.guests}/></label></div><label>Celebration date<input name="date" type="date" required defaultValue={event.date}/></label><label>Style or preferences <span className="field-note">(optional)</span><textarea name="preferences" maxLength={600} rows={3} placeholder="Rooftop dinner, vegetarian menu, relaxed and playful…"/></label><div className="ai-caveat"><Sparkles size={15}/><p>Gemini makes a planning draft, not a booking. Budget figures are high-side estimates and should be verified with vendors.</p></div><button className="primary-button full-button" type="submit" disabled={busy}>{busy?<><LoaderCircle className="spin" size={16}/>Making your first draft…</>:<><Sparkles size={16}/>Create my plan</>}</button></form>;
}

function GuestForm({ onSubmit }: { onSubmit: (data: FormData) => void }) { return <form className="form-stack" action={onSubmit}><label>Guest name<input name="name" autoFocus required maxLength={80} placeholder="Aarav Mehta"/></label><label>Email <span className="field-note">(optional)</span><input name="email" type="email" maxLength={254} placeholder="name@domain.test"/></label><p className="form-note"><Send size={14}/>Gatherly opens your email app; it never sends invitations without your action.</p><button className="primary-button full-button" type="submit"><Plus size={16}/>Add to guest list</button></form>; }
