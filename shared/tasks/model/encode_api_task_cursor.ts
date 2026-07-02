import {InvalidArgumentError} from "~/shared/error/error.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {scrambleBytes, unscrambleBytes} from "~/shared/helpers/binary/scramble_bytes.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {decodeOrderKey, encodeOrderKey} from "~/shared/helpers/sort/encode_order_key.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {assertId, decodeId, encodeId, idByteLength} from "~/shared/id/id.js";
import {ApiTaskCursor} from "~/shared/id/types/api_task_cursor.js";
import {TaskId} from "~/shared/id/types/id_types.js";
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
export function encodeApiTaskCursor(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    cursor: TaskQuerySortCursor,
): ApiTaskCursor {
    assert(cursor.length === sorts.length + 1);

    const payload: Array<number> = [];

    for (let i = 0; i < sorts.length; i++) {
        writeTaskQuerySortCursorValue(sorts[i]!, cursor[i]!, payload);
    }

    const taskId = cursor[cursor.length - 1];
    assert(typeof taskId === "string");

    for (const byte of decodeId(assertId<TaskId>(taskId))) payload.push(byte);

    return encodeBase64(
        scrambleBytes(Uint8Array.from(payload), scrambleSeed),
        "Rfc4648Url",
    ) as ApiTaskCursor;
}

export function decodeApiTaskCursor(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    cursorString: ApiTaskCursor,
): TaskQuerySortCursor {
    const payload = unscrambleBytes(decodeBase64(cursorString, "Rfc4648Url"), scrambleSeed);

    let offset = 0;
    const cursor: Array<TaskQuerySortCursorValue | TaskId> = [];

    for (const sort of sorts) {
        const result = readTaskQuerySortCursorValue(sort, payload, offset);
        offset = result.offset;
        cursor.push(result.value);
    }

    if (offset + idByteLength !== payload.length)
        throw new InvalidArgumentError("Unexpected task cursor length");

    cursor.push(encodeId<TaskId>(payload, offset));

    return cursor as TaskQuerySortCursor;
}

function writeTaskQuerySortCursorValue(
    sort: TaskQueryNormalizedSort,
    value: TaskQuerySortCursorValue,
    bytes: Array<number>,
): void {
    const sortByte = getTaskQueryNormalizedSortByte(sort);
    assert(sortByte <= 0b00111111);

    bytes.push((sortByte << 1) | (value === null ? sortByteNullMask : 0));

    if (sort.type === "CollectionPosition") {
        let byteIndex = 0;
        for (const byte of decodeId(sort.collectionId)) {
            if (byteIndex >= collectionIdPrefixByteLength) break;
            bytes.push(byte);
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

            bytes.push(value);
            break;
        }
        case "Assignee":
        case "Creator":
        case "Assigner": {
            assert(typeof value === "string");

            const stringBytes = new TextEncoder().encode(value);
            writeVarint(stringBytes.length, bytes);
            for (const byte of stringBytes) bytes.push(byte);
            break;
        }
        case "DueDate": {
            assert(typeof value === "number");
            assert(Number.isSafeInteger(value));
            assert(value >= 0);

            writeVarint(value, bytes);
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

            writeUint64(serializeHybridLogicalTime(value as [number, number]), bytes);
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

            writeUint64(serializeHybridLogicalTime(value as [number, number]), bytes);

            const orderKeyBytes = encodeOrderKey(assertOrderKey(value[2]));
            writeVarint(orderKeyBytes.length, bytes);
            for (const byte of orderKeyBytes) bytes.push(byte);
            break;
        }
        default:
            throw exhaustive(sort);
    }
}

function readTaskQuerySortCursorValue(
    sort: TaskQueryNormalizedSort,
    bytes: Uint8Array,
    offset: number,
): {value: TaskQuerySortCursorValue; offset: number} {
    const headerByte = bytes[offset++];
    if (headerByte === undefined) throw new InvalidArgumentError("Task cursor missing header byte");
    if ((headerByte & sortByteFormatMask) !== 0)
        throw new InvalidArgumentError("Unexpected task cursor format bit");

    if (headerByte >> 1 !== getTaskQueryNormalizedSortByte(sort)) {
        throw new InvalidArgumentError("Task cursor doesn\u2019t match sorts");
    }

    if (sort.type === "CollectionPosition") {
        const expectedCollectionIdBytes = decodeId(sort.collectionId);
        if (offset + collectionIdPrefixByteLength > bytes.length) {
            throw new InvalidArgumentError("Task cursor doesn\u2019t match sorts");
        }

        for (let i = 0; i < collectionIdPrefixByteLength; i++) {
            if (bytes[offset + i] !== expectedCollectionIdBytes[i]) {
                throw new InvalidArgumentError("Task cursor doesn\u2019t match sorts");
            }
        }

        offset += collectionIdPrefixByteLength;
    }

    if ((headerByte & sortByteNullMask) !== 0) return {value: null, offset};

    switch (sort.type) {
        case "DisplayStatus":
        case "Priority":
        case "Layout": {
            const value = bytes[offset++];
            if (value === undefined || value === 0)
                throw new InvalidArgumentError("Expected task cursor byte value");

            return {value, offset};
        }
        case "Assignee":
        case "Creator":
        case "Assigner": {
            const stringByteLengthResult = readVarint(bytes, offset, bytes.length);
            if (stringByteLengthResult === null)
                throw new InvalidArgumentError("Expected task cursor string value length");
            offset = stringByteLengthResult.offset;

            if (offset + stringByteLengthResult.value > bytes.length)
                throw new InvalidArgumentError(
                    "Invalid task cursor string value, not enough bytes",
                );

            const value = new TextDecoder().decode(
                bytes.subarray(offset, offset + stringByteLengthResult.value),
            );

            return {value, offset: offset + stringByteLengthResult.value};
        }
        case "DueDate": {
            const result = readVarint(bytes, offset, bytes.length);
            if (result === null)
                throw new InvalidArgumentError("Invalid task cursor integer value");

            return {value: result.value, offset: result.offset};
        }
        case "CreatedTime":
        case "AssignedTime":
        case "ClosedTime":
        case "ActivatedTime": {
            const result = readUint64(bytes, offset);
            if (result === null)
                throw new InvalidArgumentError("Expected task cursor hybrid logical time value");

            const value = deserializeHybridLogicalTime(result.value);

            return {value, offset: result.offset};
        }
        case "ParentPosition":
        case "CollectionPosition":
        case "AssigneePosition": {
            const timeResult = readUint64(bytes, offset);
            if (timeResult === null)
                throw new InvalidArgumentError(
                    "Expected task cursor position order hybrid logical time value",
                );
            offset = timeResult.offset;

            const time = deserializeHybridLogicalTime(timeResult.value);

            const orderKeyByteLengthResult = readVarint(bytes, offset, bytes.length);
            if (orderKeyByteLengthResult === null)
                throw new InvalidArgumentError("Expected task cursor position order key length");
            offset = orderKeyByteLengthResult.offset;

            if (offset + orderKeyByteLengthResult.value > bytes.length)
                throw new InvalidArgumentError(
                    "Invalid task cursor position order key value, not enough bytes",
                );

            const orderKeyEndOffset = offset + orderKeyByteLengthResult.value;
            const orderKey = decodeOrderKey(bytes.subarray(offset, orderKeyEndOffset));

            return {
                value: [time[0], time[1], orderKey],
                offset: orderKeyEndOffset,
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

function writeUint64(value: bigint, bytes: Array<number>): void {
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
        bytes.push(Number((value >> shift) & 0xffn));
    }
}

function readUint64(bytes: Uint8Array, offset: number): {value: bigint; offset: number} | null {
    if (offset + 8 > bytes.length) return null;

    let value = 0n;
    for (let i = 0; i < 8; i++) {
        value = (value << 8n) | BigInt(bytes[offset + i]!);
    }

    return {value, offset: offset + 8};
}

function writeVarint(value: number, bytes: Array<number>): void {
    assert(Number.isSafeInteger(value));
    assert(value >= 0);

    let n = value;

    while (n >= 0x80) {
        bytes.push((n % 0x80) | 0x80);
        n = Math.floor(n / 0x80);
    }

    bytes.push(n);
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
