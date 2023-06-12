import {TimeZone, isTimeZone} from "~/shared/helpers/date/time_zone";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema";

export const TimeZoneSchema = Schema.string.transform<TimeZone>({
    serialize: timeZone => timeZone,
    deserialize: timeZone => {
        if (!isTimeZone(timeZone))
            throw new SchemaDeserializationError("Expected string to be a valid time zone");

        return timeZone;
    },
});
