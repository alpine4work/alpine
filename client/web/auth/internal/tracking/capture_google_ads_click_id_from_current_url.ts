import {googleAdsClickIdStorageKey} from "~/client/web/auth/internal/tracking/google_ads_click_id_constants.js";

/**
 * Reads the `gclid` query parameter from the current page URL and persists it to
 * `localStorage` with a capture timestamp. Call once when the user lands on an
 * auth route, before they navigate further into the sign-up flow.
 *
 * No-op when:
 *
 * - `window` isn't available (server render).
 * - The URL has no `gclid` (organic traffic or a non-ad referrer). Existing stored
 *   values are intentionally preserved in this case so a user who lands via an ad,
 *   leaves, and returns directly within the attribution window still counts as
 *   ad-attributed.
 */
export function captureGoogleAdsClickIdFromCurrentUrl(): void {
    if (typeof window === "undefined") return;

    try {
        const gclid = new URL(window.location.href).searchParams.get("gclid");
        if (gclid === null || gclid === "") return;

        window.localStorage.setItem(
            googleAdsClickIdStorageKey,
            JSON.stringify({gclid, capturedAt: Date.now()}),
        );
    } catch {
        // Silently ignore errors since we never want conversion tracking to affect app
        // functionality.
    }
}
