import murmurhash from "murmurhash";
import type {ApiContentKey} from "~/shared/api/specification/types/api_content_key.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {DataBuilderView} from "~/shared/helpers/binary/data_builder_view.js";
import {scrambleBytes, unscrambleBytes} from "~/shared/helpers/binary/scramble_bytes.js";
import {getVarInt, pushVarInt} from "~/shared/helpers/binary/var_int.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {isSearchDynamicEntityType} from "~/shared/search/search_entity_id.js";

/**
 * Encode `ApiContentKey`s.
 *
 * This is a class for performance. So we only need to hash the `entityId` once.
 */
export class ApiContentKeyEncoder {
    readonly #entityIdHash: number;
    readonly #basePayload: Uint8Array;

    constructor({entityId, version}: {entityId: string; version: number}) {
        assert(version >= 0);
        assert(Number.isSafeInteger(version));

        const entityIdHash = murmurhash.v3(entityId);

        const basePayload = new DataBuilderView();

        // Use 22 bits of the entity hash as a way to detect when you're using a key for
        // the wrong entity. Collision chance is 1 / 4,194,304 which is fine since it's not
        // a strong invariant that we catch every misused content key. It's mostly to
        // improve the developer experience and catch accidental mistakes.
        //
        // We always use 0 as the first bit as versioning information. So if we want to
        // change the payload format we can switch to 1 and that's a signal to our decoder
        // that we're using a new format. However, since the version is inside the
        // scrambled payload that kind locks the scramble strategy in place since the
        // decoder will always need to unscramble.
        //
        // The second bit is the "inline" bit. `encode()` sets it when the keyed element
        // has inline content and therefore supports `Inline` positions.
        basePayload.pushUint8(entityIdHash & 0b00111111);
        basePayload.pushUint8((entityIdHash >>> 8) & 0b11111111);
        basePayload.pushUint8((entityIdHash >>> 16) & 0b11111111);

        pushVarInt(basePayload, version);

        this.#entityIdHash = entityIdHash;
        this.#basePayload = basePayload.build();
    }

    encode({
        pos,
        nodeSize,
        inlineContent,
    }: {
        pos: number;
        nodeSize: number;
        inlineContent: boolean;
    }) {
        assert(pos >= 0);
        assert(Number.isSafeInteger(pos));

        assert(nodeSize >= 0);
        assert(Number.isSafeInteger(nodeSize));

        const payload = new DataBuilderView(this.#basePayload);

        if (inlineContent) payload.setUint8(0, payload.getUint8(0) | 0b01000000);

        pushVarInt(payload, pos);
        pushVarInt(payload, nodeSize);

        const bytes = scrambleBytes(payload.build(), this.#entityIdHash);

        return encodeBase64(bytes, "Rfc4648Url") as ApiContentKey;
    }
}

export type ApiContentDecodedKey = {
    readonly version: number;
    readonly pos: number;
    readonly nodeSize: number;
    readonly inlineContent: boolean;
};

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

    decode(key: string): ApiContentDecodedKey {
        const bytes = decodeBase64(key, "Rfc4648Url");

        const payload = unscrambleBytes(bytes, this.#entityIdHash);
        const payloadView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

        const createError = () =>
            new InvalidArgumentError("Invalid content key", {
                displayMessage: errorDisplayMessage`Invalid content key. Try again with a string from \`element.key\`.`,
            });

        if (payload.length < 3) throw createError();

        let offset = 3;

        const versionResult = getVarInt(payloadView, offset);
        offset = versionResult.byteOffset;

        const posResult = getVarInt(payloadView, offset);
        offset = posResult.byteOffset;

        const nodeSizeResult = getVarInt(payloadView, offset);
        offset = nodeSizeResult.byteOffset;

        if (offset !== payload.length) throw createError();

        // Check the the entity hash in the key matches the expected entity hash. After
        // we've verified that the structure
        //
        // The first byte masks out the "inline" bit since it varies per key.
        if (
            (payloadView.getUint8(0) & 0b10111111) !== (this.#entityIdHash & 0b00111111) ||
            payloadView.getUint8(1) !== ((this.#entityIdHash >>> 8) & 0b11111111) ||
            payloadView.getUint8(2) !== ((this.#entityIdHash >>> 16) & 0b11111111)
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
            inlineContent: (payloadView.getUint8(0) & 0b01000000) !== 0,
        };
    }
}
