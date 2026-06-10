import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * String encoding of an integer whose lexicographic order is the same as the
 * underlying integer order. The format is based on the one described in Peter
 * Seymour's paper "[Efficient Lexicographic Encoding of Numbers][1]".
 *
 * Useful for databases like DynamoDB where we want to build compound keys using
 * numbers that still maintain the ordering of the underlying number.
 *
 * This type only supports safe JavaScript integers. We also have `ElenFloat` which
 * supports all JavaScript numbers. But the `ElenFloat` encoding is much longer for
 * integers since it encodes the floats underlying binary representation.
 *
 * [1]: https://www.zanopha.com/docs/elen.pdf
 */
export type ElenInteger = string & {readonly _ElenInteger: never};

/**
 * Character we use for denoting a positive `ElenInteger`.
 *
 * In Peter Seymour's paper "[Efficient Lexicographic Encoding of Numbers][1]" he
 * uses the `+` character. However the ASCII character code for `+` is less than
 * the ASCII character code for `-` and less than the ASCII character code for all
 * digits.
 *
 * We need a character that ASCII orders after both `-` and all digits to preserve
 * lexicographic ordering.
 *
 * [1]: https://www.zanopha.com/docs/elen.pdf
 */
export const elenIntegerPositiveChar = "=";

/**
 * Character we use for denoting a negative `ElenInteger`.
 *
 * We can use the minus symbol (`-`) because it is both less than the character
 * we've chose for positive integers (`=`) and less than all digits so will be
 * ordered before all other digits.
 */
export const elenIntegerNegativeChar = "-";

/**
 * Is the provided string an `ElenInteger`?
 */
export function isElenInteger(string: string): string is ElenInteger {
    return decodeElenIntegerIfPossible(string) !== null;
}

/**
 * Encodes an integer into an `ElenInteger`. Throws if the provided number is not
 * an integer.
 */
export function encodeElenInteger(integer: number): ElenInteger {
    assert(Number.isSafeInteger(integer));

    if (integer === 0) return "0" as ElenInteger;
    if (integer > 0) return encodePositiveElenInteger(integer) as ElenInteger;
    return encodeNegativeElenInteger(integer * -1) as ElenInteger;
}

function encodePositiveElenInteger(integer: number): string {
    const string = String(integer);
    if (string.length === 1) return `${elenIntegerPositiveChar}${string}`;
    return `${elenIntegerPositiveChar}${encodePositiveElenInteger(string.length)}${string}`;
}

function encodeNegativeElenInteger(integer: number): string {
    let string = String(integer);
    string = Array.from(string, flipDigitChar).join("");
    if (string.length === 1) return `${elenIntegerNegativeChar}${string}`;
    return `${elenIntegerNegativeChar}${encodeNegativeElenInteger(string.length)}${string}`;
}

function flipDigitChar(digitChar: string): string {
    switch (digitChar) {
        case "0":
            return "9";
        case "1":
            return "8";
        case "2":
            return "7";
        case "3":
            return "6";
        case "4":
            return "5";
        case "5":
            return "4";
        case "6":
            return "3";
        case "7":
            return "2";
        case "8":
            return "1";
        case "9":
            return "0";
        default:
            throw new InvalidArgumentError(quote`Unexpected digit character ${digitChar}`);
    }
}

/**
 * Decodes an `ElenInteger` back into a JavaScript number.
 */
export function decodeElenInteger(elenInteger: ElenInteger): number {
    const integer = decodeElenIntegerIfPossible(elenInteger);
    assert(integer !== null);
    return integer;
}

/**
 * Decodes a string that might be an `ElenInteger` back into a JavaScript number.
 * If the string is not an `ElenInteger` then we will return null.
 */
export function decodeElenIntegerIfPossible(string: string): number | null {
    const result = decodeElenIntegerIfPossibleIgnoringEndIndex(string);
    if (result === null) return null;
    if (result.endIndex !== string.length) return null;
    return result.integer;
}

/**
 * Decodes a string that might be an `ElenInteger` back into a JavaScript number.
 * If the string is not an `ElenInteger` then we will return null.
 *
 * Unless the string is prefixed with an `ElenInteger` then continues with some
 * other content. In this case we will return the integer and an `endIndex` for
 * where we saw the integer stop.
 */
export function decodeElenIntegerIfPossibleIgnoringEndIndex(
    string: string,
): {integer: number; endIndex: number} | null {
    if (string.length === 0) return null;
    if (string[0] === "0") return {integer: 0, endIndex: 1};
    if (string[0] === elenIntegerPositiveChar) return decodePositiveElenIntegerIfPossible(string);
    if (string[0] === elenIntegerNegativeChar) return decodeNegativeElenIntegerIfPossible(string);
    return null;
}

function decodePositiveElenIntegerIfPossible(
    string: string,
): {integer: number; endIndex: number} | null {
    let index = 0;

    while (index < string.length && string[index] === elenIntegerPositiveChar) {
        index++;
    }

    let positiveChars = index;
    let integer = 1;

    while (positiveChars > 0) {
        const integerString = string.slice(index, index + integer);
        if (integerString.length !== integer) return null;

        const nextInteger = parseInt(integerString);
        if (isNaN(nextInteger)) return null;

        index = index + integer;
        integer = nextInteger;
        positiveChars--;
    }

    return {
        integer,
        endIndex: index,
    };
}

function decodeNegativeElenIntegerIfPossible(
    string: string,
): {integer: number; endIndex: number} | null {
    let index = 0;

    while (index < string.length && string[index] === elenIntegerNegativeChar) {
        index++;
    }

    let negativeChars = index;
    let integer = 1;

    while (negativeChars > 0) {
        let integerString = string.slice(index, index + integer);
        if (integerString.length !== integer) return null;

        // Make sure the integer string is actually an integer before we flip its digits
        // and parse for real. The flip digit function will throw if any of the characters
        // in the string are not a digit.
        if (isNaN(parseInt(integerString))) return null;

        integerString = Array.from(integerString, flipDigitChar).join("");
        const nextInteger = parseInt(integerString);

        index = index + integer;
        integer = nextInteger;
        negativeChars--;
    }

    return {
        integer: integer * -1,
        endIndex: index,
    };
}
