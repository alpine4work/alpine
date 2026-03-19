/**
 * Is the user agent from a mobile device?
 *
 * This checks for "Mobile" in the user agent string, which is present on mobile
 * browsers like Safari on iOS, Chrome on Android, etc.
 */
export const isMobileUserAgent: boolean =
    typeof navigator !== "undefined" ? /Mobile/.test(navigator.userAgent) : false;
