import {TimeZone, isTimeZone} from "~/shared/helpers/date/time_zone";
import {Schema, SchemaDeserializationError, SchemaType} from "~/shared/schema/schema";

/**
 * Self-reported information about the client available on the server via a cookie.
 * If client info changes the server doesn't know about it until the next HTTP
 * request.
 */
export type ClientInfo = SchemaType<typeof ClientInfoSchema>;

export const ClientInfoSchema = Schema.object({
    screenWidth: Schema.integer,
    screenHeight: Schema.integer,
    timeZone: Schema.string.transform<TimeZone>({
        serialize: timeZone => timeZone,
        deserialize: timeZone => {
            if (!isTimeZone(timeZone))
                throw new SchemaDeserializationError("Expected string to be a valid time zone");

            return timeZone;
        },
    }),
});
