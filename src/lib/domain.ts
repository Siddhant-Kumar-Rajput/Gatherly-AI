import type { EventKind, EventPlan, EventRecord } from "../types";

export const VENDOR_CATEGORIES: Record<EventKind, string[]> = {
  Wedding: ["Banquet halls", "Caterers", "Decorators", "Photographers", "Makeup artists", "Florists"],
  Birthday: ["Restaurants", "Cake shops", "Party venues", "Decorators", "Photographers", "Entertainers"],
  Community: ["Community halls", "Caterers", "AV & sound", "Tent services", "Photographers", "Volunteers"],
  Custom: ["Venues", "Caterers", "Decorators", "Photographers", "Equipment rental"],
};

export function categoriesFor(kind: EventKind, customKind?: string): string[] {
  if (kind !== "Custom" || !customKind?.trim()) return VENDOR_CATEGORIES[kind];
  const normalized = customKind.toLowerCase();
  if (/wedding|marriage/.test(normalized)) return VENDOR_CATEGORIES.Wedding;
  if (/birth|party|anniversary/.test(normalized)) return VENDOR_CATEGORIES.Birthday;
  if (/community|fundraiser|meetup|festival/.test(normalized)) return VENDOR_CATEGORIES.Community;
  return VENDOR_CATEGORIES.Custom;
}

export function budgetUsed(event: Pick<EventRecord, "budgetLines">): number {
  return event.budgetLines.reduce((sum, line) => sum + (line.quoted ?? line.estimate), 0);
}

export function budgetRemaining(event: Pick<EventRecord, "budget" | "budgetLines">): number {
  return event.budget - budgetUsed(event);
}

export function completionPercent(event: Pick<EventRecord, "tasks">): number {
  if (!event.tasks.length) return 0;
  return Math.round((event.tasks.filter((task) => task.done).length / event.tasks.length) * 100);
}

export function daysUntil(date: string, now = new Date()): number {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

export function formatINR(value: number, compact = false): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

export function formatEventDate(date: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  return new Intl.DateTimeFormat("en-IN", options).format(new Date(`${date}T12:00:00`));
}

export function calendarSearchUrl(category: string, city: string): string {
  const query = `${category} near ${city}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function emailInviteUrl(event: Pick<EventRecord, "title" | "date" | "city">, guest?: string, email?: string): string {
  const subject = `You're invited: ${event.title}`;
  const body = `Hi${guest ? ` ${guest}` : ""},\n\nI'd love you to join me for ${event.title} on ${formatEventDate(event.date)} in ${event.city}.\n\nPlease let me know if you can make it.\n\nHope to see you there!`;
  return `mailto:${email ? encodeURIComponent(email) : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function normalizePlan(plan: EventPlan, budget: number, eventDate: string): EventPlan {
  const budgetLines = plan.budgetLines.slice(0, 8).map((line) => ({
    ...line,
    highEstimate: Math.max(0, Math.round(line.highEstimate)),
  }));
  const rawTotal = budgetLines.reduce((sum, line) => sum + line.highEstimate, 0);
  const scaled = rawTotal > budget && rawTotal > 0
    ? budgetLines.map((line) => ({ ...line, highEstimate: Math.floor((line.highEstimate / rawTotal) * budget) }))
    : budgetLines;
  const computedTotal = scaled.reduce((sum, line) => sum + line.highEstimate, 0);
  return {
    ...plan,
    highSideTotal: computedTotal,
    contingency: Math.max(0, Math.min(plan.contingency, Math.max(0, budget - computedTotal))),
    budgetLines: scaled,
    tasks: plan.tasks.slice(0, 12).map((task) => ({
      ...task,
      dueDate: task.dueDate > eventDate ? eventDate : task.dueDate,
    })),
    vendorCategories: [...new Set(plan.vendorCategories)].slice(0, 8),
    ideas: plan.ideas.slice(0, 6),
  };
}

export function eventKindLabel(event: Pick<EventRecord, "kind" | "customKind">): string {
  return event.kind === "Custom" ? event.customKind?.trim() || "Custom event" : event.kind;
}
