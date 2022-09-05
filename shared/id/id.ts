/**
 * Ids in our system are 128 bits of randomness encoded in 26 base-32
 * characters.
 *
 * They carry the same information as a [UUID][1] but with a more compact
 * encoding.
 *
 * [1]: https://en.wikipedia.org/wiki/Universally_unique_identifier
 */
export type Id = string & {readonly _Id: never};

/**
 * [Crockford's Base32 alphabet][1].
 *
 * [1]: https://www.crockford.com/base32.html
 */
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

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

    for (let i = 0; i < bytes.length; i++) {
        value = (value << 8) | bytes[i]!;
        bits += 8;

        while (bits >= 5) {
            id += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        id += alphabet[(value << (5 - bits)) & 31];
    }

    return id as Id;
}
