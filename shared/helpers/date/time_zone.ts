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

/**
 * Is the provided string a valid time zone?
 */
export function isTimeZone(string: string): string is TimeZone {
    try {
        Intl.DateTimeFormat(undefined, {timeZone: string});
        return true;
    } catch (ex) {
        return false;
    }
}

/**
 * Get the current time zone for our JavaScript realm.
 */
export function getCurrentTimeZone(): TimeZone {
    return Intl.DateTimeFormat().resolvedOptions().timeZone as TimeZone;
}
