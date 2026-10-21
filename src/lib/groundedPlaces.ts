export interface GroundedPlace {
  id: string;
  name: string;
  mapsUrl: string;
  description?: string;
  rating?: number;
  photoUrl?: string;
}

type Interaction = {
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; name?: string; url?: string }> }> }>;
};

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
const MODEL = "gemini-3.8-flash";

export const groundedPlacesConfigured = Boolean(API_KEY);

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
  if (!API_KEY) throw new Error("Gemini place search is not configured yet.");

  const exclusions = excludeNames.length
    ? `Do not repeat these places: ${excludeNames.slice(-30).join("; ")}. Find different options if available.`
    : "";
  const prompt = `Find up to five real ${category} places in or near ${location}. Return a concise, useful list of distinct places suitable for someone planning an event. Include only places you can ground in Google Maps. ${exclusions} If fewer than five suitable places are available, return fewer. Do not invent ratings, photos, phone numbers, or addresses.`;

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({ model: MODEL, input: prompt, tools: [{ type: "google_maps", ...coordinates }] }),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Gemini search is at its current rate limit. Please try again later.");
    if (response.status === 403) throw new Error("Gemini Maps grounding is unavailable for this key or model. Check AI Studio access and quotas.");
    throw new Error(`Gemini place search failed (${response.status}). Please try again.`);
  }

  const payload = await response.json() as Interaction;
  const blocks = (payload.steps || []).filter((step) => step.type === "model_output").flatMap((step) => step.content || []);
  const text = blocks.filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
  const annotations = blocks.flatMap((block) => block.annotations || []).filter((item) => {
    if (item.type !== "place_citation" || !item.name || !item.url) return false;
    try {
      const url = new URL(item.url);
      return url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com") || url.hostname === "maps.app.goo.gl");
    } catch { return false; }
  });
  const seen = new Set<string>();
  const places = annotations.flatMap((item) => {
    const key = `${item.name!.trim().toLocaleLowerCase()}|${item.url}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const escaped = item.name!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const context = text.match(new RegExp(`${escaped}[^\\n.]{0,180}`, "i"))?.[0];
    return [{ id: item.url!, name: item.name!, mapsUrl: item.url!, description: context && context !== item.name ? context.trim() : undefined }];
  });
  return places.slice(0, 5);
}
