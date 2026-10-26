import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Gatherly guest planning flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "");
    const data = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, String(value)); },
      removeItem: (key: string) => { data.delete(key); },
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size; },
    } });
    window.history.replaceState({}, "", "/");
    window.scrollTo = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    vi.unstubAllEnvs();
  });

  it("creates a real event in guest mode and keeps it after remount", async () => {
    const { default: App } = await import("./App");
    root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    const guestEntry = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Explore without an account"));
    expect(guestEntry).toBeTruthy();
    await act(async () => guestEntry!.click());

    const createButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Plan an event"));
    expect(createButton).toBeTruthy();
    await act(async () => createButton!.click());

    const form = container.querySelector("form.form-stack") as HTMLFormElement;
    expect(form).toBeTruthy();
    const values: Record<string, string> = {
      title: "Mira’s birthday", date: "2026-11-26", guests: "24", city: "Haldwani", budget: "45000",
    };
    for (const [name, value] of Object.entries(values)) {
      (form.elements.namedItem(name) as HTMLInputElement).value = value;
    }
    await act(async () => form.requestSubmit());

    const saved = JSON.parse(window.localStorage.getItem("gatherly.events.v1") || "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: "Mira’s birthday", city: "Haldwani", guests: 24, budget: 45000, kind: "Birthday" });
    expect(container.textContent).toContain("Browser workspace");
    expect(container.textContent).toContain("Mira’s birthday");

    await act(async () => root.unmount());
    window.history.replaceState({}, "", "/");
    const { default: ReloadedApp } = await import("./App");
    root = createRoot(container);
    await act(async () => root.render(createElement(ReloadedApp)));
    const reopen = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Explore without an account"));
    await act(async () => reopen!.click());
    expect(container.textContent).toContain("Mira’s birthday");
  });
});
