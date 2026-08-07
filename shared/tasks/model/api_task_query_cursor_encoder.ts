import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {DataBuilderView} from "~/shared/helpers/binary/data_builder_view.js";
import {scrambleBytes, unscrambleBytes} from "~/shared/helpers/binary/scramble_bytes.js";
import {getVarInt, pushVarInt} from "~/shared/helpers/binary/var_int.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {decodeOrderKey, encodeOrderKey} from "~/shared/helpers/sort/encode_order_key.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {assertId, decodeId, encodeId, idByteLength} from "~/shared/id/id.open_source.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    deserializeHybridLogicalTime,
    serializeHybridLogicalTime,
} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    TaskQuerySortCursorValue,
} from "~/shared/tasks/task_query_sort_cursor.js";

const sortByteFormatMask = 0b10000000;
const sortByteNullMask = 0b00000001;
const collectionIdPrefixByteLength = 3;
const scrambleSeed = 0x5441_534b; // "TASK" in ASCII

/**
 * Encodes a `TaskQuerySortCursor` to an opaque string we'll share over the API.
 */
export function encodeApiTaskQueryCursor(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    cursor: TaskQuerySortCursor,
): ApiTaskQueryCursor {
    assert(cursor.length === sorts.length + 1);

    const view = new DataBuilderView();

    for (let i = 0; i < sorts.length; i++) {
        writeTaskQuerySortCursorValue(sorts[i]!, cursor[i]!, view);
    }

    const taskId = cursor[cursor.length - 1];
    assert(typeof taskId === "string");

    view.pushUint8s(decodeId(assertId<TaskId>(taskId)));

    return encodeBase64(
        scrambleBytes(view.build(), scrambleSeed),
        "Rfc4648Url",
    ) as ApiTaskQueryCursor;
}

export function decodeApiTaskQueryCursor(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    cursorString: ApiTaskQueryCursor,
): TaskQuerySortCursor {
    const payload = unscrambleBytes(decodeBase64(cursorString, "Rfc4648Url"), scrambleSeed);
    const payloadView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

    let offset = 0;
    const cursor: Array<TaskQuerySortCursorValue | TaskId> = [];

    for (const sort of sorts) {
        const result = readTaskQuerySortCursorValue(sort, payloadView, payload, offset);
        offset = result.byteOffset;
        cursor.push(result.value);
    }

    if (offset + idByteLength !== payload.length)
        throw new InvalidArgumentError("Unexpected task query cursor length");

    cursor.push(encodeId<TaskId>(payload, offset));

    return cursor as TaskQuerySortCursor;
}

function writeTaskQuerySortCursorValue(
    sort: TaskQueryNormalizedSort,
    value: TaskQuerySortCursorValue,
    view: DataBuilderView,
): void {
    const sortByte = getTaskQueryNormalizedSortByte(sort);
    assert(sortByte <= 0b00111111);

    view.pushUint8((sortByte << 1) | (value === null ? sortByteNullMask : 0));

    if (sort.type === "CollectionPosition") {
        let byteIndex = 0;
        for (const byte of decodeId(sort.collectionId)) {
            if (byteIndex >= collectionIdPrefixByteLength) break;
            view.pushUint8(byte);
            byteIndex++;
        }
    }

    if (value === null) return;

    switch (sort.type) {
        case "DisplayStatus":
        case "Priority":
        case "Layout": {
            assert(typeof value === "number");
            assert(Number.isInteger(value));
            assert(0 < value && value <= 0xff);

            view.pushUint8(value);
            break;
        }
        case "Assignee":
        case "Creator":
        case "Assigner": {
            assert(typeof value === "string");

            const stringBytes = new TextEncoder().encode(value);
            pushVarInt(view, stringBytes.length);
            for (const byte of stringBytes) view.pushUint8(byte);
            break;
        }
        case "DueDate": {
            assert(typeof value === "number");
            assert(Number.isSafeInteger(value));
            assert(value >= 0);

            pushVarInt(view, value);
            break;
        }
        case "CreatedTime":
        case "AssignedTime":
        case "ClosedTime":
        case "ActivatedTime": {
            assert(Array.isArray(value));
            assert(value.length === 2);
            assert(typeof value[0] === "number");
            assert(typeof value[1] === "number");

            view.pushBigUint64(serializeHybridLogicalTime(value as [number, number]));
            break;
        }
        case "ParentPosition":
        case "CollectionPosition":
        case "AssigneePosition": {
            assert(Array.isArray(value));
            assert(value.length === 3);
            assert(typeof value[0] === "number");
            assert(typeof value[1] === "number");
            assert(typeof value[2] === "string");

            view.pushBigUint64(serializeHybridLogicalTime(value as [number, number]));

            const orderKeyBytes = encodeOrderKey(assertOrderKey(value[2]));
            pushVarInt(view, orderKeyBytes.length);
            view.pushUint8s(orderKeyBytes);
            break;
        }
        default:
            throw exhaustive(sort);
    }
}

function readTaskQuerySortCursorValue(
    sort: TaskQueryNormalizedSort,
    view: DataView,
    bytes: Uint8Array,
    byteOffset: number,
): {value: TaskQuerySortCursorValue; byteOffset: number} {
    if (byteOffset >= view.byteLength)
        throw new InvalidArgumentError("Task query cursor missing header byte");

    const headerByte = view.getUint8(byteOffset);
    byteOffset += 1;

    if ((headerByte & sortByteFormatMask) !== 0)
        throw new InvalidArgumentError("Unexpected task query cursor format bit");

    if (headerByte >> 1 !== getTaskQueryNormalizedSortByte(sort)) {
        throw new InvalidArgumentError("Task query cursor doesn\u2019t match sorts");
    }

    if (sort.type === "CollectionPosition") {
        const expectedCollectionIdBytes = decodeId(sort.collectionId);
        if (byteOffset + collectionIdPrefixByteLength > view.byteLength) {
            throw new InvalidArgumentError("Task query cursor doesn\u2019t match sorts");
        }

        for (let i = 0; i < collectionIdPrefixByteLength; i++) {
            if (view.getUint8(byteOffset + i) !== expectedCollectionIdBytes[i]) {
                throw new InvalidArgumentError("Task query cursor doesn\u2019t match sorts");
            }
        }

        byteOffset += collectionIdPrefixByteLength;
    }

    if ((headerByte & sortByteNullMask) !== 0) return {value: null, byteOffset};

    switch (sort.type) {
        case "DisplayStatus":
        case "Priority":
        case "Layout": {
            if (byteOffset >= view.byteLength)
                throw new InvalidArgumentError("Expected task query cursor byte value");

            const value = view.getUint8(byteOffset);
            byteOffset += 1;

            if (value === 0)
                throw new InvalidArgumentError("Expected task query cursor byte value");

            return {value, byteOffset};
        }
        case "Assignee":
        case "Creator":
        case "Assigner": {
            const stringByteLengthResult = getVarInt(view, byteOffset);
            byteOffset = stringByteLengthResult.byteOffset;

            if (byteOffset + stringByteLengthResult.value > view.byteLength)
                throw new InvalidArgumentError(
                    "Invalid task query cursor string value, not enough bytes",
                );

            const value = new TextDecoder().decode(
                bytes.subarray(byteOffset, byteOffset + stringByteLengthResult.value),
            );

            return {value, byteOffset: byteOffset + stringByteLengthResult.value};
        }
        case "DueDate": {
            const result = getVarInt(view, byteOffset);
            return {value: result.value, byteOffset: result.byteOffset};
        }
        case "CreatedTime":
        case "AssignedTime":
        case "ClosedTime":
        case "ActivatedTime": {
            if (byteOffset + 8 > view.byteLength)
                throw new InvalidArgumentError(
                    "Expected task query cursor hybrid logical time value",
                );

            const value = deserializeHybridLogicalTime(view.getBigUint64(byteOffset));

            return {value, byteOffset: byteOffset + 8};
        }
        case "ParentPosition":
        case "CollectionPosition":
        case "AssigneePosition": {
            if (byteOffset + 8 > view.byteLength)
                throw new InvalidArgumentError(
                    "Expected task query cursor position order hybrid logical time value",
                );

            const time = deserializeHybridLogicalTime(view.getBigUint64(byteOffset));
            byteOffset += 8;

            const orderKeyByteLengthResult = getVarInt(view, byteOffset);
            byteOffset = orderKeyByteLengthResult.byteOffset;

            if (byteOffset + orderKeyByteLengthResult.value > view.byteLength)
                throw new InvalidArgumentError(
                    "Invalid task query cursor position order key value, not enough bytes",
                );

            const orderKeyEndOffset = byteOffset + orderKeyByteLengthResult.value;
            const orderKey = decodeOrderKey(bytes.subarray(byteOffset, orderKeyEndOffset));

            return {
                value: [time[0], time[1], orderKey],
                byteOffset: orderKeyEndOffset,
            };
        }
        default:
            throw exhaustive(sort);
    }
}

const taskQueryNormalizedSortTypeIndexes: Record<TaskQueryNormalizedSort["type"], number> = {
    DisplayStatus: 0,
    Priority: 1,
    Layout: 2,
    Assignee: 3,
    Creator: 4,
    Assigner: 5,
    DueDate: 6,
    CreatedTime: 7,
    AssignedTime: 8,
    ClosedTime: 9,
    ActivatedTime: 10,
    ParentPosition: 11,
    CollectionPosition: 12,
    AssigneePosition: 13,
};

function getTaskQueryNormalizedSortByte(sort: TaskQueryNormalizedSort): number {
    const typeIndex = taskQueryNormalizedSortTypeIndexes[sort.type];
    const directionBit = sort.direction === "Ascending" ? 0 : 1;
    const missingBit = sort.missing === "First" ? 0 : 1;
    return typeIndex * 4 + directionBit * 2 + missingBit;
}
