export interface PlaceResult {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  mapsUrl?: string;
  rating?: number;
  reviewCount?: number;
}

declare global {
  interface Window {
    gatherlyMapsReady?: Promise<void>;
  }
}

export const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

function loadMapsScript(apiKey: string): Promise<void> {
  if (window.gatherlyMapsReady) return window.gatherlyMapsReady;
  window.gatherlyMapsReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps could not load. Check that Maps JavaScript API is enabled and the referrer-restricted key is valid."));
    document.head.appendChild(script);
  });
  return window.gatherlyMapsReady;
}

export async function searchLocalPlaces(category: string, city: string, apiKey = mapsApiKey): Promise<PlaceResult[]> {
  if (!apiKey) throw new Error("Add a restricted Google Maps API key to enable live vendor results.");
  await loadMapsScript(apiKey);
  const { Place } = await google.maps.importLibrary("places") as google.maps.PlacesLibrary;
  const { places } = await Place.searchByText({
    textQuery: `${category} in ${city}`,
    fields: ["id", "displayName", "formattedAddress", "nationalPhoneNumber", "googleMapsURI", "rating", "userRatingCount"],
    maxResultCount: 8,
  });
  return (places || []).map((place) => ({
    id: place.id || crypto.randomUUID(),
    name: place.displayName || "Unnamed place",
    address: place.formattedAddress ?? undefined,
    phone: place.nationalPhoneNumber ?? undefined,
    mapsUrl: place.googleMapsURI ?? undefined,
    rating: place.rating ?? undefined,
    reviewCount: place.userRatingCount ?? undefined,
  }));
}

export async function cityForCoordinates(lat: number, lng: number, apiKey = mapsApiKey): Promise<string | undefined> {
  if (!apiKey) throw new Error("Add a restricted Google Maps key to look up a city. You can type a city instead.");
  await loadMapsScript(apiKey);
  const { Geocoder } = await google.maps.importLibrary("geocoding") as google.maps.GeocodingLibrary;
  const { results } = await new Geocoder().geocode({ location: { lat, lng } });
  const components = results[0]?.address_components || [];
  const city = components.find((part) => part.types.includes("locality"))?.long_name
    || components.find((part) => part.types.includes("postal_town"))?.long_name;
  const region = components.find((part) => part.types.includes("administrative_area_level_1"))?.short_name;
  return city ? `${city}${region ? `, ${region}` : ""}` : undefined;
}
