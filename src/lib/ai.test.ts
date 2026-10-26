import { beforeEach, describe, expect, it, vi } from "vitest";

const planResponse = {
  summary: "A relaxed birthday lunch.", highSideTotal: 100000, contingency: 15000,
  budgetLines: [{ category: "Food", highEstimate: 70000, rationale: "Sample estimate." }, { category: "Cake", highEstimate: 30000, rationale: "Sample estimate." }],
  tasks: [{ title: "Confirm venue", dueDate: "2030-01-01", category: "Venue" }],
  vendorCategories: ["Restaurants"], ideas: ["Add a playlist."],
};

function successResponse(plan = planResponse) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] }), { status: 200 });
}

describe("generateEventPlan", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "test-key-1");
    vi.stubEnv("VITE_GEMINI_API_KEY_2", "test-key-2");
    vi.stubEnv("VITE_GEMINI_API_KEY_3", "test-key-3");
    fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  it("calls the Gemini API with a protected header and structured plan schema", async () => {
    const { generateEventPlan } = await import("./ai");
    const plan = await generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "relaxed" });

    expect(plan.summary).toBe(planResponse.summary);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(options.headers["x-goog-api-key"]).toBe("test-key-1");
    expect(url).not.toContain("test-key-1");
    const body = JSON.parse(options.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(1200);
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("MINIMAL");
    expect(body.generationConfig.responseSchema.required).toContain("budgetLines");
    expect(plan.budgetLines.reduce((sum, line) => sum + line.highEstimate, 0)).toBeLessThanOrEqual(60000);
    expect(plan.contingency).toBeLessThanOrEqual(60000 - plan.highSideTotal);
    expect(plan.tasks[0].dueDate).toBe("2027-06-12");
    expect(plan.vendorCategories).toEqual(["Restaurants"]);
  });

  it("rotates to another new auth key only when the first is rejected", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "API key not authorized" } }), { status: 403 }))
      .mockResolvedValueOnce(successResponse());
    const { generateEventPlan } = await import("./ai");

    await generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "" });

    expect(fetchMock.mock.calls.map((call) => call[1].headers["x-goog-api-key"])).toEqual(["test-key-1", "test-key-2"]);
  });

  it("falls back to Gemini Flash when Flash-Lite is temporarily unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Service unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(successResponse());
    const { generateEventPlan } = await import("./ai");

    const plan = await generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "" });

    expect(plan.summary).toBe(planResponse.summary);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("gemini-3.5-flash-lite"), expect.stringContaining("gemini-3.8-flash"),
    ]);
  });

  it("skips a stalled Flash-Lite model and tries Flash immediately", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("Timed out"), { name: "TimeoutError" })).mockResolvedValueOnce(successResponse());
    const { generateEventPlan } = await import("./ai");

    await generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "" });

    expect(String(fetchMock.mock.calls[1][0])).toContain("gemini-3.8-flash");
  });

  it("surfaces empty model responses as a useful error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), { status: 200 }));
    const { generateEventPlan } = await import("./ai");
    await expect(generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "" })).rejects.toThrow("returned an empty response");
  });
});
