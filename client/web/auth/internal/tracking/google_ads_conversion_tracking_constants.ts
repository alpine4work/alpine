/**
 * Google Ads conversion ID for Alpine's Google Ads account. Used to load gtag.js
 * and record sign-up conversions.
 *
 * This ID is intentionally shipped in the client bundle: gtag.js exposes it to the
 * browser as soon as the snippet runs, so there is nothing secret to protect by
 * keeping it server-side.
 */
export const googleAdsConversionId = "AW-18191403973";

/**
 * Google Ads "conversion label" for the sign-up conversion action. Combined with
 * `googleAdsConversionId`, this is the value passed to `send_to` when
 * `trackGoogleAdsSignUpConversion()` fires the conversion event.
 */
export const googleAdsSignUpConversionLabel: string | null = "Of3yCJW2gLQcEMWXq-JD";
