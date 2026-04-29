import { describe, expect, it } from "vitest";
import { formatDateTimeWith, formatDateWith } from "./useDateFormat";

// Fixed reference date: 2026-04-29 14:05 (local time)
const ref = new Date(2026, 3, 29, 14, 5);

describe("formatDateWith", () => {
  it("formats MM/DD/YYYY (US)", () => {
    expect(formatDateWith("MM/DD/YYYY", ref)).toBe("04/29/2026");
  });

  it("formats DD/MM/YYYY (EU)", () => {
    expect(formatDateWith("DD/MM/YYYY", ref)).toBe("29/04/2026");
  });

  it("formats YYYY-MM-DD (ISO)", () => {
    expect(formatDateWith("YYYY-MM-DD", ref)).toBe("2026-04-29");
  });

  it("formats DD MMM YYYY", () => {
    const out = formatDateWith("DD MMM YYYY", ref);
    expect(out).toMatch(/^29 \w+ 2026$/);
  });

  it("formats MMM DD, YYYY", () => {
    const out = formatDateWith("MMM DD, YYYY", ref);
    expect(out).toMatch(/^\w+ 29, 2026$/);
  });

  it("returns empty string for null / undefined / empty / invalid", () => {
    expect(formatDateWith("MM/DD/YYYY", null)).toBe("");
    expect(formatDateWith("MM/DD/YYYY", undefined)).toBe("");
    expect(formatDateWith("MM/DD/YYYY", "")).toBe("");
    expect(formatDateWith("MM/DD/YYYY", "not-a-date")).toBe("");
  });

  it("accepts ISO strings", () => {
    expect(formatDateWith("YYYY-MM-DD", "2026-04-29T10:00:00Z")).toMatch(
      /^2026-04-2[89]$/, // tolerate TZ offset
    );
  });
});

describe("formatDateTimeWith", () => {
  it("appends HH:mm", () => {
    expect(formatDateTimeWith("YYYY-MM-DD", ref)).toBe("2026-04-29 14:05");
  });

  it("zero-pads single-digit hours and minutes", () => {
    const morning = new Date(2026, 0, 1, 9, 7);
    expect(formatDateTimeWith("DD/MM/YYYY", morning)).toBe("01/01/2026 09:07");
  });

  it("returns empty string for falsy input", () => {
    expect(formatDateTimeWith("MMM DD, YYYY", null)).toBe("");
    expect(formatDateTimeWith("MMM DD, YYYY", undefined)).toBe("");
  });
});
