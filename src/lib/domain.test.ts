import { describe, expect, it } from "vitest";
import { budgetRemaining, budgetUsed, categoriesFor, completionPercent, normalizePlan } from "./domain";
import type { EventPlan } from "../types";

describe("event planning helpers", () => {
  it("selects sensible vendor categories for event type", () => {
    expect(categoriesFor("Birthday")).toContain("Cake shops");
    expect(categoriesFor("Wedding")).toContain("Banquet halls");
    expect(categoriesFor("Custom", "fundraiser")).toContain("AV & sound");
  });

  it("calculates quoted spend and remaining budget", () => {
    const event = { budget: 1000, budgetLines: [
      { id: "1", category: "Venue", estimate: 500, quoted: 600, status: "quoted" as const },
      { id: "2", category: "Cake", estimate: 100, status: "estimate" as const },
    ] };
    expect(budgetUsed(event)).toBe(700);
    expect(budgetRemaining(event)).toBe(300);
  });

  it("handles checklist completion for empty and filled lists", () => {
    expect(completionPercent({ tasks: [] })).toBe(0);
    expect(completionPercent({ tasks: [
      { id: "1", title: "First", dueDate: "2026-12-01", category: "Venue", done: true },
      { id: "2", title: "Second", dueDate: "2026-12-02", category: "Food", done: false },
    ] })).toBe(50);
  });

  it("keeps AI budget estimates and contingency within the user's cap", () => {
    const plan: EventPlan = { summary: "Draft", highSideTotal: 10000, contingency: 3000,
      budgetLines: [{ category: "Venue", highEstimate: 9000, rationale: "Room" }, { category: "Food", highEstimate: 9000, rationale: "Meals" }],
      tasks: [{ title: "Book venue", dueDate: "2027-01-01", category: "Venue" }], vendorCategories: ["Venues"], ideas: ["Toast"] };
    const normalized = normalizePlan(plan, 10000, "2026-12-01");
    expect(normalized.budgetLines.reduce((sum, line) => sum + line.highEstimate, 0) + normalized.contingency).toBeLessThanOrEqual(10000);
    expect(normalized.tasks[0].dueDate).toBe("2026-12-01");
  });
});
