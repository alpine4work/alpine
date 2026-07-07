import murmurhash from "murmurhash";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {DataBuilderView} from "~/shared/helpers/binary/data_builder_view.js";
import {scrambleBytes, unscrambleBytes} from "~/shared/helpers/binary/scramble_bytes.js";
import {getVarInt, pushVarInt} from "~/shared/helpers/binary/var_int.js";
import {decodeOrderKey, encodeOrderKey} from "~/shared/helpers/sort/encode_order_key.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {assertId, decodeId, encodeId, idByteLength} from "~/shared/id/id.js";
import {ApiTaskCollectionCursor} from "~/shared/id/types/api_task_cursors.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {
    deserializeHybridLogicalTime,
    serializeHybridLogicalTime,
} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";

/**
 * Encode `ApiTaskCollectionCursor`s.
 *
 * This is a class for performance. So we only need to hash the `collectionId`
 * once.
 */
export class ApiTaskCollectionCursorEncoder {
    readonly #collectionIdHash: number;
    readonly #basePayload: Uint8Array;

    constructor(collectionId: TaskCollectionId) {
        const collectionIdHash = murmurhash.v3(collectionId);

        const basePayload = new DataBuilderView();

        // Use 23 bits of the collection hash as a way to detect when you're using a key
        // for the wrong collection. Collision chance is 1 / 8,388,608 which is fine since
        // it's not a strong invariant that we catch every misused cursor. It's mostly to
        // improve the developer experience and catch accidental mistakes.
        //
        // We always use 0 as the first bit as versioning information. So if we want to
        // change the payload format we can switch to 1 and that's a signal to our decoder
        // that we're using a new format. However, since the version is inside the
        // scrambled payload that kind locks the scramble strategy in place since the
        // decoder will always need to unscramble.
        basePayload.pushUint8(collectionIdHash & 0b01111111);
        basePayload.pushUint8((collectionIdHash >>> 8) & 0b11111111);
        basePayload.pushUint8((collectionIdHash >>> 16) & 0b11111111);

        this.#collectionIdHash = collectionIdHash;
        this.#basePayload = basePayload.build();
    }

    encode({
        taskId,
        collectionPosition,
    }: {
        taskId: TaskId;
        collectionPosition: TaskPosition;
    }): ApiTaskCollectionCursor {
        const view = new DataBuilderView(this.#basePayload);

        view.pushBigUint64(serializeHybridLogicalTime(collectionPosition.orderTime));

        const orderKeyBytes = encodeOrderKey(assertOrderKey(collectionPosition.orderKey));
        pushVarInt(view, orderKeyBytes.length);
        view.pushUint8s(orderKeyBytes);

        view.pushUint8s(decodeId(assertId<TaskId>(taskId)));

        return encodeBase64(
            scrambleBytes(view.build(), this.#collectionIdHash),
            "Rfc4648Url",
        ) as ApiTaskCollectionCursor;
    }
}

/**
 * Decodes `ApiTaskCollectionCursor`s.
 *
 * This is a class for performance. So we only need to hash the `collectionId`
 * once.
 */
export class ApiTaskCollectionCursorDecoder {
    readonly #collectionIdHash: number;

    constructor(collectionId: TaskCollectionId) {
        this.#collectionIdHash = murmurhash.v3(collectionId);
    }

    decode(cursor: ApiTaskCollectionCursor): {
        taskId: TaskId;
        collectionPosition: TaskPosition;
    } {
        const bytes = decodeBase64(cursor, "Rfc4648Url");
        const payload = unscrambleBytes(bytes, this.#collectionIdHash);
        const payloadView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

        const createError = () => new InvalidArgumentError("Invalid task collection cursor");

        if (payload.length < 3) throw createError();

        if (
            payloadView.getUint8(0) !== (this.#collectionIdHash & 0b01111111) ||
            payloadView.getUint8(1) !== ((this.#collectionIdHash >>> 8) & 0b11111111) ||
            payloadView.getUint8(2) !== ((this.#collectionIdHash >>> 16) & 0b11111111)
        ) {
            throw new InvalidArgumentError("Task collection cursor doesn\u2019t match collection");
        }

        let byteOffset = 3;

        if (byteOffset + 8 > payloadView.byteLength) throw createError();
        const orderTime = deserializeHybridLogicalTime(payloadView.getBigUint64(byteOffset));
        byteOffset += 8;

        const orderKeyByteLengthResult = getVarInt(payloadView, byteOffset);
        byteOffset = orderKeyByteLengthResult.byteOffset;

        if (byteOffset + orderKeyByteLengthResult.value > payloadView.byteLength) {
            throw createError();
        }

        const orderKeyEndOffset = byteOffset + orderKeyByteLengthResult.value;
        const orderKey = decodeOrderKey(payload.subarray(byteOffset, orderKeyEndOffset));
        byteOffset = orderKeyEndOffset;

        if (byteOffset + idByteLength !== payload.length) throw createError();

        return {
            taskId: encodeId<TaskId>(payload, byteOffset),
            collectionPosition: {orderTime, orderKey},
        };
    }
}
