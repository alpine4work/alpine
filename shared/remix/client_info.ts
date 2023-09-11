import {mobileMaxScreenWidth} from "~/shared/design/spacing.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Self-reported information about the client available on the server via a cookie.
 * If client info changes the server doesn't know about it until the next HTTP
 * request.
 */
export type ClientInfo = SchemaType<typeof ClientInfoSchema>;

export const ClientInfoSchema = Schema.object({
    /**
     * The width of the client's screen. This should stay constant as while the
     * user may resize their browser window their device size shouldn't change.
     *
     * We use this when server-side rendering a virtualized list to determine how
     * much content to render on the server.
     *
     * (A user could rotate their phone/tablet changing the screen size. If we
     * really need this to be constant maybe we should track the max of screen
     * width/height.)
     */
    screenWidth: Schema.integer,

    /**
     * The height of the client's screen. This should stay constant as while the
     * user may resize their browser window their device size shouldn't change.
     *
     * We use this when server-side rendering a virtualized list to determine how
     * much content to render on the server.
     *
     * (A user could rotate their phone/tablet changing the screen size. If we
     * really need this to be constant maybe we should track the max of screen
     * width/height.)
     */
    screenHeight: Schema.integer,

    /**
     * The time zone a user is in. Should be an IANA time zone identifier like
     * `America/New_York`.
     */
    timeZone: TimeZoneSchema,

    /**
     * The locale of the user. Should be an IETF language tag like `en-US`.
     *
     * Right now we only support the `en-US` locale. Expanding our support for
     * other languages requires internationalizing the product. We include the
     * locale here, though, to help us easily track where in the product the locale
     * needs to be dynamic.
     */
    locale: Schema.value("en-US").default("en-US"),
});

/**
 * Default client info to use in tests or in server-side rendering before we
 * set the client info cookie.
 */
export const defaultClientInfo: ClientInfo = {
    /**
     * The default screen width we use when server-side rendering when we don't
     * know what the user's actual screen width is. 1920px is the width of the
     * [largest common screen resolution][1] so that should cover the majority of
     * devices.
     *
     * [1]: https://www.browserstack.com/guide/ideal-screen-sizes-for-responsive-design
     */
    screenWidth: 1920,

    /**
     * The default screen height we use when server-side rendering when we don't
     * know what the user's actual screen height is. 1080px is the height of the
     * [largest common screen resolution][1] so that should cover the majority of
     * devices.
     *
     * [1]: https://www.browserstack.com/guide/ideal-screen-sizes-for-responsive-design
     */
    screenHeight: 1080,

    /**
     * We use the New York time zone when we haven't gotten the client's actual
     * time zone since that's where our company is based.
     */
    timeZone: defaultTimeZone,

    /**
     * We use English as the default locale when we haven't gotten the client's
     * actual locale since we are a US company.
     */
    locale: "en-US",
};

/**
 * Default client info for mobile browsers. On the server if there is no client
 * info cookie but we sniff the user-agent and it looks like a mobile device
 * then we will use this client info hoping it better matches the actual device.
 */
export const defaultMobileClientInfo: ClientInfo = {
    ...defaultClientInfo,

    /**
     * Use the maximum screen width that triggers our mobile site instead of the
     * desktop site.
     */
    screenWidth: mobileMaxScreenWidth,

    /**
     * The common responsive design height of a device with a width of
     * `mobileMaxScreenWidth`. From [BrowserStack][1].
     *
     * [1]: https://www.browserstack.com/guide/ideal-screen-sizes-for-responsive-design
     */
    screenHeight: 1366,
};
