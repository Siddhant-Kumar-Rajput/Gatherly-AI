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

function matchesPlaceType(category: string, properties: NonNullable<PhotonFeature["properties"]>): boolean {
  const key = properties.osm_key?.toLowerCase();
  const value = properties.osm_value?.toLowerCase();
  const normalized = category.toLocaleLowerCase();
  if (/cafe|coffee/.test(normalized)) return (key === "amenity" && value === "cafe") || (key === "shop" && ["coffee", "tea"].includes(value || ""));
  if (/cake|baker/.test(normalized)) return key === "shop" && value === "bakery";
  if (/restaurant|cater|buffet|food/.test(normalized)) return key === "amenity" && ["restaurant", "fast_food", "food_court", "catering"].includes(value || "");
  return true;
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

async function searchPhotonPlaces(category: string, location: string, coordinates?: { latitude: number; longitude: number }): Promise<GroundedPlace[]> {
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

  const searchUrl = new URL(PHOTON_API);
  searchUrl.search = new URLSearchParams({
    q: photonCategory(category),
    lat: String(latitude),
    lon: String(longitude),
    zoom: coordinates ? "14" : "13",
    limit: "50",
    lang: "en",
  }).toString();
  const response = await fetch(searchUrl, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("Local place search is temporarily unavailable. Please try again in a moment.");
  const payload = await response.json() as { features?: PhotonFeature[] };
  const center: [number, number] = [longitude!, latitude!];
  // Photon does fuzzy text matching. Bound results to the searched area and enforce
  // strict OSM categories for the common cafe/restaurant mix-up.
  const maxDistanceKm = coordinates ? 8 : targetCity ? 20 : 8;
  return (payload.features || []).flatMap((feature) => {
    const properties = feature.properties;
    const point = feature.geometry?.coordinates;
    if (!properties?.name || !properties.osm_id || !properties.osm_type || !point) return [];
    if (distanceKm(center, point) > maxDistanceKm || !matchesPlaceType(category, properties)) return [];
    if (targetCity && properties.city && !sameLocality(properties.city, targetCity)) return [];
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

  const places = await searchPhotonPlaces(category.trim(), location.trim(), coordinates);
  resultCache.set(cacheKey, { savedAt: Date.now(), places });
  if (resultCache.size > 30) resultCache.delete(resultCache.keys().next().value!);
  return getUniquePlaces(places, excludeNames);
}
