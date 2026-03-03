import {mobilePlatformMaxWindowWidth} from "~/shared/design/core/platform.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Self-reported information about the client available on the server via a cookie.
 * If client info changes the server doesn't know about it until the next HTTP
 * request.
 */
export type ClientInfo = SchemaType<typeof ClientInfoSchema>;

/**
 * Default client info to use in tests or in server-side rendering before we set
 * the client info cookie.
 *
 * Defaults are chosen based on our company's developer machines. Since default
 * client info is often used, unmodified, in unit tests. We should do some user
 * agent sniffing on the server to create a more refined client info.
 */
export const defaultClientInfo = {
    // The default screen width we use when server-side rendering when we don't know
    // what the user's actual screen width is. 1920px is the width of the [largest
    // common screen resolution][1] so that should cover the majority of devices.
    //
    // [1]: https://www.browserstack.com/guide/ideal-screen-sizes-for-responsive-design
    screenWidth: 1920,

    // The default screen height we use when server-side rendering when we don't know
    // what the user's actual screen height is. 1080px is the height of the [largest
    // common screen resolution][1] so that should cover the majority of devices.
    //
    // [1]: https://www.browserstack.com/guide/ideal-screen-sizes-for-responsive-design
    screenHeight: 1080,

    // We use the New York time zone when we haven't gotten the client's actual time
    // zone since that's where our company is based.
    timeZone: defaultTimeZone,

    // We use English as the default locale when we haven't gotten the client's actual
    // locale since we are a US company.
    locale: defaultLocale,

    // Default to assuming we're running on a Apple MacOS desktop device in Chrome. We
    // make this assumption since our company's recommended developer machines are
    // Apple machines.
    renderingEngine: "Blink",
    isAppleDevice: true,
    isNativeMobile: false,
} as const;

assertAssignableTypes<typeof defaultClientInfo, ClientInfo>();

export const ClientInfoSchema = Schema.object({
    /**
     * The width of the client's screen. This should stay constant as while the user
     * may resize their browser window their device size shouldn't change.
     *
     * We use this when server-side rendering a virtualized list to determine how much
     * content to render on the server.
     *
     * (A user could rotate their phone/tablet changing the screen size. If we really
     * need this to be constant maybe we should track the max of screen width/height.)
     */
    screenWidth: Schema.integer,

    /**
     * The height of the client's screen. This should stay constant as while the user
     * may resize their browser window their device size shouldn't change.
     *
     * We use this when server-side rendering a virtualized list to determine how much
     * content to render on the server.
     *
     * (A user could rotate their phone/tablet changing the screen size. If we really
     * need this to be constant maybe we should track the max of screen width/height.)
     */
    screenHeight: Schema.integer,

    /**
     * The spacing scale based on the window width (not screen width) at the time of
     * initial render. This is used for SSR to match the client's actual window size
     * more accurately than using screen dimensions.
     *
     * Unlike other information in `ClientInfo`, the window spacing scale may change
     * over time as the user resizes their window. However, this value stays constant
     * in `ClientInfo` and represents the spacing scale at initial render. It's updated
     * in the cookie after each page load so future SSR can use the most recent window
     * size.
     *
     * When not set, we fall back to computing spacing scale from screenWidth.
     */
    initialWindowSpacingScale: Schema.enum(["small", "medium", "large"]).optional(),

    /**
     * The time zone a user is in. Should be an IANA time zone identifier like
     * `America/New_York`.
     */
    timeZone: TimeZoneSchema,

    /**
     * The locale of the user. Should be an IETF language tag like `en-US`.
     *
     * Right now we only support the `en-US` locale. Expanding our support for other
     * languages requires internationalizing the product. We include the locale here,
     * though, to help us easily track where in the product the locale needs to be
     * dynamic.
     */
    locale: Schema.value(defaultLocale).default(defaultClientInfo.locale),

    /**
     * Is the browser using the Blink, Gecko, or WebKit rendering engine?
     *
     * - Blink is the rendering engine which powers the Chrome browser built by Google
     *   and other related browsers.
     * - Gecko is the rendering engine which powers the Firefox browser built by
     *   Mozilla.
     * - WebKit is the rendering engine which powers the Safari browser built by Apple.
     *
     * We use [user agent sniffing][1] to determine this.
     *
     * [1]:
     *     https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent#rendering_engine
     */
    renderingEngine: Schema.enum(["Blink", "Gecko", "WebKit"]).default(
        defaultClientInfo.renderingEngine,
    ),

    /**
     * Is this an Apple operating system device? Could be MacOS, iOS, or iPadOS.
     * Primarily used for determining whether keyboard shortcuts use the "cmd" key or
     * "ctrl" key.
     *
     * If false the device could be Windows or Linux.
     */
    isAppleDevice: Schema.boolean.default(defaultClientInfo.isAppleDevice),

    /**
     * Is this client our native mobile app? If true we're running in a native iOS or
     * Android shell app that provides a `NativeMobileBridge` global.
     *
     * If this property is true then we'll always use our mobile layout regardless of
     * the screen size. We haven't decided if `isNativeMobile` should apply to an iPad
     * app or not yet. My (@calebmer's) initial reaction is iPad should use our desktop
     * layout and desktop navigation patterns (peek and all).
     */
    isNativeMobile: Schema.boolean.default(false),
});

/**
 * Default client info for mobile browsers. On the server if there is no client
 * info cookie but we sniff the user-agent and it looks like a mobile device then
 * we will use this client info hoping it better matches the actual device.
 */
export const defaultMobileClientInfo: ClientInfo = {
    ...defaultClientInfo,

    /**
     * If we're rendering on an iPhone (the most popular mobile device for us), Apple
     * only allows the use of the WebKit rendering engine.
     */
    renderingEngine: "WebKit",

    /**
     * Use the maximum screen width that triggers our mobile site instead of the
     * desktop site.
     */
    screenWidth: mobilePlatformMaxWindowWidth,

    /**
     * The largest common screen height for mobile according to [BrowserStack][1].
     *
     * [1]: https://www.browserstack.com/guide/ideal-screen-sizes-for-responsive-design
     */
    screenHeight: 926,
};

/**
 * Is this `User-Agent` header for an Apple device?
 *
 * Device detection with user-agent parsing is generally bad and should be avoided.
 * User agents can be spoofed and browser/device vendors may add strings for other
 * browser/device vendors to trick sites into enabling certain features (e.g.
 * "AppleWebKit" is in almost every user agent for historical reasons).
 *
 * However, `User-Agent` testing is the only way to figure out whether the user is
 * coming from an Apple device from the server so we gotta do it.
 *
 * [MDN has recommendations for `User-Agent` testing if you must do it][1].
 * [DeviceAtlas has a handy resource of user agent strings for various devices][2].
 *
 * This function should return true for Mac laptops, iPhones, iPads and other Apple
 * hardware but nothing else (assuming a well-formed user agent string).
 *
 * This should also pass if the string `CyberworldsNativeMobileIos` is included.
 * Which represents a request from our native iOS app.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent#mobile_tablet_or_desktop
 * [2]: https://deviceatlas.com/blog/list-of-user-agent-strings
 */
export function isAppleDeviceUserAgent(userAgent: string): boolean {
    return /Mac|iPhone|iPad|iPod|CyberworldsNativeMobileIos/.test(userAgent);
}

/**
 * Get the browser engine from the user agent string based on [user agent
 * sniffing][1]. We default to `Blink` if we can't determine the engine otherwise.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent#rendering_engine
 */
export function getRenderingEngineFromUserAgent(userAgent: string): "Blink" | "Gecko" | "WebKit" {
    if (userAgent.includes("Chrome/")) return "Blink";
    if (userAgent.includes("WebKit/")) return "WebKit";
    if (userAgent.includes("Gecko/")) return "Gecko";

    // By default, assume we're using the Chrome rendering engine.
    return defaultClientInfo.renderingEngine;
}
