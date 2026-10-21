export interface GroundedPlace {
  id: string;
  name: string;
  mapsUrl: string;
  description?: string;
  rating?: number;
  photoUrl?: string;
  source: "google" | "openstreetmap";
}

type Interaction = {
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; name?: string; url?: string }> }> }>;
};

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

const API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY,
  import.meta.env.VITE_GEMINI_API_KEY_2,
  import.meta.env.VITE_GEMINI_API_KEY_3,
].filter((key): key is string => typeof key === "string" && key.trim().length > 0);
const MODEL = "gemini-3.8-flash";
const PHOTON_API = "https://photon.komoot.io/api/";
const resultCache = new Map<string, { savedAt: number; places: GroundedPlace[] }>();

function photonCategory(category: string): string {
  const normalized = category.toLocaleLowerCase();
  if (/cafe|coffee/.test(normalized)) return "cafe";
  if (/cake|baker/.test(normalized)) return "bakery";
  if (/restaurant|cater|buffet|food/.test(normalized)) return "restaurant";
  if (/banquet|venue|hall/.test(normalized)) return "event venue";
  if (/photograph/.test(normalized)) return "photographer";
  if (/makeup|beauty/.test(normalized)) return "beauty salon";
  if (/florist|flower/.test(normalized)) return "florist";
  if (/decorat/.test(normalized)) return "event decoration";
  if (/sound|audio|av/.test(normalized)) return "event sound equipment";
  return category;
}

function mapUrl(name: string, address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(", "))}`;
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

async function searchGoogleMapsGrounded({ category, location, coordinates, excludeNames }: {
  category: string;
  location: string;
  coordinates?: { latitude: number; longitude: number };
  excludeNames: string[];
}): Promise<GroundedPlace[]> {
  if (!API_KEYS.length) return [];
  const exclusions = excludeNames.length ? ` Do not repeat these places: ${excludeNames.slice(-30).join("; ")}.` : "";
  const prompt = `Find up to five real ${category} places in or near ${location}. Return concise distinct places suitable for someone planning an event. Include only places you can ground in Google Maps.${exclusions} Return fewer when needed. Do not invent businesses, ratings, photos, phone numbers, or addresses.`;
  for (const apiKey of API_KEYS) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ model: MODEL, input: prompt, tools: [{ type: "google_maps", ...coordinates }] }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        // Grounding quota is shared across keys in one Google project; avoid three identical 403/429 retries.
        if (response.status === 403 || response.status === 429) break;
        continue;
      }
      const payload = await response.json() as Interaction;
      const blocks = (payload.steps || []).filter((step) => step.type === "model_output").flatMap((step) => step.content || []);
      const annotations = blocks.flatMap((block) => block.annotations || []).filter((item) => {
        if (item.type !== "place_citation" || !item.name || !item.url) return false;
        try {
          const url = new URL(item.url);
          return url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com") || url.hostname === "maps.app.goo.gl");
        } catch { return false; }
      });
      const seen = new Set<string>();
      const places = annotations.flatMap((item) => {
        const key = item.name!.trim().toLocaleLowerCase();
        if (seen.has(key)) return [];
        seen.add(key);
        const escaped = item.name!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const text = blocks.filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
        const context = text.match(new RegExp(`${escaped}[^\\n.]{0,180}`, "i"))?.[0];
        return [{ id: item.url!, name: item.name!, mapsUrl: item.url!, description: context && context !== item.name ? context.trim() : undefined, source: "google" as const }];
      });
      if (places.length) return getUniquePlaces(places, excludeNames);
    } catch {
      // The no-key Photon fallback below keeps discovery usable when Maps grounding is blocked.
    }
  }
  return [];
}

async function searchPhotonPlaces(category: string, location: string, coordinates?: { latitude: number; longitude: number }): Promise<GroundedPlace[]> {
  let latitude = coordinates?.latitude;
  let longitude = coordinates?.longitude;

  if (latitude === undefined || longitude === undefined) {
    const geocodeUrl = new URL(PHOTON_API);
    geocodeUrl.search = new URLSearchParams({ q: location, limit: "1", lang: "en" }).toString();
    const geocodeResponse = await fetch(geocodeUrl, { signal: AbortSignal.timeout(10_000) });
    if (!geocodeResponse.ok) throw new Error("Could not look up that city. Check the spelling or add the state or country.");
    const geocode = await geocodeResponse.json() as { features?: PhotonFeature[] };
    const city = geocode.features?.find((feature) => feature.geometry?.coordinates?.length === 2);
    if (!city?.geometry?.coordinates) throw new Error("Could not find that city. Check the spelling or include the state or country.");
    [longitude, latitude] = city.geometry.coordinates;
  }

  const searchUrl = new URL(PHOTON_API);
  searchUrl.search = new URLSearchParams({
    q: photonCategory(category),
    lat: String(latitude),
    lon: String(longitude),
    zoom: coordinates ? "14" : "12",
    limit: "30",
    lang: "en",
  }).toString();
  const response = await fetch(searchUrl, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("Local place search is temporarily unavailable. Please try again in a moment.");
  const payload = await response.json() as { features?: PhotonFeature[] };
  return (payload.features || []).flatMap((feature) => {
    const properties = feature.properties;
    if (!properties?.name || !properties.osm_id || !properties.osm_type) return [];
    const address = [properties.housenumber, properties.street, properties.district || properties.locality, properties.city, properties.state, properties.postcode].filter(Boolean).join(", ");
    const detail = [properties.osm_value?.replaceAll("_", " "), address].filter(Boolean).join(" · ");
    return [{
      id: `osm:${properties.osm_type}:${properties.osm_id}`,
      name: properties.name,
      mapsUrl: mapUrl(properties.name, address || location),
      description: detail || undefined,
      source: "openstreetmap" as const,
    }];
  });
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

  const googlePlaces = await searchGoogleMapsGrounded({ category: category.trim(), location: location.trim(), coordinates, excludeNames });
  const places = googlePlaces.length ? googlePlaces : await searchPhotonPlaces(category.trim(), location.trim(), coordinates);
  if (!googlePlaces.length) {
    resultCache.set(cacheKey, { savedAt: Date.now(), places });
    if (resultCache.size > 30) resultCache.delete(resultCache.keys().next().value!);
  }
  return getUniquePlaces(places, excludeNames);
}
