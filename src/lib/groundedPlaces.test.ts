import { beforeEach, describe, expect, it, vi } from "vitest";

const cityFeature = {
  type: "Feature",
  properties: { name: "Test City", osm_type: "R", osm_id: 1, osm_key: "place", osm_value: "city" },
  geometry: { type: "Point", coordinates: [77.6, 12.9] },
};

function cafeElements(): Array<Record<string, unknown>> {
  return [
    ...Array.from({ length: 7 }, (_, index) => ({
      type: "node", id: index + 10, lat: 12.9, lon: 77.6 + index / 100,
      tags: { name: `Cafe ${index + 1}`, amenity: "cafe", "addr:street": "Market Road", "addr:city": "Test City" },
    })),
    { type: "node", id: 40, lat: 12.9, lon: 77.61, tags: { name: "Nearby restaurant", amenity: "restaurant", "addr:city": "Test City" } },
    { type: "node", id: 42, lat: 12.9, lon: 77.61, tags: { name: "Adjacent city cafe", amenity: "cafe", "addr:city": "Adjacent Town" } },
    { type: "node", id: 41, lat: 23, lon: 90, tags: { name: "Far away cafe", amenity: "cafe" } },
  ];
}

function mockCityAndPlaces(elements: Array<Record<string, unknown>> = cafeElements()) {
  return vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ features: [cityFeature] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ elements }), { status: 200 }));
}

describe("searchGroundedPlaces", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_GEMINI_API_KEY", "");
    vi.stubEnv("VITE_GEMINI_API_KEY_2", "");
    vi.stubEnv("VITE_GEMINI_API_KEY_3", "");
  });

  it("returns five real nearby cafes per page and filters other cities", async () => {
    const fetchMock = mockCityAndPlaces();
    vi.stubGlobal("fetch", fetchMock);
    const { searchGroundedPlaces } = await import("./groundedPlaces");

    const firstPage = await searchGroundedPlaces({ category: "cafes", location: "Test City" });
    const secondPage = await searchGroundedPlaces({ category: "cafes", location: "Test City", excludeNames: firstPage.map((place) => place.name) });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstPage).toHaveLength(5);
    expect(firstPage[0]).toMatchObject({ id: "osm:node:10", name: "Cafe 1", source: "openstreetmap" });
    expect(firstPage[0].description).toContain("Market Road");
    expect(firstPage[0].mapsUrl).toContain("google.com/maps/search");
    expect(secondPage.map((place) => place.name)).toEqual(["Cafe 6", "Cafe 7"]);
    const [url, options] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("overpass-api.de/api/interpreter");
    expect(options.method).toBe("POST");
    const query = new URLSearchParams(options.body).get("data");
    expect(query).toContain("[\"amenity\"=\"cafe\"]");
    expect(query).toContain("77.6");
    expect(query).toContain("12.9");
  });

  it("searches bakeries and confectionery shops for cake vendors", async () => {
    const fetchMock = mockCityAndPlaces([
      { type: "node", id: 5, lat: 12.9, lon: 77.6, tags: { name: "Sweet Shop", shop: "confectionery" } },
      { type: "node", id: 6, lat: 12.91, lon: 77.61, tags: { name: "Local Bakery", shop: "bakery" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { searchGroundedPlaces } = await import("./groundedPlaces");
    const places = await searchGroundedPlaces({ category: "Cake shops", location: "Test City" });

    expect(places.map((place) => place.name)).toEqual(["Sweet Shop", "Local Bakery"]);
    const query = new URLSearchParams(fetchMock.mock.calls[1][1].body).get("data");
    expect(query).toContain("[\"shop\"=\"bakery\"]");
    expect(query).toContain("[\"shop\"=\"confectionery\"]");
  });

  it("falls back to real Google Maps-grounded businesses when local map data is empty", async () => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "test-only-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [cityFeature] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ groundingMetadata: { groundingChunks: [
        { maps: { title: "Haldwani Cake House", uri: "https://maps.google.com/?cid=123", placeId: "places/123", text: "Bakery in Haldwani" } },
        { maps: { title: "Haldwani Cake House", uri: "https://maps.google.com/?cid=123" } },
      ] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { searchGroundedPlaces } = await import("./groundedPlaces");
    const places = await searchGroundedPlaces({ category: "Cake shops", location: "Test City" });

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "Haldwani Cake House", source: "google", mapsUrl: "https://maps.google.com/?cid=123" });
    const [url, options] = fetchMock.mock.calls[2];
    expect(String(url)).toContain("gemini-3.5-flash-lite:generateContent");
    expect(options.headers["x-goog-api-key"]).toBe("test-only-key");
    const body = JSON.parse(options.body);
    expect(body.tools).toEqual([{ googleMaps: {} }]);
    expect(body.toolConfig.retrievalConfig.latLng).toEqual({ latitude: 12.9, longitude: 77.6 });
  });

  it("uses local OpenStreetMap results even when a Gemini key is configured", async () => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "test-only-key");
    const fetchMock = mockCityAndPlaces();
    vi.stubGlobal("fetch", fetchMock);
    const { searchGroundedPlaces } = await import("./groundedPlaces");
    const places = await searchGroundedPlaces({ category: "cafes", location: "Test City" });

    expect(places).toHaveLength(5);
    expect(places[0].source).toBe("openstreetmap");
    expect(places.every((place) => !["Nearby restaurant", "Far away cafe", "Adjacent city cafe"].includes(place.name))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a useful message if the city cannot be found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [] }), { status: 200 })));
    const { searchGroundedPlaces } = await import("./groundedPlaces");
    await expect(searchGroundedPlaces({ category: "cafes", location: "Unknown test place" })).rejects.toThrow("Add the state or country");
  });
});
