// Frontend-local copies of formatting helpers.
// Kept in sync with backend/helpers.js — do not import backend files from
// the frontend, since the production build only has frontend/node_modules
// available and backend-only packages will fail to resolve.
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json" with { type: "json" };

countries.registerLocale(en);

export function fmtCountry(code) {
  if (!code) return "Country not available";
  const name = countries.getName(code.toUpperCase(), "en");
  return name || "Country not available";
}

/**
 * Formats a count for display.
 * Values below 1000 are returned as-is (e.g. "N/A", "42").
 * Values >= 1000 get:
 *   - comma-separated full form  e.g. 1,000  10,000  1,234,567
 *   - short suffix form in brackets  e.g. (1K)  (10K)  (1.2M)  (2.8B)
 *
 * Non-numeric strings such as "N/A" are returned unchanged.
 */
export function fmtCount(value) {
  if (value === null || value === undefined) return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);

  const full = n.toLocaleString("en-US");
  if (n < 1000) return full;

  let short;
  if (n >= 1_000_000_000) {
    short = (n / 1_000_000_000).toFixed(n >= 100_000_000_000 ? 0 : 1).replace(/\.0$/, "") + "B";
  } else if (n >= 1_000_000) {
    short = (n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  } else {
    short = (n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  }

  return `${full} (${short})`;
}
