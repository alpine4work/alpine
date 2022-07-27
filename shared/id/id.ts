/**
 * Ids in our system are 128 bits of randomness encoded in 26 base-32
 * characters.
 */
export type Id = string & {readonly _Id: never};

/**
 * [Crockford's Base32 alphabet][1].
 *
 * [1]: https://www.crockford.com/base32.html
 */
const BASE32_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Generate a new random id using a cryptographically secure source of
 * randomness.
 */
export function generateId(): Id {
    let bytes: Uint8Array;

    if (typeof crypto !== "undefined") {
        bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
    } else {
        const crypto = require("crypto");
        bytes = crypto.randomBytes(16);
    }

    let bits = 0;
    let value = 0;
    let id = "";

    for (let index = 0; index < bytes.length; index++) {
        value = (value << 8) | bytes[index]!;
        bits += 8;

        while (bits >= 5) {
            id += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        id += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return id as Id;
}
