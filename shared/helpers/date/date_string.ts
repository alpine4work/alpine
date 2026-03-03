import {isValid} from "date-fns/isValid";
import {parseISO} from "date-fns/parseISO";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * A date encoded in the [ISO 8601][1] format.
 *
 * Useful when serializing JavaScript `Date` objects over the network.
 *
 * [1]: https://en.wikipedia.org/wiki/ISO_8601
 */
export type DateString = string & {readonly _DateString: never};

/**
 * Is the provided string a valid `DateString`?
 */
export function isDateString(string: string): string is DateString {
    const date = parseISO(string);
    return isValid(date);
}

/**
 * Asserts the provided string is a valid `DateString`.
 */
export function assertDateString(string: string): DateString {
    assert(isDateString(string));
    return string;
}

/**
 * Serializes a JavaScript `Date` object to a `DateString`.
 *
 * Fails with an `InternalError` if the provided `Date` is not valid.
 */
export function serializeDateString(date: Date): DateString {
    assert(isValid(date));

    // `formatISO()` from `date-fns` truncates milliseconds by default. Use the native
    // `toISOString()` method for printing dates.
    return date.toISOString() as DateString;
}

/**
 * Deserializes a `DateString` to a JavaScript `Date` object.
 *
 * Fails with an `InternalError` if the provided string is not a valid [ISO
 * 8601][1] date string.
 *
 * [1]: https://en.wikipedia.org/wiki/ISO_8601
 */
export function deserializeDateString(dateString: DateString): Date {
    const date = parseISO(dateString);
    assert(isValid(date));
    return date;
}
