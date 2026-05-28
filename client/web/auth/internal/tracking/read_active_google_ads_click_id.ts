import {
    googleAdsClickIdMaxAgeMs,
    googleAdsClickIdStorageKey,
} from "~/client/web/auth/internal/tracking/google_ads_click_id_constants.js";

/**
 * Returns the `gclid` previously captured by
 * `captureGoogleAdsClickIdFromCurrentUrl()`, but only if it's still within the
 * `googleAdsClickIdMaxAgeMs` attribution window.
 *
 * Returns `null` for organic traffic, expired click IDs, malformed storage, or any
 * read error — callers should treat `null` as "this sign-up isn't ad-attributed
 * and shouldn't fire a conversion event".
 */
export function readActiveGoogleAdsClickId(): string | null {
    if (typeof window === "undefined") return null;

    try {
        const raw = window.localStorage.getItem(googleAdsClickIdStorageKey);
        if (raw === null) return null;

        const parsed = JSON.parse(raw) as {readonly gclid?: unknown; readonly capturedAt?: unknown};
        if (typeof parsed.gclid !== "string" || typeof parsed.capturedAt !== "number") {
            return null;
        }

        if (Date.now() - parsed.capturedAt > googleAdsClickIdMaxAgeMs) return null;

        return parsed.gclid;
    } catch {
        return null;
    }
}
