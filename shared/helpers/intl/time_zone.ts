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

/**
 * Formats a timezone to its abbreviated form (e.g., "America/New_York" -> "EST" or
 * "EDT" depending on whether daylight saving time is active).
 *
 * Uses the Intl API to get the localized timezone abbreviation for a given time.
 * Falls back to extracting abbreviations from the long format if the short format
 * returns generic GMT offsets (common in limited ICU environments).
 */
export function formatTimeZoneAbbreviation(timeZone: TimeZone, time: Date): string {
    // Try short format first (e.g., "EST", "JST")
    const shortFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "short",
    });

    const shortParts = shortFormatter.formatToParts(time);
    const shortTimeZonePart = shortParts.find(part => part.type === "timeZoneName");
    const shortValue = shortTimeZonePart?.value;

    // If we got a good abbreviation (not a GMT offset), use it
    if (shortValue && !shortValue.startsWith("GMT")) {
        return shortValue;
    }

    // Fallback: try to create an abbreviation from the long format
    // e.g., "Japan Standard Time" -> "JST", "Australian Eastern Daylight Time" -> "AEDT"
    try {
        const longFormatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            timeZoneName: "long",
        });

        const longParts = longFormatter.formatToParts(time);
        const longTimeZonePart = longParts.find(part => part.type === "timeZoneName");
        const longValue = longTimeZonePart?.value;

        if (longValue) {
            // Extract first letter of each significant word
            const abbreviation = longValue
                .split(" ")
                .filter(
                    word =>
                        // Keep words that start with uppercase (significant words)
                        word.length > 0 && word[0] === word[0]!.toUpperCase(),
                )
                .map(word => word[0])
                .join("");

            if (abbreviation.length > 0) {
                return abbreviation;
            }
        }
    } catch {
        // Fall through to final fallback
    }

    // Final fallback: return the GMT offset or the timezone identifier
    return shortValue ?? timeZone;
}
