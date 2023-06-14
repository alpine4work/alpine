import {InvalidArgumentError} from "~/shared/error/error";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

export type TaskQuerySort =
    | TaskQueryStatusSort
    | TaskQueryAssigneeSort
    | TaskQueryCreatorSort
    | TaskQueryAssignerSort
    | TaskQueryDueDateSort
    | TaskQueryCreatedDateSort
    | TaskQueryAssignedDateSort
    | TaskQueryClosedDateSort
    | TaskQueryActivatedDateSort;

type TaskQueryStatusSort = {
    readonly type: "Status";
    readonly direction: "Ascending" | "Descending";
};

type TaskQueryAssigneeSort = {
    readonly type: "Assignee";
    readonly noAccountSide: "Start" | "End";
};

type TaskQueryCreatorSort = {
    readonly type: "Creator";
};

type TaskQueryAssignerSort = {
    readonly type: "Assigner";
    readonly noAccountSide: "Start" | "End";
};

type TaskQueryDueDateSort = {
    readonly type: "DueDate";
    readonly direction: "Ascending" | "Descending";
};

type TaskQueryCreatedDateSort = {
    readonly type: "CreatedDate";
    readonly direction: "Ascending" | "Descending";
};

type TaskQueryAssignedDateSort = {
    readonly type: "AssignedDate";
    readonly direction: "Ascending" | "Descending";
};

type TaskQueryClosedDateSort = {
    readonly type: "ClosedDate";
    readonly direction: "Ascending" | "Descending";
};

type TaskQueryActivatedDateSort = {
    readonly type: "ActivatedDate";
    readonly direction: "Ascending" | "Descending";
};

export function serializeTaskQuerySortsSearchParam(sorts: ReadonlyArray<TaskQuerySort>): string {
    const buffer = serializeTaskQuerySorts(sorts);
    return encodeBase64(new Uint8Array(buffer), "Rfc4648Url");
}

export function deserializeTaskQuerySortsSearchParam(sorts: string): ReadonlyArray<TaskQuerySort> {
    const bytes = decodeBase64(sorts, "Rfc4648Url");
    return deserializeTaskQuerySorts(bytes.buffer);
}

/**
 * Serialize a list of task query sorts to binary data. This binary data can
 * then be encoded in the URL. We use a binary format to make sure sorts in
 * the URL are as small as possible and opaque to end users.
 *
 * We may introduce a plain text format for sorts in the future so that end
 * users can generate view URLs.
 */
export function serializeTaskQuerySorts(sorts: ReadonlyArray<TaskQuerySort>): ArrayBuffer {
    // Make sure the sort length can fit in 7 bits. We always set the first bit
    // to 1 as a version marker. If we introduce a new binary format in the future
    // the first bit will be 0 which will tell our deserializer to use a different
    // format.
    if (sorts.length > 2 ** 7 - 1) throw new InvalidArgumentError("Too many sorts");

    const sortByteLengths = sorts.map(sort => getTaskQuerySortByteLength(sort));

    const buffer = new ArrayBuffer(
        1 + sortByteLengths.reduce((byteLength, sortByteLength) => byteLength + sortByteLength, 0),
    );

    new DataView(buffer).setUint8(0, 0b10000000 | sorts.length);

    let byteOffset = 1;

    for (let i = 0; i < sorts.length; i++) {
        const sort = sorts[i]!;
        const sortByteLength = sortByteLengths[i]!;

        serializeTaskQuerySort(sort, new DataView(buffer, byteOffset, sortByteLength));

        byteOffset += sortByteLength;
    }

    return buffer;
}

/**
 * Deserialize a list of task query sorts from binary data.
 */
export function deserializeTaskQuerySorts(buffer: ArrayBuffer): ReadonlyArray<TaskQuerySort> {
    const sortsLengthByte = new DataView(buffer).getUint8(0);

    if (!(sortsLengthByte & 0b10000000))
        throw new InvalidArgumentError("Unrecognized sorts binary encoding");

    const sortsLength = sortsLengthByte & 0b01111111;
    const sorts: Array<TaskQuerySort> = [];
    let byteOffset = 1;

    for (let i = 0; i < sortsLength; i++) {
        const {sort, byteLength} = deserializeTaskQuerySort(new DataView(buffer, byteOffset));
        assert(getTaskQuerySortByteLength(sort) === byteLength);
        sorts.push(sort);
        byteOffset += byteLength;
    }

    return sorts;
}

function getTaskQuerySortByteLength(sort: TaskQuerySort): number {
    switch (sort.type) {
        case "Status":
            return 1;
        case "Assignee":
            return 1;
        case "Creator":
            return 1;
        case "Assigner":
            return 1;
        case "DueDate":
            return 1;
        case "CreatedDate":
            return 1;
        case "AssignedDate":
            return 1;
        case "ClosedDate":
            return 1;
        case "ActivatedDate":
            return 1;
        default:
            throw exhaustive(sort);
    }
}

function serializeTaskQuerySort(sort: TaskQuerySort, view: DataView): void {
    switch (sort.type) {
        case "Status": {
            if (sort.direction === "Ascending") {
                view.setUint8(0, 1);
            } else {
                view.setUint8(0, 2);
            }
            break;
        }
        case "Assignee": {
            if (sort.noAccountSide === "Start") {
                view.setUint8(0, 3);
            } else {
                view.setUint8(0, 4);
            }
            break;
        }
        case "Creator": {
            view.setUint8(0, 5);
            break;
        }
        case "Assigner": {
            if (sort.noAccountSide === "Start") {
                view.setUint8(0, 6);
            } else {
                view.setUint8(0, 7);
            }
            break;
        }
        case "DueDate": {
            if (sort.direction === "Ascending") {
                view.setUint8(0, 8);
            } else {
                view.setUint8(0, 9);
            }
            break;
        }
        case "CreatedDate": {
            if (sort.direction === "Ascending") {
                view.setUint8(0, 10);
            } else {
                view.setUint8(0, 11);
            }
            break;
        }
        case "AssignedDate": {
            if (sort.direction === "Ascending") {
                view.setUint8(0, 12);
            } else {
                view.setUint8(0, 13);
            }
            break;
        }
        case "ClosedDate": {
            if (sort.direction === "Ascending") {
                view.setUint8(0, 14);
            } else {
                view.setUint8(0, 15);
            }
            break;
        }
        case "ActivatedDate": {
            if (sort.direction === "Ascending") {
                view.setUint8(0, 16);
            } else {
                view.setUint8(0, 17);
            }
            break;
        }
        default:
            throw exhaustive(sort);
    }
}

function deserializeTaskQuerySort(view: DataView): {
    sort: TaskQuerySort;
    byteLength: number;
} {
    const typeByte = view.getUint8(0);

    switch (typeByte) {
        case 1:
            return {sort: {type: "Status", direction: "Ascending"}, byteLength: 1};
        case 2:
            return {sort: {type: "Status", direction: "Descending"}, byteLength: 1};
        case 3:
            return {sort: {type: "Assignee", noAccountSide: "Start"}, byteLength: 1};
        case 4:
            return {sort: {type: "Assignee", noAccountSide: "End"}, byteLength: 1};
        case 5:
            return {sort: {type: "Creator"}, byteLength: 1};
        case 6:
            return {sort: {type: "Assigner", noAccountSide: "Start"}, byteLength: 1};
        case 7:
            return {sort: {type: "Assigner", noAccountSide: "End"}, byteLength: 1};
        case 8:
            return {sort: {type: "DueDate", direction: "Ascending"}, byteLength: 1};
        case 9:
            return {sort: {type: "DueDate", direction: "Descending"}, byteLength: 1};
        case 10:
            return {sort: {type: "CreatedDate", direction: "Ascending"}, byteLength: 1};
        case 11:
            return {sort: {type: "CreatedDate", direction: "Descending"}, byteLength: 1};
        case 12:
            return {sort: {type: "AssignedDate", direction: "Ascending"}, byteLength: 1};
        case 13:
            return {sort: {type: "AssignedDate", direction: "Descending"}, byteLength: 1};
        case 14:
            return {sort: {type: "ClosedDate", direction: "Ascending"}, byteLength: 1};
        case 15:
            return {sort: {type: "ClosedDate", direction: "Descending"}, byteLength: 1};
        case 16:
            return {sort: {type: "ActivatedDate", direction: "Ascending"}, byteLength: 1};
        case 17:
            return {sort: {type: "ActivatedDate", direction: "Descending"}, byteLength: 1};
        default:
            throw new InvalidArgumentError(`Unrecognized sort type ${typeByte}`);
    }
}
