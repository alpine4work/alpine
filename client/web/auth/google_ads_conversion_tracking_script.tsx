import {useEffect, useRef} from "react";
import {captureGoogleAdsClickIdFromCurrentUrl} from "~/client/web/auth/internal/tracking/capture_google_ads_click_id_from_current_url.js";
import {googleAdsConversionId} from "~/client/web/auth/internal/tracking/google_ads_conversion_tracking_constants.js";

/**
 * Loads Google's gtag.js library and initializes it with our Google Ads conversion
 * ID. Render once on any route where we want Google Ads to record pageviews or be
 * able to record conversions (currently `/auth/*`).
 *
 * Also captures the `gclid` query parameter (forwarded from alpine.inc when the
 * user clicked through from a Google Ad) into `localStorage` on mount, so
 * `trackGoogleAdsSignUpConversion()` can later gate on whether this sign-up is
 * actually ad-attributed.
 *
 * No-op outside of production so we never pollute campaign data with
 * dev/integration-test sign-ups.
 */
export function GoogleAdsConversionTrackingScript() {
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        captureGoogleAdsClickIdFromCurrentUrl();
    }, []);

    return (
        <>
            <script
                async
                src={`https://www.googletagmanager.com/gtag/js?id=${googleAdsConversionId}`}
            />
            <script
                // Standard gtag.js install snippet from Google Ads. Defines the `window.gtag()`
                // shim that queues events into `window.dataLayer` until the async gtag.js bundle
                // above loads and drains them.
                dangerouslySetInnerHTML={{
                    // eslint-disable-next-line cyberworlds/string-quotes
                    __html: `try{window.dataLayer=Array.isArray(window.dataLayer)?window.dataLayer:[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config',${JSON.stringify(googleAdsConversionId)});}catch{}`,
                }}
            />
        </>
    );
}
