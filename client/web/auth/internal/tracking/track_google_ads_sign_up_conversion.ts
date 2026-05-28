import {
    googleAdsConversionId,
    googleAdsSignUpConversionLabel,
} from "~/client/web/auth/internal/tracking/google_ads_conversion_tracking_constants.js";
import {readActiveGoogleAdsClickId} from "~/client/web/auth/internal/tracking/read_active_google_ads_click_id.js";

/**
 * Fires the Google Ads conversion event for a successful account sign-up. Call
 * immediately after `/api/auth/sign-up` returns ok and before navigating into the
 * app.
 *
 * No-op when:
 *
 * - We're not in production (avoids polluting campaign data with dev sign-ups).
 * - No `googleAdsSignUpConversionLabel` is configured yet (Google Ads can't
 *   attribute a conversion without a label).
 * - No active `gclid` was captured for this user — i.e. they didn't come from a
 *   Google Ad click within the attribution window. This is the explicit
 *   ad-attribution gate: organic/direct/other-channel sign-ups never fire the
 *   conversion event.
 * - gtag.js failed to load or didn't initialize (e.g. blocked by an ad blocker).
 *   In that case the event is silently dropped instead of throwing, because
 *   failing the sign-up flow over a tracking pixel would be much worse than
 *   missing one conversion event.
 */
export function trackGoogleAdsSignUpConversion(): void {
    if (process.env.NODE_ENV !== "production") return;
    if (googleAdsSignUpConversionLabel === null) return;
    if (typeof window === "undefined") return;

    // Gate on a captured Google Ads click ID. Without one, this sign-up isn't
    // ad-attributed and shouldn't count as a conversion. gtag.js's own attribution
    // would silently drop it from the dashboard anyway, but explicitly skipping the
    // event avoids the network request, keeps our first-party-data surface area
    // minimal, and avoids feeding Google's conversion modeling with unattributed
    // signal.
    if (readActiveGoogleAdsClickId() === null) return;

    // `gtag` is installed onto `window` by the inline snippet in
    // `<GoogleAdsConversionTrackingScript>`. We narrow it locally rather than
    // augmenting the global `Window` type so the rest of the codebase can't
    // accidentally call `window.gtag()` from places where the snippet isn't rendered
    // (e.g. signed-in workspace routes).
    const {gtag} = window as {
        readonly gtag?: (...args: ReadonlyArray<unknown>) => void;
    };
    if (typeof gtag !== "function") return;

    void Promise.resolve()
        .then(() => {
            gtag("event", "conversion", {
                send_to: `${googleAdsConversionId}/${googleAdsSignUpConversionLabel}`,
            });
        })
        .catch(() => {
            // Silently ignore errors since we never want conversion tracking to affect app
            // functionality.
        });
}
