import murmurhash from "murmurhash";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {isSearchDynamicEntityType} from "~/shared/search/search_entity_id.js";

/**
 * An `ApiContentKey` is used to identify positions in content for our API.
 *
 * An `ApiContentKey` is a URL safe base64 encoded string. The underlying bytes are
 * scrambled using `entityId` as the seed. The unscrambled bytes are:
 *
 * - 1 version bit
 * - 23 bits of the entity hash
 * - version varint
 * - pos varint
 * - node size varint
 */
export type ApiContentKey = string & {readonly _ApiContentKey: never};

/**
 * Encode `ApiContentKey`s.
 *
 * This is a class for performance. So we only need to hash the `entityId` once.
 */
export class ApiContentKeyEncoder {
    readonly #entityIdHash: number;
    readonly #basePayload: ReadonlyArray<number>;

    constructor({entityId, version}: {entityId: string; version: number}) {
        assert(version >= 0);
        assert(Number.isSafeInteger(version));

        const entityIdHash = murmurhash.v3(entityId);

        const basePayload: Array<number> = [];

        // Use 23 bits of the entity hash as a way to detect when you're using a key for
        // the wrong entity. Collision chance is 1 / 8,388,608 which is fine since it's not
        // a strong invariant that we catch every misused content key. It's mostly to
        // improve the developer experience and catch accidental mistakes.
        //
        // We always use 0 as the first bit as versioning information. So if we want to
        // change the payload format we can switch to 1 and that's a signal to our decoder
        // that we're using a new format. However, since the version is inside the
        // scrambled payload that kind locks the scramble strategy in place since the
        // decoder will always need to unscramble.
        basePayload.push(entityIdHash & 0b01111111);
        basePayload.push((entityIdHash >>> 8) & 0b11111111);
        basePayload.push((entityIdHash >>> 16) & 0b11111111);

        writeVarint(version, basePayload);

        this.#entityIdHash = entityIdHash;
        this.#basePayload = basePayload;
    }

    encode({pos, nodeSize}: {pos: number; nodeSize: number}) {
        assert(pos >= 0);
        assert(Number.isSafeInteger(pos));

        assert(nodeSize >= 0);
        assert(Number.isSafeInteger(nodeSize));

        const payload = [...this.#basePayload];

        writeVarint(pos, payload);
        writeVarint(nodeSize, payload);

        const bytes = scramble(new Uint8Array(payload), this.#entityIdHash);

        return encodeBase64(bytes, "Rfc4648Url") as ApiContentKey;
    }
}

/**
 * Decodes `ApiContentKey`s.
 *
 * This is a class for performance. So we only need to hash the `entityId` once.
 */
export class ApiContentKeyDecoder {
    readonly #entityId: string;
    readonly #entityIdHash: number;

    constructor(entityId: string) {
        this.#entityId = entityId;
        this.#entityIdHash = murmurhash.v3(entityId);
    }

    decode(key: string): {
        version: number;
        pos: number;
        nodeSize: number;
    } {
        const bytes = decodeBase64(key, "Rfc4648Url");

        const payload = unscramble(bytes, this.#entityIdHash);

        const createError = () =>
            new InvalidArgumentError("Invalid content key", {
                displayMessage: errorDisplayMessage`Invalid content key. Try again with a string from \`element.key\`.`,
            });

        if (payload.length < 3) throw createError();

        let offset = 3;

        const versionResult = readVarint(payload, offset, payload.length);
        if (versionResult === null) throw createError();
        offset = versionResult.offset;

        const posResult = readVarint(payload, offset, payload.length);
        if (posResult === null) throw createError();
        offset = posResult.offset;

        const nodeSizeResult = readVarint(payload, offset, payload.length);
        if (nodeSizeResult === null) throw createError();
        offset = nodeSizeResult.offset;

        if (offset !== payload.length) throw createError();

        // Check the the entity hash in the key matches the expected entity hash. After
        // we've verified that the structure
        if (
            payload[0] !== (this.#entityIdHash & 0b01111111) ||
            payload[1] !== ((this.#entityIdHash >>> 8) & 0b11111111) ||
            payload[2] !== ((this.#entityIdHash >>> 16) & 0b11111111)
        ) {
            const [entityIdType = ""] = this.#entityId.split(":", 2);

            const noun = isSearchDynamicEntityType(entityIdType)
                ? getSearchEntityNoun(entityIdType)
                : "thing";

            throw new InvalidArgumentError("Content key doesn\u2019t match `entityId`", {
                displayMessage: errorDisplayMessage`Content key is for a different ${noun}. Try again with a string from an \`element.key\` in the ${noun} you\u2019re trying to reference.`,
            });
        }

        return {
            version: versionResult.value,
            pos: posResult.value,
            nodeSize: nodeSizeResult.value,
        };
    }
}

function writeVarint(value: number, out: Array<number>): void {
    let n = value;

    // Protobuf unsigned varint encoding:
    //
    // Each byte stores 7 bits of the integer. The high bit means "more bytes follow."
    // So all bytes except the final byte have bit 0x80 set.
    while (n >= 0x80) {
        out.push((n % 0x80) | 0x80);
        n = Math.floor(n / 0x80);
    }

    out.push(n);
}

function readVarint(
    bytes: Uint8Array,
    offset: number,
    limit: number,
): {value: number; offset: number} | null {
    let value = 0;
    let multiplier = 1;

    while (offset < limit) {
        const byte = bytes[offset++]!;
        const digit = byte & 0x7f;

        if (digit > (Number.MAX_SAFE_INTEGER - value) / multiplier) return null;

        value += digit * multiplier;

        if ((byte & 0x80) === 0) {
            return {value, offset};
        }

        if (multiplier > Number.MAX_SAFE_INTEGER / 0x80) return null;

        multiplier *= 0x80;
    }

    return null;
}

// Ad hoc reversible byte diffusion routine: hash-derived state, add a mask byte,
// feed the scrambled byte back into state, then do a reverse-direction pass.
// Written by GPT-5.5 (Extra High).
//
// Reasoning why GPT-5.5 picked its constants:
//
// - `0x9e37_79b9` comes from the golden ratio scaled to 32 bits. It's widely used
//   for hash mixing, Weyl sequences, and stepping through 32-bit state because it
//   distributes increments well.
//
// - `0x85eb_ca6b` is one of MurmurHash3's finalizer constants.
//
// - `0x7feb_352d` and `0x846c_a68b` are common constants from a public-domain-ish
//   32-bit integer finalizer often referred to as hash32shift/lowbias32 style
//   mixing. They're used because they have decent avalanche behavior for 32-bit
//   inputs.
function scramble(bytes: Uint8Array, seed: number): Uint8Array {
    const out = Uint8Array.from(bytes);

    // Forward pass.
    //
    // Each byte gets a mask byte derived from:
    //
    // - the seed,
    // - the byte position,
    // - previously scrambled bytes.
    //
    // Because state incorporates the scrambled byte, changing one early byte affects
    // later bytes too.
    let state = mix32(seed ^ 0x9e37_79b9);

    for (let i = 0; i < out.length; i++) {
        state = mix32(state + i);
        out[i] = (out[i]! + (state & 0xff)) & 0xff;
        state = mix32(state ^ out[i]!);
    }

    // Backward pass.
    //
    // This gives later bytes a chance to affect earlier bytes too.
    state = mix32(seed ^ 0x85eb_ca6b);

    for (let i = out.length - 1; i >= 0; i--) {
        state = mix32(state + i);
        out[i] = (out[i]! + (state & 0xff)) & 0xff;
        state = mix32(state ^ out[i]!);
    }

    return out;
}

function unscramble(bytes: Uint8Array, seed: number): Uint8Array {
    const out = Uint8Array.from(bytes);

    // Reverse the scramble exactly:
    //
    // - backward pass is undone first,
    // - forward pass is undone second,
    // - byte addition is reversed with subtraction.

    let state = mix32(seed ^ 0x85eb_ca6b);

    for (let i = out.length - 1; i >= 0; i--) {
        state = mix32(state + i);

        // Save the scrambled byte because scramble() used that byte to update state after
        // applying the mask.
        const byte = out[i]!;

        out[i] = (byte - (state & 0xff) + 256) & 0xff;
        state = mix32(state ^ byte);
    }

    state = mix32(seed ^ 0x9e37_79b9);

    for (let i = 0; i < out.length; i++) {
        state = mix32(state + i);

        const byte = out[i]!;

        out[i] = (byte - (state & 0xff) + 256) & 0xff;
        state = mix32(state ^ byte);
    }

    return out;
}

function mix32(value: number): number {
    // A small avalanche-style 32-bit mixer.
    //
    // Nearby inputs tend to produce very different outputs, which is useful for making
    // adjacent version/pos values look unrelated after scrambling.
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb_352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846c_a68b);
    x ^= x >>> 16;
    return x >>> 0;
}
