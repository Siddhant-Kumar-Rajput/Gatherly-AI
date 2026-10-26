export interface GroundedPlace {
  id: string;
  name: string;
  mapsUrl: string;
  description?: string;
  rating?: number;
  photoUrl?: string;
  source: "google" | "openstreetmap";
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    osm_type?: string;
    osm_id?: number;
    street?: string;
    housenumber?: string;
    postcode?: string;
    district?: string;
    locality?: string;
    city?: string;
    state?: string;
    osm_key?: string;
    osm_value?: string;
  };
};

const PHOTON_API = "https://photon.komoot.io/api/";
const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const resultCache = new Map<string, { savedAt: number; places: GroundedPlace[] }>();

function mapUrl(name: string, address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(", "))}`;
}

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type MapsGroundingResponse = {
  candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ maps?: { title?: string; uri?: string; text?: string; placeId?: string } }> } }>;
  error?: { message?: string };
};

const GEMINI_API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY,
  import.meta.env.VITE_GEMINI_API_KEY_2,
  import.meta.env.VITE_GEMINI_API_KEY_3,
].filter((key): key is string => typeof key === "string" && key.trim().length > 0);

async function searchGoogleMapsGroundedPlaces(
  category: string,
  location: string,
  latitude: number,
  longitude: number,
  excludeNames: string[],
): Promise<GroundedPlace[]> {
  const excluded = excludeNames.length ? ` Do not repeat these places: ${excludeNames.slice(0, 30).join(", ")}.` : "";
  const prompt = `Find up to five real ${category} businesses in ${location}, India, near the provided coordinates. Only return places Google Maps can ground. Keep results within ${location}; do not include nearby cities. We need actual businesses, not general advice.${excluded}`;
  let lastError: unknown;
  for (const apiKey of GEMINI_API_KEYS) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ googleMaps: {} }],
          toolConfig: { retrievalConfig: { latLng: { latitude, longitude } } },
          generationConfig: { maxOutputTokens: 600, thinkingConfig: { thinkingLevel: "MINIMAL" } },
        }),
        signal: AbortSignal.timeout(16_000),
      });
      const payload = await response.json() as MapsGroundingResponse;
      if (!response.ok) {
        const error = new Error(payload.error?.message || `Maps grounding returned HTTP ${response.status}.`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      const chunks = payload.candidates?.flatMap((candidate) => candidate.groundingMetadata?.groundingChunks || []) || [];
      const seen = new Set(excludeNames.map((name) => name.trim().toLocaleLowerCase()));
      return chunks.flatMap(({ maps }) => {
        const name = maps?.title?.trim();
        if (!name || seen.has(name.toLocaleLowerCase())) return [];
        seen.add(name.toLocaleLowerCase());
        return [{
          id: maps?.placeId || `google:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name,
          mapsUrl: maps?.uri || mapUrl(name, location),
          description: maps?.text || undefined,
          source: "google" as const,
        }];
      }).slice(0, 5);
    } catch (error) {
      lastError = error;
      const status = (error as Error & { status?: number })?.status;
      if (status === 401 || status === 403) continue;
      break;
    }
  }
  // OpenStreetMap is a useful no-key source when Maps grounding is unavailable.
  if (lastError) console.warn("Google Maps grounding was unavailable; using OpenStreetMap results when present.");
  return [];
}

function overpassTags(category: string): Array<[string, string]> {
  const normalized = category.toLocaleLowerCase();
  if (/cake|baker/.test(normalized)) return [["shop", "bakery"], ["shop", "confectionery"], ["craft", "baker"]];
  if (/cafe|coffee/.test(normalized)) return [["amenity", "cafe"], ["shop", "coffee"]];
  if (/restaurant|cater|buffet|food/.test(normalized)) return [["amenity", "restaurant"], ["amenity", "fast_food"], ["amenity", "food_court"], ["shop", "food"]];
  if (/banquet|venue|hall|party/.test(normalized)) return [["amenity", "events_venue"], ["building", "event_venue"], ["leisure", "events_venue"]];
  if (/photograph/.test(normalized)) return [["shop", "photography"], ["craft", "photographer"]];
  if (/makeup|beauty/.test(normalized)) return [["shop", "beauty"], ["shop", "hairdresser"]];
  if (/florist|flower/.test(normalized)) return [["shop", "florist"]];
  if (/decorat/.test(normalized)) return [["shop", "interior_decoration"], ["craft", "signmaker"]];
  if (/sound|audio|av/.test(normalized)) return [["shop", "electronics"], ["craft", "electronics_repair"]];
  return [];
}

function matchesOverpassType(category: string, tags: Record<string, string>): boolean {
  return overpassTags(category).some(([key, value]) => tags[key] === value);
}

function overpassQuery(category: string, latitude: number, longitude: number, radius: number): string {
  const selectors = overpassTags(category).map(([key, value]) => `nwr(around:${radius},${latitude},${longitude})["${key}"="${value}"];`).join("");
  return `[out:json][timeout:20];(${selectors});out center tags 100;`;
}

function distanceKm(a: [number, number], b: [number, number]): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const [lon1, lat1] = a.map(radians);
  const [lon2, lat2] = b.map(radians);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function normalizeLocality(value: string): string {
  return value.toLocaleLowerCase().split(",")[0].replace(/\b(district|city)\b/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function sameLocality(actual: string, expected: string): boolean {
  const actualName = normalizeLocality(actual);
  const expectedName = normalizeLocality(expected);
  return actualName === expectedName || actualName.startsWith(`${expectedName} `);
}

function getUniquePlaces(places: GroundedPlace[], excludeNames: string[]): GroundedPlace[] {
  const excluded = new Set(excludeNames.map((name) => name.trim().toLocaleLowerCase()));
  const seen = new Set<string>();
  return places.filter((place) => {
    const key = place.name.trim().toLocaleLowerCase();
    if (!key || excluded.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

async function searchLocalPlaces(category: string, location: string, coordinates?: { latitude: number; longitude: number }): Promise<{ places: GroundedPlace[]; center: { latitude: number; longitude: number }; resolvedLocation: string }> {
  let latitude = coordinates?.latitude;
  let longitude = coordinates?.longitude;
  let targetCity: string | undefined;

  if (latitude === undefined || longitude === undefined) {
    const geocodeUrl = new URL(PHOTON_API);
    geocodeUrl.search = new URLSearchParams({ q: location, limit: "5", lang: "en" }).toString();
    const geocodeResponse = await fetch(geocodeUrl, { signal: AbortSignal.timeout(10_000) });
    if (!geocodeResponse.ok) throw new Error("Could not look up that city. Check the spelling or add the state or country.");
    const geocode = await geocodeResponse.json() as { features?: PhotonFeature[] };
    const features = geocode.features || [];
    const exactPlace = features.find((feature) => feature.geometry?.coordinates?.length === 2 && sameLocality(feature.properties?.name || "", location));
    const place = exactPlace || features.find((feature) => feature.geometry?.coordinates?.length === 2 && /city|town|village|municipality|suburb|neighbourhood|postcode/.test(feature.properties?.osm_value || ""));
    if (!place?.geometry?.coordinates) throw new Error("Could not find that city or neighbourhood. Add the state or country and try again.");
    [longitude, latitude] = place.geometry.coordinates;
    const placeType = place.properties?.osm_value || "";
    targetCity = place.properties?.city || (/city|town|village|municipality/.test(placeType) ? place.properties?.name : undefined);
  }

  const query = overpassQuery(category, latitude!, longitude!, coordinates ? 8_000 : 12_000);
  if (!overpassTags(category).length) throw new Error("That vendor category is not available in local search yet.");
  const response = await fetch(OVERPASS_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error("Local place search is busy right now. Please try again in a moment.");
  const payload = await response.json() as { elements?: OverpassElement[] };
  const center: [number, number] = [longitude!, latitude!];
  const maxDistanceKm = coordinates ? 8 : targetCity ? 12 : 8;
  const places = (payload.elements || []).flatMap((element) => {
    const tags = element.tags || {};
    const name = tags.name || tags.brand || tags.operator;
    const listedCity = tags["addr:city"];
    const point = element.lat !== undefined && element.lon !== undefined
      ? [element.lon, element.lat] as [number, number]
      : element.center ? [element.center.lon, element.center.lat] as [number, number] : undefined;
    if (!name || !point || !element.id || !matchesOverpassType(category, tags)) return [];
    if (distanceKm(center, point) > maxDistanceKm) return [];
    if (targetCity && listedCity && !sameLocality(listedCity, targetCity)) return [];
    const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"] || tags["addr:neighbourhood"], tags["addr:city"] || targetCity || location, tags["addr:postcode"]].filter(Boolean).join(", ");
    const categoryTag = Object.entries(tags).find(([key]) => ["shop", "amenity", "craft", "leisure", "building"].includes(key));
    const detail = [categoryTag?.[1]?.replaceAll("_", " "), address].filter(Boolean).join(" · ");
    return [{
      id: `osm:${element.type}:${element.id}`,
      name,
      mapsUrl: mapUrl(name, address || location),
      description: detail || undefined,
      source: "openstreetmap" as const,
    }];
  });
  return { places, center: { latitude: latitude!, longitude: longitude! }, resolvedLocation: targetCity || location };
}

export async function searchGroundedPlaces({
  category,
  location,
  coordinates,
  excludeNames = [],
}: {
  category: string;
  location: string;
  coordinates?: { latitude: number; longitude: number };
  excludeNames?: string[];
}): Promise<GroundedPlace[]> {
  if (!category.trim()) throw new Error("Enter the type of place you want to find.");
  if (!location.trim() && !coordinates) throw new Error("Enter a city or choose your location to find local places.");

  const cacheKey = `${category.trim().toLocaleLowerCase()}|${location.trim().toLocaleLowerCase()}|${coordinates ? `${coordinates.latitude.toFixed(3)},${coordinates.longitude.toFixed(3)}` : ""}`;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 10 * 60_000) return getUniquePlaces(cached.places, excludeNames);

  const { places, center, resolvedLocation } = await searchLocalPlaces(category.trim(), location.trim(), coordinates);
  const page = getUniquePlaces(places, excludeNames);
  if (places.length) {
    resultCache.set(cacheKey, { savedAt: Date.now(), places });
    if (resultCache.size > 30) resultCache.delete(resultCache.keys().next().value!);
    return page;
  }

  // OSM business coverage varies by city. When it has no listings, ask Gemini
  // to ground the query in Google Maps at the geocoded city center.
  return searchGoogleMapsGroundedPlaces(category.trim(), resolvedLocation, center.latitude, center.longitude, excludeNames);
}
