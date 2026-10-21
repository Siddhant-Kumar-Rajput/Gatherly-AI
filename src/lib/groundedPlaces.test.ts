import { beforeEach, describe, expect, it, vi } from "vitest";

const cityFeature = {
  type: "Feature",
  properties: { name: "Test City", osm_type: "R", osm_id: 1, osm_key: "place", osm_value: "city" },
  geometry: { type: "Point", coordinates: [77.6, 12.9] },
};

function cafeFeatures() {
  return Array.from({ length: 7 }, (_, index) => ({
    type: "Feature",
    properties: { name: `Cafe ${index + 1}`, osm_type: "N", osm_id: index + 10, osm_key: "amenity", osm_value: "cafe", street: "Market Road", city: "Test City" },
    geometry: { type: "Point", coordinates: [77.6 + index / 100, 12.9] },
  }));
}

describe("searchGroundedPlaces", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_GEMINI_API_KEY", "");
    vi.stubEnv("VITE_GEMINI_API_KEY_2", "");
    vi.stubEnv("VITE_GEMINI_API_KEY_3", "");
  });

  it("finds real local places without a key, returns five at a time, and builds Google Maps links", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [cityFeature] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: cafeFeatures() }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { searchGroundedPlaces } = await import("./groundedPlaces");

    const firstPage = await searchGroundedPlaces({ category: "cafes", location: "Test City" });
    const secondPage = await searchGroundedPlaces({ category: "cafes", location: "Test City", excludeNames: firstPage.map((place) => place.name) });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstPage).toHaveLength(5);
    expect(firstPage[0]).toMatchObject({ id: "osm:N:10", name: "Cafe 1", source: "openstreetmap" });
    expect(firstPage[0].description).toContain("Market Road");
    expect(firstPage[0].mapsUrl).toContain("google.com/maps/search");
    expect(secondPage.map((place) => place.name)).toEqual(["Cafe 6", "Cafe 7"]);
    const placeRequestUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(placeRequestUrl.searchParams.get("q")).toBe("cafe");
    expect(placeRequestUrl.searchParams.get("lat")).toBe("12.9");
    expect(placeRequestUrl.searchParams.get("lon")).toBe("77.6");
  });

  it("falls back to OpenStreetMap when Google Maps grounding is denied", async () => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "test-only-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Grounding unavailable on free tier" } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [cityFeature] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: cafeFeatures() }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { searchGroundedPlaces } = await import("./groundedPlaces");

    const places = await searchGroundedPlaces({ category: "cafes", location: "Test City" });

    expect(places).toHaveLength(5);
    expect(places[0].source).toBe("openstreetmap");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a useful message if the city cannot be found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [] }), { status: 200 })));
    const { searchGroundedPlaces } = await import("./groundedPlaces");
    await expect(searchGroundedPlaces({ category: "cafes", location: "Unknown test place" })).rejects.toThrow("Check the spelling or include the state or country");
  });
});
