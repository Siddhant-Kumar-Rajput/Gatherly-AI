import { describe, expect, it } from "vitest";
import { stripUndefined } from "./firestoreData";

describe("stripUndefined", () => {
  it("removes undefined object fields recursively and preserves special Firestore values", () => {
    class TimestampLike { seconds = 123; }
    const timestamp = new TimestampLike();
    const input = { customKind: undefined, vendor: { email: undefined, name: "Cafe" }, timestamps: [timestamp, undefined] };

    expect(stripUndefined(input)).toEqual({ vendor: { name: "Cafe" }, timestamps: [timestamp, null] });
    expect(stripUndefined(input).timestamps[0]).toBe(timestamp);
  });
});
