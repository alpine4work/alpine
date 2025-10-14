import {TimeZone, isTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

export const TimeZoneSchema = Schema.string.transform<TimeZone>({
    serialize: timeZone => timeZone,
    deserialize: timeZone => {
        if (!isTimeZone(timeZone))
            throw new SchemaDeserializationError("Expected string to be a valid time zone");
        return timeZone;
    },
});
