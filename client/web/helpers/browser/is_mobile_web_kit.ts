/**
 * Is this WebKit running on a mobile device?
 *
 * Should be true for Safari on iOS, Chrome on iOS, and any other code that uses an
 * iOS web view.
 */
// See the following guidance for detecting rendering engines:
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent#rendering_engine
export const isMobileWebKit: boolean =
    typeof navigator !== "undefined"
        ? /AppleWebKit/.test(navigator.userAgent) && /Mobile/.test(navigator.userAgent)
        : false;
