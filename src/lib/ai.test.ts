import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getAI: vi.fn(() => ({ name: "test-ai" })),
  getGenerativeModel: vi.fn(),
}));

vi.mock("firebase/ai", () => ({
  getAI: mocks.getAI,
  getGenerativeModel: mocks.getGenerativeModel,
  GoogleAIBackend: class GoogleAIBackend {},
  Schema: {
    object: vi.fn((schema) => schema),
    string: vi.fn(() => "string"),
    number: vi.fn(() => "number"),
    array: vi.fn((schema) => schema),
  },
}));
vi.mock("./firebase", () => ({ firebaseApp: { name: "test-app" } }));
vi.mock("./config", () => ({ firebaseConfigured: true }));

describe("generateEventPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGenerativeModel.mockReturnValue({ generateContent: mocks.generateContent });
    mocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: "A relaxed birthday lunch.",
          highSideTotal: 100000,
          contingency: 15000,
          budgetLines: [{ category: "Food", highEstimate: 70000, rationale: "Sample estimate." }, { category: "Cake", highEstimate: 30000, rationale: "Sample estimate." }],
          tasks: [{ title: "Confirm venue", dueDate: "2030-01-01", category: "Venue" }],
          vendorCategories: ["Restaurants"],
          ideas: ["Add a playlist."],
        }),
      },
    });
  });

  it("requests structured Gemini output and normalizes its budget and dates", async () => {
    const { generateEventPlan } = await import("./ai");
    const plan = await generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "relaxed" });

    expect(mocks.getAI).toHaveBeenCalledTimes(1);
    expect(mocks.getGenerativeModel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      model: "gemini-3.8-flash",
      generationConfig: expect.objectContaining({ responseMimeType: "application/json", responseSchema: expect.anything() }),
    }));
    const modelOptions = mocks.getGenerativeModel.mock.calls[0][1];
    expect(modelOptions.generationConfig).not.toHaveProperty("temperature");
    expect(plan.budgetLines.reduce((sum, line) => sum + line.highEstimate, 0)).toBeLessThanOrEqual(60000);
    expect(plan.contingency).toBeLessThanOrEqual(60000 - plan.highSideTotal);
    expect(plan.tasks[0].dueDate).toBe("2027-06-12");
    expect(plan.vendorCategories).toEqual(["Restaurants"]);
  });

  it("surfaces empty model responses as a useful error", async () => {
    mocks.generateContent.mockResolvedValue({ response: { text: () => "" } });
    const { generateEventPlan } = await import("./ai");
    await expect(generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "" })).rejects.toThrow("returned an empty response");
  });

  it("retries a temporary 503 and falls back to the lightweight Gemini model", async () => {
    mocks.generateContent
      .mockRejectedValueOnce(Object.assign(new Error("Service unavailable"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("Service unavailable"), { status: 503 }))
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify({
        summary: "A relaxed birthday lunch.", highSideTotal: 100000, contingency: 15000,
        budgetLines: [{ category: "Food", highEstimate: 70000, rationale: "Sample estimate." }, { category: "Cake", highEstimate: 30000, rationale: "Sample estimate." }],
        tasks: [{ title: "Confirm venue", dueDate: "2030-01-01", category: "Venue" }], vendorCategories: ["Restaurants"], ideas: ["Add a playlist."],
      }) } });
    const { generateEventPlan } = await import("./ai");

    const plan = await generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "" });

    expect(plan.summary).toBe("A relaxed birthday lunch.");
    expect(mocks.getGenerativeModel.mock.calls.map((call) => call[1].model)).toEqual([
      "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite",
    ]);
  });

  it("skips a stalled primary model and tries Flash-Lite without waiting for the global timeout", async () => {
    mocks.generateContent
      .mockRejectedValueOnce(new Error("Gemini model request timed out"))
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify({
        summary: "A relaxed birthday lunch.", highSideTotal: 100000, contingency: 15000,
        budgetLines: [{ category: "Food", highEstimate: 70000, rationale: "Sample estimate." }, { category: "Cake", highEstimate: 30000, rationale: "Sample estimate." }],
        tasks: [{ title: "Confirm venue", dueDate: "2030-01-01", category: "Venue" }], vendorCategories: ["Restaurants"], ideas: ["Add a playlist."],
      }) } });
    const { generateEventPlan } = await import("./ai");

    const plan = await generateEventPlan({ kind: "Birthday", date: "2027-06-12", city: "Bengaluru", guests: 20, budget: 60000, style: "" });

    expect(plan.summary).toBe("A relaxed birthday lunch.");
    expect(mocks.getGenerativeModel.mock.calls.map((call) => call[1].model)).toEqual([
      "gemini-3.8-flash", "gemini-3.5-flash-lite",
    ]);
  });
});
