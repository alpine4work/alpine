/**
 * NOTE(calebmer, 2024-04-27): This code was adapted from the `base64-js` library
 * to match our codebase conventions and add support for alternative base64
 * dictionaries. The original source is here:
 * https://github.com/beatgammit/base64-js/blob/83f04b074694929d205171f48ad79a4e073e8429/index.js
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Jameson Little
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {InvalidArgumentError} from "~/shared/error/error.js";

export type Base64Dictionary = keyof typeof dictionaries;

const dictionaries = {
    Rfc4648: (() => {
        const charCodeByValue = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const valueByCharCode = new Map();
        for (let i = 0; i < charCodeByValue.length; i++) {
            valueByCharCode.set(charCodeByValue.charCodeAt(i), i);
        }

        // Support decoding URL-safe base64 strings, as Node.js does. See:
        // https://en.wikipedia.org/wiki/Base64#URL_applications
        valueByCharCode.set("-".charCodeAt(0), 62);
        valueByCharCode.set("_".charCodeAt(0), 63);

        return {charCodeByValue, valueByCharCode, includesPadding: true};
    })(),
    Rfc4648Url: (() => {
        const charCodeByValue = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        const valueByCharCode = new Map();
        for (let i = 0; i < charCodeByValue.length; i++) {
            valueByCharCode.set(charCodeByValue.charCodeAt(i), i);
        }

        return {charCodeByValue, valueByCharCode, includesPadding: false};
    })(),
    Rfc4648UrlWithOrderPreservation: (() => {
        const charCodeByValue = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
        const valueByCharCode = new Map();
        for (let i = 0; i < charCodeByValue.length; i++) {
            valueByCharCode.set(charCodeByValue.charCodeAt(i), i);
        }

        return {charCodeByValue, valueByCharCode, includesPadding: false};
    })(),
};

function getBase64StringLengths(string: string, includesPadding: boolean) {
    const length = string.length;

    if (includesPadding && length % 4 > 0)
        throw new InvalidArgumentError("Invalid base64 string, length must be a multiple of 4");

    // Trim off extra bytes after placeholder bytes are found See:
    // https://github.com/beatgammit/base64-js/issues/42
    let dataLength = string.length;
    while (string[dataLength - 1] === "=") {
        dataLength = dataLength - 1;
    }

    const remainder = dataLength % 4;
    const paddingLength = dataLength === length && remainder === 0 ? 0 : 4 - remainder;

    return {dataLength, paddingLength};
}

export function decodeBase64(
    string: string,
    dictionary: Base64Dictionary = "Rfc4648",
): Uint8Array<ArrayBuffer> {
    const {valueByCharCode, includesPadding} = dictionaries[dictionary];
    const {dataLength, paddingLength} = getBase64StringLengths(string, includesPadding);
    const bytes = new Uint8Array(((dataLength + paddingLength) * 3) / 4 - paddingLength);
    let byteIndex = 0;

    // if there are placeholders, only get up to the last complete 4 chars
    const length = paddingLength > 0 ? dataLength - 4 : dataLength;

    let i = 0;
    for (; i < length; i += 4) {
        const value =
            (valueByCharCode.get(string.charCodeAt(i)) << 18) |
            (valueByCharCode.get(string.charCodeAt(i + 1)) << 12) |
            (valueByCharCode.get(string.charCodeAt(i + 2)) << 6) |
            valueByCharCode.get(string.charCodeAt(i + 3));
        bytes[byteIndex++] = (value >> 16) & 0xff;
        bytes[byteIndex++] = (value >> 8) & 0xff;
        bytes[byteIndex++] = value & 0xff;
    }

    if (paddingLength === 2) {
        const value =
            (valueByCharCode.get(string.charCodeAt(i)) << 2) |
            (valueByCharCode.get(string.charCodeAt(i + 1)) >> 4);
        bytes[byteIndex++] = value & 0xff;
    }

    if (paddingLength === 1) {
        const value =
            (valueByCharCode.get(string.charCodeAt(i)) << 10) |
            (valueByCharCode.get(string.charCodeAt(i + 1)) << 4) |
            (valueByCharCode.get(string.charCodeAt(i + 2)) >> 2);
        bytes[byteIndex++] = (value >> 8) & 0xff;
        bytes[byteIndex++] = value & 0xff;
    }

    return bytes;
}

function tripletToBase64(charCodeByValue: string, triplet: number) {
    return (
        charCodeByValue[(triplet >> 18) & 0x3f]! +
        charCodeByValue[(triplet >> 12) & 0x3f]! +
        charCodeByValue[(triplet >> 6) & 0x3f]! +
        charCodeByValue[triplet & 0x3f]!
    );
}

function encodeBase64Chunk(charCodeByValue: string, bytes: Uint8Array, start: number, end: number) {
    const output = [];
    for (let i = start; i < end; i += 3) {
        const triplet =
            ((bytes[i]! << 16) & 0xff0000) +
            ((bytes[i + 1]! << 8) & 0xff00) +
            (bytes[i + 2]! & 0xff);
        output.push(tripletToBase64(charCodeByValue, triplet));
    }
    return output.join("");
}

export function encodeBase64(bytes: Uint8Array, dictionary: Base64Dictionary = "Rfc4648"): string {
    const {charCodeByValue, includesPadding} = dictionaries[dictionary];
    const length = bytes.length;
    const extraBytes = length % 3; // if we have 1 byte left, pad 2 bytes
    const parts = [];
    const maxChunkLength = 16383; // must be multiple of 3

    // go through the array every three bytes, we'll deal with trailing stuff later
    for (let i = 0, length2 = length - extraBytes; i < length2; i += maxChunkLength) {
        parts.push(
            encodeBase64Chunk(
                charCodeByValue,
                bytes,
                i,
                i + maxChunkLength > length2 ? length2 : i + maxChunkLength,
            ),
        );
    }

    // pad the end with zeros, but make sure to not forget the extra bytes
    if (extraBytes === 1) {
        const value = bytes[length - 1]!;
        parts.push(
            charCodeByValue[value >> 2]! +
                charCodeByValue[(value << 4) & 0x3f]! +
                (includesPadding ? "==" : ""),
        );
    } else if (extraBytes === 2) {
        const value = (bytes[length - 2]! << 8) + bytes[length - 1]!;
        parts.push(
            charCodeByValue[value >> 10]! +
                charCodeByValue[(value >> 4) & 0x3f]! +
                charCodeByValue[(value << 2) & 0x3f]! +
                (includesPadding ? "=" : ""),
        );
    }

    return parts.join("");
}
