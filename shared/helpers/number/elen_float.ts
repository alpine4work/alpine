import {assert} from "~/shared/helpers/control/assert.js";
import {
    decodeElenIntegerIfPossible,
    decodeElenIntegerIfPossibleIgnoringEndIndex,
    elenIntegerNegativeChar,
    elenIntegerPositiveChar,
    encodeElenInteger,
} from "~/shared/helpers/number/elen_integer.js";
import {constructFloat, deconstructFloat} from "~/shared/helpers/number/float_representation.js";

/**
 * String encoding of a float whose lexicographic order is the same as the
 * underlying float value's order. The format is based on the one described in
 * Peter Seymour's paper "[Efficient Lexicographic Encoding of Numbers][1]".
 * Specifically section 6 where the author describes deconstructing a float into
 * integers so it can be encoded.
 *
 * Useful for databases like DynamoDB where we want to build compound keys using
 * numbers that still maintain the ordering of the underlying number.
 *
 * This type supports all JavaScript numbers. But for simple integers the encoded
 * string is much longer than what you'd get with `ElenInteger`. So prefer using
 * `ElenInteger` if you only need to deal with integers. This is why we call this
 * type `ElenFloat` instead of `ElenNumber`. To discourage use of the proper
 * encoding based on the kind of number you're working with.
 *
 * [1]: https://www.zanopha.com/docs/elen.pdf
 */
export type ElenFloat = string & {readonly _ElenFloat: never};

/**
 * Is the provided string an `ElenFloat`?
 */
export function isElenFloat(string: string): string is ElenFloat {
    return decodeElenFloatIfPossible(string) !== null;
}

/**
 * Encodes an integer into an `ElenFloat`. Even works for special values like `NaN`
 * and `Infinity`.
 */
export function encodeElenFloat(number: number): ElenFloat {
    const floatRepresentation = deconstructFloat(number);

    const sign = floatRepresentation.sign === 1 ? elenIntegerNegativeChar : elenIntegerPositiveChar;

    const exponent = encodeElenInteger(
        floatRepresentation.exponent * (floatRepresentation.sign === 1 ? -1 : 1),
    );

    const mantissa = encodeElenInteger(
        floatRepresentation.mantissa * (floatRepresentation.sign === 1 ? -1 : 1),
    );

    return `${sign}${exponent}${mantissa}` as ElenFloat;
}

/**
 * Decodes an `ElenFloat` back into a JavaScript number.
 */
export function decodeElenFloat(elenFloat: ElenFloat): number {
    const float = decodeElenFloatIfPossible(elenFloat);
    assert(float !== null);
    return float;
}

/**
 * Decodes a string that might be an `ElenFloat` back into a JavaScript number. If
 * the string is not an `ElenFloat` then we will return null.
 */
export function decodeElenFloatIfPossible(string: string): number | null {
    if (string.length === 0) return null;

    let sign: 0 | 1;
    if (string[0] === elenIntegerPositiveChar) sign = 0;
    else if (string[0] === elenIntegerNegativeChar) sign = 1;
    else return null;

    const exponentResult = decodeElenIntegerIfPossibleIgnoringEndIndex(string.slice(1));
    if (exponentResult === null) return null;

    const mantissa = decodeElenIntegerIfPossible(string.slice(1 + exponentResult.endIndex));
    if (mantissa === null) return null;

    return constructFloat({
        sign,
        exponent: exponentResult.integer * (sign === 1 ? -1 : 1),
        mantissa: mantissa * (sign === 1 ? -1 : 1),
    });
}
