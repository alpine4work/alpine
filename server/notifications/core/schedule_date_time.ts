import {fromDate, parseAbsolute} from "@internationalized/date";
import {isValid} from "date-fns/isValid";
import {assert} from "~/shared/helpers/control/assert.js";
import {DateString} from "~/shared/helpers/date/date_string.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

/**
 * A representation of a scheduled date and time that is a subtype of the JavaScript `Date` object.
 * This means all `ScheduleDateTime`s are valid `Date` objects, but not all `Date` objects are valid `ScheduleDateTime`s.
 *
 * It adds enforcement that the time is truncated to the nearest hour and uses `@internationalized/date`
 * to perform actions on the date while zoned in UTC. However, since it still
 * uses the native `Date` object, once it has been returned, it is time zone naive.
 *
 * NOTE (rmtobin): When/if we adopt Temporal, this should be time zone aware in UTC.
 */
export type ScheduleDateTime = Date & {readonly _ScheduleDateTime: never};

export function isScheduleDateTime(date: Date): date is ScheduleDateTime {
    if (!isValid(date)) return false;
    if (date.toISOString().match(ScheduleDateTimeMatcher) === null) return false;
    return true;
}

/**
 * Assert that a `Date` object is a valid `ScheduleDateTime`.
 */
export function assertScheduleDateTime(date: Date, message?: string): ScheduleDateTime {
    assert(isScheduleDateTime(date), message);
    return date;
}

/**
 * Serialize a JavaScript `Date` object to a `ScheduleDateTime`.
 */
export function serializeScheduleDateTime(date: Date): ScheduleDateTime {
    const parsedDate = fromDate(date, "UTC").set({minute: 0, second: 0, millisecond: 0});
    return assertScheduleDateTime(parsedDate.toDate());
}

/**
 * Deserialize a `ScheduleDateTime` to a JavaScript `Date` object.
 */
export function deserializeScheduleDateTime(ScheduleDateTime: ScheduleDateTime): Date {
    return ScheduleDateTime;
}

/**
 * An ISO 8601 time string representing a ScheduleDateTime in the format "YYYY-MM-DDTHH:mm:00.000Z".
 * All `ScheduleDateTimeStrings` are valid `DateString`s, but not all `DateString`s are valid
 * `ScheduleDateTimeStrings`.
 */
export type ScheduleDateTimeString = DateString & {readonly _ScheduleDateTimeString: never};

export function isScheduleDateTimeString(string: string): string is ScheduleDateTimeString {
    if (typeof string !== "string") return false;
    if (string.match(ScheduleDateTimeMatcher) === null) return false;
    try {
        parseAbsolute(string, "UTC");
    } catch {
        return false;
    }
    return true;
}

export function assertScheduleDateTimeString(
    string: string,
    message?: string,
): ScheduleDateTimeString {
    assert(isScheduleDateTimeString(string), message);
    return string;
}

export function serializeScheduleDateTimeString(date: ScheduleDateTime): ScheduleDateTimeString {
    const roundedDateTime = serializeScheduleDateTime(date);
    return assertScheduleDateTimeString(roundedDateTime.toISOString());
}

export function deserializeScheduleDateTimeString(
    dateString: ScheduleDateTimeString,
): ScheduleDateTime {
    const parsedDate = serializeScheduleDateTime(new Date(dateString));
    return assertScheduleDateTime(parsedDate);
}

export const ScheduleDateTimeSchema = Schema.date.transform<ScheduleDateTime>({
    serialize: value => value,
    deserialize: value => {
        try {
            return serializeScheduleDateTime(value);
        } catch {
            throw new SchemaDeserializationError(
                "Cannot deserialize `Date` value into `ScheduleDateTime`",
            );
        }
    },
});

// Matches the format "YYYY-MM-DDTHH:mm:00.000Z" where seconds and milliseconds are zero
const ScheduleDateTimeMatcher = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/;
