/**
 * `localStorage` key for the Google Ads click ID (`gclid`) captured from the URL
 * when the user lands on an auth route after clicking through from a Google Ad.
 * Prefixed with `cyberworlds/` to match the codebase convention for `localStorage`
 * keys (which live in a global namespace).
 */
export const googleAdsClickIdStorageKey = "cyberworlds/gclid";

/**
 * How long a stored `gclid` is still considered "active" for attribution. 90 days
 * matches Google Ads' default conversion window and the default lifetime of
 * gtag.js's own `_gcl_aw` cookie, so a sign-up completed within this window after
 * the original ad click still counts as ad-attributed.
 */
export const googleAdsClickIdMaxAgeMs = 90 * 24 * 60 * 60 * 1000;
