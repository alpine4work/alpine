import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";

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
