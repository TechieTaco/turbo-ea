import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n";

// Provide a minimal sessionStorage for tests (jsdom includes one, but
// this ensures it's always clean between test files).
beforeEach(() => {
  sessionStorage.clear();
});

// Ensure i18n is set to English for all tests so t() returns English text.
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
