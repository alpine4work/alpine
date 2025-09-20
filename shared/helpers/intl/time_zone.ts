import {assert} from "~/shared/helpers/control/assert.js";

/**
 * A time zone identifier. We determine if a string is a valid time zone by
 * trying to use it with `Intl.DateTimeFormat()`.
 *
 * There is a risk we are running in an environment that does not have full
 * support for all IANA time zone identifiers.
 */
export type TimeZone = string & {readonly _TimeZone: never};

/**
 * The default time zone to use when none is provided.
 */
export const defaultTimeZone = "America/New_York" as TimeZone;

let validTimeZones: Set<string> | null = null;

/**
 * Is the provided string a valid time zone?
 */
export function isTimeZone(string: string): string is TimeZone {
    // Optimization: If we've already determined a `TimeZone` is valid we don't
    // need to construct `Intl.DateTimeFormat` again.
    validTimeZones ??= new Set();
    if (validTimeZones.has(string)) return true;

    try {
        Intl.DateTimeFormat(undefined, {timeZone: string});
        validTimeZones.add(string);
        return true;
    } catch {
        return false;
    }
}

/**
 * Assert that a string is actually a valid time zone.
 */
export function assertTimeZone(string: string): TimeZone {
    assert(isTimeZone(string));
    return string;
}

/**
 * Get the current time zone for our JavaScript realm.
 */
export function getCurrentTimeZone(): TimeZone {
    return Intl.DateTimeFormat().resolvedOptions().timeZone as TimeZone;
}
