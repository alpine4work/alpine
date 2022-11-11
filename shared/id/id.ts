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

let alphabetSet: Set<string>;

/**
 * The length of an ID.
 */
export const idLength = 26;

/**
 * The maximum `Id` string we can generate. The 26 characters that make up an
 * ID can store 130 bits of information but we want to limit ourselves to 128
 * bits. That way we can represent the `Id` as an integer.
 */
export const maxId = "zzzzzzzzzzzzzzzzzzzzzzzzzw" as Id;

/**
 * Is the provided string a valid `Id`?
 */
export function isId(string: string): string is Id {
    if (string.length !== idLength) return false;

    // Lazily initialize the alphabet set.
    if (!alphabetSet) alphabetSet = new Set(alphabet);

    for (let index = 0; index < string.length; index++) {
        const char = string[index]!;
        if (!alphabetSet.has(char)) return false;
    }

    if (string > maxId) return false;

    return true;
}

/**
 * Generate a new random id using a cryptographically secure source of
 * randomness.
 */
export function generateId(): Id {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

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
