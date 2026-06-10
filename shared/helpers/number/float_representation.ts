// The implementation of this file was derived from:
// https://github.com/ealmansi/elen/blob/3a38e52c1a153dd11fb30add7d3c7a7f1c30e5d8/src/binary64.js

import {assert} from "~/shared/helpers/control/assert.js";

/**
 * The underlying representation of a [floating point number][1].
 *
 * JavaScript represents all numbers as a 64-bit float. You can use this function
 * to see the exact exponent and mantissa (aka significand) of the float.
 *
 * Useful if you want to encode a float in some custom way.
 *
 * [1]: https://en.wikipedia.org/wiki/Floating-point_arithmetic
 */
export type FloatRepresentation = {
    readonly sign: 0 | 1;
    readonly exponent: number;
    readonly mantissa: number;
};

const maxExponent = 2047;
const maxMantissa = 4503599627370495;

export function constructFloat({sign, exponent, mantissa}: FloatRepresentation): number {
    const buffer = new ArrayBuffer(8);
    const floatArray = new Float64Array(buffer);
    const intArray = new Uint8Array(buffer);

    setSign(sign, intArray);
    setExponent(exponent, intArray);
    setMantissa(mantissa, intArray);

    return floatArray[0]!;
}

export function deconstructFloat(number: number): FloatRepresentation {
    const buffer = new ArrayBuffer(8);
    const floatArray = new Float64Array(buffer);
    const intArray = new Uint8Array(buffer);
    floatArray[0] = number;
    return {
        sign: getSign(intArray) as 0 | 1,
        exponent: getExponent(intArray),
        mantissa: getMantissa(intArray),
    };
}

function getSign(intArray: Uint8Array) {
    return shiftRight(intArray[7]!, 7);
}

function setSign(sign: 0 | 1, intArray: Uint8Array) {
    intArray[7]! |= shiftLeft(sign, 7);
}

function getExponent(intArray: Uint8Array) {
    let r = 0;
    r += shiftLeft(intArray[7]! & 0x7f, 4);
    r += shiftRight(intArray[6]!, 4);
    return r;
}

function setExponent(exponent: number, intArray: Uint8Array) {
    assert(exponent >= 0);
    assert(exponent <= maxExponent);

    intArray[7]! |= shiftRight(exponent, 4);
    intArray[6]! |= shiftLeft(exponent & 0xf, 4);
}

function getMantissa(intArray: Uint8Array) {
    let r = 0;
    r += shiftLeft(intArray[6]! & 0x0f, 48);
    r += shiftLeft(intArray[5]!, 40);
    r += shiftLeft(intArray[4]!, 32);
    r += shiftLeft(intArray[3]!, 24);
    r += shiftLeft(intArray[2]!, 16);
    r += shiftLeft(intArray[1]!, 8);
    r += intArray[0]!;
    return r;
}

function setMantissa(mantissa: number, intArray: Uint8Array) {
    assert(mantissa >= 0);
    assert(mantissa <= maxMantissa);

    intArray[6]! |= shiftRight(mantissa, 48) & 0xff;
    intArray[5]! |= shiftRight(mantissa, 40) & 0xff;
    intArray[4]! |= shiftRight(mantissa, 32) & 0xff;
    intArray[3]! |= shiftRight(mantissa, 24) & 0xff;
    intArray[2]! |= shiftRight(mantissa, 16) & 0xff;
    intArray[1]! |= shiftRight(mantissa, 8) & 0xff;
    intArray[0]! |= mantissa & 0xff;
}

function shiftLeft(n: number, bits: number) {
    return n * Math.pow(2, bits);
}

function shiftRight(n: number, bits: number) {
    return Math.floor(n / Math.pow(2, bits));
}
