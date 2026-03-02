import {CalendarDate, GregorianCalendar, toCalendar} from "@internationalized/date";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {decodeIdInto, encodeId, idByteLength} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

/**
 * A filter that determines whether a task is visible in a task query. The UI
 * allows users to edit filters which are represented by this type.
 *
 * These filters are redundant, unoptimized, contain dynamic placeholders, and
 * are hard to work with when actually implementing filter evaluation. So
 * before any meaningful work with filters we normalize a list of filters to
 * `TaskQueryNormalizedFilters`.
 *
 * Normalized filters also include some internal filters we don't expose to
 * the UI.
 */
export type TaskQueryFilter =
    | TaskQueryDisplayStatusFilter
    | TaskQueryCollectionsFilter
    | TaskQueryPriorityFilter
    | TaskQueryLayoutFilter
    | TaskQueryTitleFilter
    | TaskQueryAssigneeFilter
    | TaskQueryCreatorFilter
    | TaskQueryAssignerFilter
    | TaskQueryDueDateFilter
    | TaskQueryCreatedDateFilter
    | TaskQueryAssignedDateFilter
    | TaskQueryClosedDateFilter
    | TaskQueryActivatedDateFilter;

export function serializeTaskQueryFiltersSearchParam(
    filters: ReadonlyArray<TaskQueryFilter>,
): string {
    const buffer = serializeTaskQueryFilters(filters);
    return encodeBase64(new Uint8Array(buffer), "Rfc4648Url");
}

export function deserializeTaskQueryFiltersSearchParam(
    filters: string,
): ReadonlyArray<TaskQueryFilter> {
    const bytes = decodeBase64(filters, "Rfc4648Url");
    return deserializeTaskQueryFilters(bytes.buffer);
}

/**
 * Serialize a list of task query filters to binary data. This binary data can
 * then be encoded in the URL. We use a binary format to make sure filters in
 * the URL are as small as possible and opaque to end users.
 *
 * We may introduce a plain text format for filters in the future so that end
 * users can generate view URLs.
 */
export function serializeTaskQueryFilters(filters: ReadonlyArray<TaskQueryFilter>): ArrayBuffer {
    // Make sure the filter length can fit in 7 bits. We always set the first bit
    // to 1 as a version marker. If we introduce a new binary format in the future
    // the first bit will be 0 which will tell our deserializer to use a different
    // format.
    if (filters.length > 2 ** 7 - 1) throw new InvalidArgumentError("Too many filters");

    const filterByteLengths = filters.map(filter => getTaskQueryFilterByteLength(filter));

    const buffer = new ArrayBuffer(
        1 +
            filterByteLengths.reduce(
                (byteLength, filterByteLength) => byteLength + filterByteLength,
                0,
            ),
    );

    new DataView(buffer).setUint8(0, 0b10000000 | filters.length);

    let byteOffset = 1;

    for (let i = 0; i < filters.length; i++) {
        const filter = filters[i]!;
        const filterByteLength = filterByteLengths[i]!;

        serializeTaskQueryFilter(filter, new DataView(buffer, byteOffset, filterByteLength));

        byteOffset += filterByteLength;
    }

    return buffer;
}

/**
 * Deserialize a list of task query filters from binary data.
 */
export function deserializeTaskQueryFilters(buffer: ArrayBuffer): ReadonlyArray<TaskQueryFilter> {
    const filtersLengthByte = new DataView(buffer).getUint8(0);

    if (!(filtersLengthByte & 0b10000000))
        throw new InvalidArgumentError("Unrecognized filters binary encoding");

    const filtersLength = filtersLengthByte & 0b01111111;
    const filters: Array<TaskQueryFilter> = [];
    let byteOffset = 1;

    for (let i = 0; i < filtersLength; i++) {
        const {filter, byteLength} = deserializeTaskQueryFilter(new DataView(buffer, byteOffset));
        assert(getTaskQueryFilterByteLength(filter) === byteLength);
        filters.push(filter);
        byteOffset += byteLength;
    }

    return filters;
}

function getTaskQueryFilterByteLength(filter: TaskQueryFilter): number {
    return 1 + getTaskQueryFilterWithoutTypeByteLength(filter);
}

function serializeTaskQueryFilter(filter: TaskQueryFilter, view: DataView): void {
    let typeId: number;
    switch (filter.type) {
        case "DisplayStatus":
            typeId = 1;
            break;
        case "Collections":
            typeId = 2;
            break;
        case "Priority":
            typeId = 3;
            break;
        case "Assignee":
            typeId = 4;
            break;
        case "Creator":
            typeId = 5;
            break;
        case "Assigner":
            typeId = 6;
            break;
        case "DueDate":
            typeId = 7;
            break;
        case "CreatedDate":
            typeId = 8;
            break;
        case "AssignedDate":
            typeId = 9;
            break;
        case "ClosedDate":
            typeId = 10;
            break;
        case "ActivatedDate":
            typeId = 11;
            break;
        case "Title":
            typeId = 12;
            break;
        case "Layout":
            typeId = 13;
            break;
        default:
            throw exhaustive(filter);
    }

    // By convention, we reserve the 0 `typeId` for `null`.
    assert(typeId !== 0);
    assert(typeId <= 2 ** 8 - 1);

    view.setUint8(0, typeId);

    serializeTaskQueryFilterWithoutType(
        filter,
        new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
    );
}

function deserializeTaskQueryFilter(view: DataView): {
    filter: TaskQueryFilter;
    byteLength: number;
} {
    const {filter, byteLength} = deserializeTaskQueryFilterWithoutIncrementingByteLength(view);
    return {filter, byteLength: byteLength + 1};
}

function deserializeTaskQueryFilterWithoutIncrementingByteLength(viewWithType: DataView): {
    filter: TaskQueryFilter;
    byteLength: number;
} {
    const typeId = viewWithType.getUint8(0);

    const view = new DataView(
        viewWithType.buffer,
        viewWithType.byteOffset + 1,
        viewWithType.byteLength - 1,
    );

    switch (typeId) {
        case 1:
            return deserializeTaskQueryDisplayStatusFilter(view);
        case 2:
            return deserializeTaskQueryCollectionsFilter(view);
        case 3:
            return deserializeTaskQueryPriorityFilter(view);
        case 4:
            return deserializeTaskQueryAssigneeFilter(view);
        case 5:
            return deserializeTaskQueryCreatorFilter(view);
        case 6:
            return deserializeTaskQueryAssignerFilter(view);
        case 7:
            return deserializeTaskQueryDueDateFilter(view);
        case 8:
            return deserializeTaskQueryCreatedDateFilter(view);
        case 9:
            return deserializeTaskQueryAssignedDateFilter(view);
        case 10:
            return deserializeTaskQueryClosedDateFilter(view);
        case 11:
            return deserializeTaskQueryActivatedDateFilter(view);
        case 12:
            return deserializeTaskQueryTitleFilter(view);
        case 13:
            return deserializeTaskQueryLayoutFilter(view);
        default:
            throw new InvalidArgumentError(`Unrecognized filter type ${typeId}`);
    }
}

function getTaskQueryFilterWithoutTypeByteLength(filter: TaskQueryFilter) {
    switch (filter.type) {
        case "DisplayStatus":
            return getTaskQueryDisplayStatusFilterByteLength(filter);
        case "Collections":
            return getTaskQueryCollectionsFilterByteLength(filter);
        case "Priority":
            return getTaskQueryPriorityFilterByteLength(filter);
        case "Assignee":
            return getTaskQueryAssigneeFilterByteLength(filter);
        case "Creator":
            return getTaskQueryCreatorFilterByteLength(filter);
        case "Assigner":
            return getTaskQueryAssignerFilterByteLength(filter);
        case "DueDate":
            return getTaskQueryDueDateFilterByteLength(filter);
        case "CreatedDate":
            return getTaskQueryCreatedDateFilterByteLength(filter);
        case "AssignedDate":
            return getTaskQueryAssignedDateFilterByteLength(filter);
        case "ClosedDate":
            return getTaskQueryClosedDateFilterByteLength(filter);
        case "ActivatedDate":
            return getTaskQueryActivatedDateFilterByteLength(filter);
        case "Title":
            return getTaskQueryTitleFilterByteLength(filter);
        case "Layout":
            return getTaskQueryLayoutFilterByteLength(filter);
        default:
            throw exhaustive(filter);
    }
}

function serializeTaskQueryFilterWithoutType(filter: TaskQueryFilter, view: DataView) {
    switch (filter.type) {
        case "DisplayStatus":
            return serializeTaskQueryDisplayStatusFilter(filter, view);
        case "Collections":
            return serializeTaskQueryCollectionsFilter(filter, view);
        case "Priority":
            return serializeTaskQueryPriorityFilter(filter, view);
        case "Assignee":
            return serializeTaskQueryAssigneeFilter(filter, view);
        case "Creator":
            return serializeTaskQueryCreatorFilter(filter, view);
        case "Assigner":
            return serializeTaskQueryAssignerFilter(filter, view);
        case "DueDate":
            return serializeTaskQueryDueDateFilter(filter, view);
        case "CreatedDate":
            return serializeTaskQueryCreatedDateFilter(filter, view);
        case "AssignedDate":
            return serializeTaskQueryAssignedDateFilter(filter, view);
        case "ClosedDate":
            return serializeTaskQueryClosedDateFilter(filter, view);
        case "ActivatedDate":
            return serializeTaskQueryActivatedDateFilter(filter, view);
        case "Title":
            return serializeTaskQueryTitleFilter(filter, view);
        case "Layout":
            return serializeTaskQueryLayoutFilter(filter, view);
        default:
            throw exhaustive(filter);
    }
}

export type TaskQueryDisplayStatusFilter = {
    readonly type: "DisplayStatus";
    readonly operation:
        | {
              readonly type: "OneOf";
              readonly displayStatuses: ReadonlySet<TaskDisplayStatus>;
          }
        | {
              readonly type: "NoneOf";
              readonly displayStatuses: ReadonlySet<TaskDisplayStatus>;
          };
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getTaskQueryDisplayStatusFilterByteLength(filter: TaskQueryDisplayStatusFilter) {
    return 1;
}

function serializeTaskQueryDisplayStatusFilter(
    filter: TaskQueryDisplayStatusFilter,
    view: DataView,
) {
    const byte =
        // Operation type is stored in the first 4 bits
        ((filter.operation.type === "OneOf" ? 1 : 2) << 4) |
        // Statuses are stored in the last 4 bits as a bitset
        (filter.operation.displayStatuses.has("OpenInactive") ? 0b00001000 : 0b00000000) |
        (filter.operation.displayStatuses.has("OpenActive") ? 0b00000100 : 0b00000000) |
        (filter.operation.displayStatuses.has("Closed") ? 0b00000010 : 0b00000000);

    view.setUint8(0, byte);
}

function deserializeTaskQueryDisplayStatusFilter(view: DataView): {
    filter: TaskQueryDisplayStatusFilter;
    byteLength: number;
} {
    const byte = view.getUint8(0);

    const typeBits = byte >> 4;
    let type: "OneOf" | "NoneOf";
    switch (typeBits) {
        case 1:
            type = "OneOf";
            break;
        case 2:
            type = "NoneOf";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeBits}`);
    }

    const statuses = new Set<TaskDisplayStatus>();

    if (byte & 0b00001000) statuses.add("OpenInactive");
    if (byte & 0b00000100) statuses.add("OpenActive");
    if (byte & 0b00000010) statuses.add("Closed");

    return {
        filter: {type: "DisplayStatus", operation: {type, displayStatuses: statuses}},
        byteLength: 1,
    };
}

export type TaskQueryCollectionsFilter = {
    readonly type: "Collections";
    readonly operation:
        | {
              readonly type: "IncludesOneOf";
              readonly collectionIds: ReadonlySet<TaskCollectionId>;
          }
        | {
              readonly type: "IncludesAllOf";
              readonly collectionIds: ReadonlySet<TaskCollectionId>;
          }
        | {
              readonly type: "ExcludesAllOf";
              readonly collectionIds: ReadonlySet<TaskCollectionId>;
          }
        | {
              readonly type: "IsEmpty";
          };
};

function getTaskQueryCollectionsFilterByteLength(filter: TaskQueryCollectionsFilter) {
    switch (filter.operation.type) {
        case "IncludesOneOf":
        case "IncludesAllOf":
        case "ExcludesAllOf":
            return 1 + filter.operation.collectionIds.size * idByteLength;
        case "IsEmpty":
            return 1;
        default:
            throw exhaustive(filter.operation);
    }
}

function serializeTaskQueryCollectionsFilter(filter: TaskQueryCollectionsFilter, view: DataView) {
    if (filter.operation.type === "IsEmpty") {
        view.setUint8(0, 0);
        return;
    }

    // We use the first two bits of our `collectionIds` length byte to encode the
    // operation type. We reserve 0 for null.
    if (filter.operation.collectionIds.size > 2 ** 6 - 1)
        throw new InvalidArgumentError("Too many collections");

    const typeAndCollectionIdsSizeByte =
        ((filter.operation.type === "IncludesOneOf"
            ? 1
            : filter.operation.type === "IncludesAllOf"
              ? 2
              : 3) <<
            6) |
        (filter.operation.collectionIds.size & 0b00111111);

    view.setUint8(0, typeAndCollectionIdsSizeByte);

    let byteOffset = 1;

    for (const collectionId of filter.operation.collectionIds) {
        decodeIdInto(
            collectionId,
            new Uint8Array(view.buffer, view.byteOffset + byteOffset, idByteLength),
        );

        byteOffset += idByteLength;
    }
}

function deserializeTaskQueryCollectionsFilter(view: DataView): {
    filter: TaskQueryCollectionsFilter;
    byteLength: number;
} {
    const typeAndCollectionIdsSizeByte = view.getUint8(0);

    const typeBits = typeAndCollectionIdsSizeByte >> 6;
    const collectionIdsSize = typeAndCollectionIdsSizeByte & 0b00111111;

    let type: "IncludesOneOf" | "IncludesAllOf" | "ExcludesAllOf";
    switch (typeBits) {
        case 0: {
            if (collectionIdsSize !== 0)
                throw new InvalidArgumentError("Unexpected non-zero size in operation type");

            return {
                filter: {
                    type: "Collections",
                    operation: {type: "IsEmpty"},
                },
                byteLength: 1,
            };
        }
        case 1:
            type = "IncludesOneOf";
            break;
        case 2:
            type = "IncludesAllOf";
            break;
        case 3:
            type = "ExcludesAllOf";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeBits}`);
    }

    const collectionIds = new Set<TaskCollectionId>();
    let byteOffset = 1;

    for (let i = 0; i < collectionIdsSize; i++) {
        collectionIds.add(
            encodeId(new Uint8Array(view.buffer, view.byteOffset + byteOffset, idByteLength)),
        );

        byteOffset += idByteLength;
    }

    return {
        filter: {type: "Collections", operation: {type, collectionIds}},
        byteLength: byteOffset,
    };
}

export type TaskQueryPriorityFilter = {
    readonly type: "Priority";
    readonly operation:
        | {
              readonly type: "OneOf";
              readonly priorities: ReadonlySet<TaskPriority | null>;
          }
        | {
              readonly type: "NoneOf";
              readonly priorities: ReadonlySet<TaskPriority | null>;
          };
};

export type TaskQueryLayoutFilter = {
    readonly type: "Layout";
    readonly operation:
        | {
              readonly type: "OneOf";
              // NOTE(calebmer): Eventually we should evolve this to `ReadonlySet<TaskLayout | null>`
              // but right now our UI only supports filtering "is project" and "is not project". We
              // don't want the data model to support filters our UI won't render.
              readonly layouts: readonly [TaskLayout];
          }
        | {
              readonly type: "NoneOf";
              // NOTE(calebmer): Eventually we should evolve this to `ReadonlySet<TaskLayout | null>`
              // but right now our UI only supports filtering "is project" and "is not project". We
              // don't want the data model to support filters our UI won't render.
              readonly layouts: readonly [TaskLayout];
          };
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getTaskQueryPriorityFilterByteLength(filter: TaskQueryPriorityFilter) {
    return 1;
}

function serializeTaskQueryPriorityFilter(filter: TaskQueryPriorityFilter, view: DataView) {
    const byte =
        // Operation type is stored in the first 3 bits
        ((filter.operation.type === "OneOf" ? 1 : 2) << 5) |
        // Statuses are stored in the last 5 bits as a bitset
        (filter.operation.priorities.has(null) ? 0b00000001 : 0b00000000) |
        (filter.operation.priorities.has("Low") ? 0b00000010 : 0b00000000) |
        (filter.operation.priorities.has("Medium") ? 0b00000100 : 0b00000000) |
        (filter.operation.priorities.has("High") ? 0b00001000 : 0b00000000) |
        (filter.operation.priorities.has("Urgent") ? 0b00010000 : 0b00000000);

    view.setUint8(0, byte);
}

function deserializeTaskQueryPriorityFilter(view: DataView): {
    filter: TaskQueryPriorityFilter;
    byteLength: number;
} {
    const byte = view.getUint8(0);

    const typeBits = byte >> 5;
    let type: "OneOf" | "NoneOf";
    switch (typeBits) {
        case 1:
            type = "OneOf";
            break;
        case 2:
            type = "NoneOf";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeBits}`);
    }

    const priorities = new Set<TaskPriority | null>();

    if (byte & 0b00000001) priorities.add(null);
    if (byte & 0b00000010) priorities.add("Low");
    if (byte & 0b00000100) priorities.add("Medium");
    if (byte & 0b00001000) priorities.add("High");
    if (byte & 0b00010000) priorities.add("Urgent");

    return {
        filter: {type: "Priority", operation: {type, priorities}},
        byteLength: 1,
    };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getTaskQueryLayoutFilterByteLength(filter: TaskQueryLayoutFilter) {
    return 1;
}

function serializeTaskQueryLayoutFilter(filter: TaskQueryLayoutFilter, view: DataView) {
    // NOTE(calebmer): Eventually we should evolve this to `ReadonlySet<TaskLayout | null>`
    // but right now our UI only supports filtering "is project" and "is not project". We
    // don't want the data model to support filters our UI won't render.
    const layouts = cast<ReadonlyArray<TaskLayout | null>>(filter.operation.layouts);

    const byte =
        // Operation type is stored in the first 3 bits.
        ((filter.operation.type === "OneOf" ? 1 : 2) << 5) |
        // Layouts are stored in the last 2 bits as a bitset.
        (layouts.includes(null) ? 0b00000001 : 0b00000000) |
        (layouts.includes("Project") ? 0b00000010 : 0b00000000);

    view.setUint8(0, byte);
}

function deserializeTaskQueryLayoutFilter(view: DataView): {
    filter: TaskQueryLayoutFilter;
    byteLength: number;
} {
    const byte = view.getUint8(0);

    const typeBits = byte >> 5;
    let type: "OneOf" | "NoneOf";
    switch (typeBits) {
        case 1:
            type = "OneOf";
            break;
        case 2:
            type = "NoneOf";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeBits}`);
    }

    const layouts = new Set<TaskLayout | null>();

    if (byte & 0b00000001) layouts.add(null);
    if (byte & 0b00000010) layouts.add("Project");

    if (!isDeepEqual(Array.from(layouts), ["Project"])) {
        throw new InvalidArgumentError("`Project` is the only supported layout filter for now");
    }

    return {
        filter: {type: "Layout", operation: {type, layouts: ["Project"]}},
        byteLength: 1,
    };
}

/**
 * Filters the title of a task based on whether the task title has a phrase
 * that matches the query. Phrases are tested based on full word matches in the
 * correct order. For example "foobar buz" is matched by "foobar", "buz", or
 * "foobar buz". It is not matched by "foo", "bar", or "buz foobar".
 *
 * We use the [OpenSearch standard analyzer][1] with no modifications. The
 * standard analyzer splits words into tokens using the [Unicode default word
 * boundary specification][2] and lowercasing the words. We have a JavaScript
 * implementation of the title filter that does the same since filtering needs
 * to run both in OpenSearch and in JavaScript.
 *
 * The OpenSearch [standard analyzer implementation lives in Apache Lucene][3].
 * We refer to their implementation when building ours.
 *
 * [1]: https://opensearch.org/docs/latest/analyzers/text-analyzers/
 * [2]: https://unicode.org/reports/tr29/#Default_Word_Boundaries
 * [3]: https://github.com/apache/lucene/blob/dd4e66dad6726c53f2d89c5b7bcf74216949e4d3/lucene/core/src/java/org/apache/lucene/analysis/standard/StandardAnalyzer.java#L34
 */
export type TaskQueryTitleFilter = {
    readonly type: "Title";
    readonly operation: TaskQueryTitleFilterOperation;
};

export type TaskQueryTitleFilterOperation =
    | {
          readonly type: "Includes";
          readonly titleQuery: string;
      }
    | {
          readonly type: "Excludes";
          readonly titleQuery: string;
      };

function getTaskQueryTitleFilterByteLength(filter: TaskQueryTitleFilter) {
    return 1 + 4 + new TextEncoder().encode(filter.operation.titleQuery).length;
}

function serializeTaskQueryTitleFilter(filter: TaskQueryTitleFilter, view: DataView) {
    let byteOffset = 0;

    view.setUint8(byteOffset, filter.operation.type === "Includes" ? 1 : 2);
    byteOffset += 1;

    const titleQueryBytes = new TextEncoder().encode(filter.operation.titleQuery);

    // Make sure the title string byte length is a valid 32-bit integer since we
    // store it in 32 bits.
    assert(titleQueryBytes.length >>> 0 === titleQueryBytes.length);
    view.setUint32(byteOffset, titleQueryBytes.length);
    byteOffset += 4;

    new Uint8Array(view.buffer, view.byteOffset, view.byteLength).set(titleQueryBytes, byteOffset);
}

function deserializeTaskQueryTitleFilter(view: DataView): {
    filter: TaskQueryTitleFilter;
    byteLength: number;
} {
    let byteOffset = 0;

    const typeByte = view.getUint8(byteOffset);
    byteOffset += 1;

    let type: "Includes" | "Excludes";
    switch (typeByte) {
        case 1:
            type = "Includes";
            break;
        case 2:
            type = "Excludes";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeByte}`);
    }

    const titleQueryByteLength = view.getUint32(byteOffset);
    byteOffset += 4;

    const titleQuery = new TextDecoder().decode(
        new Uint8Array(view.buffer, view.byteOffset + byteOffset, titleQueryByteLength),
    );
    byteOffset += titleQueryByteLength;

    return {
        filter: {type: "Title", operation: {type, titleQuery}},
        byteLength: byteOffset,
    };
}

export type TaskQueryFilterAccountOperation =
    | {
          readonly type: "OneOf";
          readonly accounts: ReadonlyArray<
              | {readonly type: "Account"; readonly accountId: AccountId}
              | {readonly type: "CurrentAccount"}
              | {readonly type: "MissingAccount"}
          >;
      }
    | {
          readonly type: "NoneOf";
          readonly accounts: ReadonlyArray<
              | {readonly type: "Account"; readonly accountId: AccountId}
              | {readonly type: "CurrentAccount"}
              | {readonly type: "MissingAccount"}
          >;
      };

function getTaskQueryFilterAccountOperationByteLength(operation: TaskQueryFilterAccountOperation) {
    return (
        1 +
        operation.accounts
            .map(account => (account.type === "Account" ? 1 + idByteLength : 1))
            .reduce((byteLength, accountByteLength) => byteLength + accountByteLength, 0)
    );
}

function serializeTaskQueryFilterAccountOperation(
    operation: TaskQueryFilterAccountOperation,
    view: DataView,
) {
    // We use the first two bits of our `accounts` length byte to encode the
    // operation type. We reserve 0 for null.
    if (operation.accounts.length > 2 ** 6 - 1) throw new InvalidArgumentError("Too many accounts");

    const typeAndAccountsLengthByte =
        ((operation.type === "OneOf" ? 1 : 2) << 6) | (operation.accounts.length & 0b00111111);

    view.setUint8(0, typeAndAccountsLengthByte);

    let byteOffset = 1;

    for (const account of operation.accounts) {
        if (account.type === "Account") {
            view.setUint8(byteOffset, 1);
            byteOffset += 1;

            decodeIdInto(
                account.accountId,
                new Uint8Array(view.buffer, view.byteOffset + byteOffset, idByteLength),
            );
            byteOffset += idByteLength;
        } else {
            view.setUint8(byteOffset, account.type === "CurrentAccount" ? 2 : 3);
            byteOffset += 1;
        }
    }
}

function deserializeTaskQueryFilterAccountOperation(view: DataView): {
    operation: TaskQueryFilterAccountOperation;
    byteLength: number;
} {
    const typeAndAccountsLengthByte = view.getUint8(0);

    const typeBits = typeAndAccountsLengthByte >> 6;
    let type: "OneOf" | "NoneOf";
    switch (typeBits) {
        case 1:
            type = "OneOf";
            break;
        case 2:
            type = "NoneOf";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeBits}`);
    }

    const accountsLength = typeAndAccountsLengthByte & 0b00111111;
    const accounts: Array<
        | {readonly type: "Account"; readonly accountId: AccountId}
        | {readonly type: "CurrentAccount"}
        | {readonly type: "MissingAccount"}
    > = [];
    let byteOffset = 1;

    for (let i = 0; i < accountsLength; i++) {
        const typeBits = view.getUint8(byteOffset);
        byteOffset += 1;

        switch (typeBits) {
            case 1:
                accounts.push({
                    type: "Account",
                    accountId: encodeId(
                        new Uint8Array(view.buffer, view.byteOffset + byteOffset, idByteLength),
                    ),
                });
                byteOffset += idByteLength;
                break;
            case 2:
                accounts.push({type: "CurrentAccount"});
                break;
            case 3:
                accounts.push({type: "MissingAccount"});
                break;
            default:
                throw new InvalidArgumentError(`Unrecognized account type ${typeBits}`);
        }
    }

    return {
        operation: {type, accounts},
        byteLength: byteOffset,
    };
}

export type TaskQueryAssigneeFilter = {
    readonly type: "Assignee";
    readonly operation: TaskQueryFilterAccountOperation;
};

function getTaskQueryAssigneeFilterByteLength(filter: TaskQueryAssigneeFilter) {
    return getTaskQueryFilterAccountOperationByteLength(filter.operation);
}

function serializeTaskQueryAssigneeFilter(filter: TaskQueryAssigneeFilter, view: DataView) {
    serializeTaskQueryFilterAccountOperation(filter.operation, view);
}

function deserializeTaskQueryAssigneeFilter(view: DataView): {
    filter: TaskQueryAssigneeFilter;
    byteLength: number;
} {
    const {operation, byteLength} = deserializeTaskQueryFilterAccountOperation(view);
    return {filter: {type: "Assignee", operation}, byteLength};
}

export type TaskQueryCreatorFilter = {
    readonly type: "Creator";
    readonly operation: TaskQueryFilterAccountOperation;
};

function getTaskQueryCreatorFilterByteLength(filter: TaskQueryCreatorFilter) {
    return getTaskQueryFilterAccountOperationByteLength(filter.operation);
}

function serializeTaskQueryCreatorFilter(filter: TaskQueryCreatorFilter, view: DataView) {
    serializeTaskQueryFilterAccountOperation(filter.operation, view);
}

function deserializeTaskQueryCreatorFilter(view: DataView): {
    filter: TaskQueryCreatorFilter;
    byteLength: number;
} {
    const {operation, byteLength} = deserializeTaskQueryFilterAccountOperation(view);
    return {filter: {type: "Creator", operation}, byteLength};
}

export type TaskQueryAssignerFilter = {
    readonly type: "Assigner";
    readonly operation: TaskQueryFilterAccountOperation;
};

function getTaskQueryAssignerFilterByteLength(filter: TaskQueryAssignerFilter) {
    return getTaskQueryFilterAccountOperationByteLength(filter.operation);
}

function serializeTaskQueryAssignerFilter(filter: TaskQueryAssignerFilter, view: DataView) {
    serializeTaskQueryFilterAccountOperation(filter.operation, view);
}

function deserializeTaskQueryAssignerFilter(view: DataView): {
    filter: TaskQueryAssignerFilter;
    byteLength: number;
} {
    const {operation, byteLength} = deserializeTaskQueryFilterAccountOperation(view);
    return {filter: {type: "Assigner", operation}, byteLength};
}

function isUint32(number: number) {
    return Number.isInteger(number) && number >= 0 && number <= 2 ** 32 - 1;
}

function isUint8(number: number) {
    return Number.isInteger(number) && number >= 0 && number <= 2 ** 8 - 1;
}

export type TaskQueryFilterDateOperationDuration =
    | {
          readonly type: "Days";
          readonly count: number;
      }
    | {
          readonly type: "Weeks";
          readonly count: number;
      }
    | {
          readonly type: "Months";
          readonly count: number;
      }
    | {
          readonly type: "Years";
          readonly count: number;
      };

function getTaskQueryFilterDateOperationDurationByteLength(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    duration: TaskQueryFilterDateOperationDuration,
) {
    return 1 + 4;
}

function serializeTaskQueryFilterDateOperationDuration(
    duration: TaskQueryFilterDateOperationDuration,
    view: DataView,
) {
    switch (duration.type) {
        case "Days": {
            if (!isUint32(duration.count)) throw new InvalidArgumentError("Days must be a uint32");
            view.setUint8(0, 1);
            view.setUint32(1, duration.count);
            break;
        }
        case "Weeks": {
            if (!isUint32(duration.count)) throw new InvalidArgumentError("Weeks must be a uint32");
            view.setUint8(0, 2);
            view.setUint32(1, duration.count);
            break;
        }
        case "Months": {
            if (!isUint32(duration.count))
                throw new InvalidArgumentError("Months must be a uint32");
            view.setUint8(0, 3);
            view.setUint32(1, duration.count);
            break;
        }
        case "Years": {
            if (!isUint32(duration.count)) throw new InvalidArgumentError("Years must be a uint32");
            view.setUint8(0, 4);
            view.setUint32(1, duration.count);
            break;
        }
        default:
            throw exhaustive(duration);
    }
}

function deserializeTaskQueryFilterDateOperationDuration(view: DataView): {
    duration: TaskQueryFilterDateOperationDuration;
    byteLength: number;
} {
    let byteOffset = 0;

    const typeByte = view.getUint8(byteOffset);
    byteOffset += 1;

    switch (typeByte) {
        case 1: {
            const count = view.getUint32(byteOffset);
            byteOffset += 4;

            return {
                duration: {type: "Days", count},
                byteLength: byteOffset,
            };
        }
        case 2: {
            const count = view.getUint32(byteOffset);
            byteOffset += 4;

            return {
                duration: {type: "Weeks", count},
                byteLength: byteOffset,
            };
        }
        case 3: {
            const count = view.getUint32(byteOffset);
            byteOffset += 4;

            return {
                duration: {type: "Months", count},
                byteLength: byteOffset,
            };
        }
        case 4: {
            const count = view.getUint32(byteOffset);
            byteOffset += 4;

            return {
                duration: {type: "Years", count},
                byteLength: byteOffset,
            };
        }
        default:
            throw new InvalidArgumentError(`Unrecognized duration type ${typeByte}`);
    }
}

export type TaskQueryFilterDateOperationDate =
    | {
          readonly type: "Absolute";
          readonly date: CalendarDate | null;
      }
    | {
          readonly type: "RelativeToday";
      }
    | {
          readonly type: "RelativeAfterToday";
          readonly duration: TaskQueryFilterDateOperationDuration;
      }
    | {
          readonly type: "RelativeBeforeToday";
          readonly duration: TaskQueryFilterDateOperationDuration;
      };

function getTaskQueryFilterDateOperationDateByteLength(date: TaskQueryFilterDateOperationDate) {
    switch (date.type) {
        case "Absolute": {
            if (!date.date) return 1;

            return (
                1 + // Tag
                4 + // Year (0 through 2^32 - 1, ~4 billion)
                1 + // Month (0 through 255)
                1 // Day (0 through 255)
            );
        }
        case "RelativeToday": {
            return 1;
        }
        case "RelativeAfterToday":
        case "RelativeBeforeToday": {
            return 1 + getTaskQueryFilterDateOperationDurationByteLength(date.duration);
        }
        default:
            throw exhaustive(date);
    }
}

function serializeTaskQueryFilterDateOperationDate(
    date: TaskQueryFilterDateOperationDate,
    view: DataView,
) {
    switch (date.type) {
        case "Absolute": {
            if (!date.date) {
                view.setUint8(0, 2);
                break;
            }

            let byteOffset = 0;

            view.setUint8(byteOffset, 1);
            byteOffset += 1;

            const {year, month, day} = toCalendar(date.date, new GregorianCalendar());

            if (!isUint32(year)) throw new InvalidArgumentError("Year must be a uint32");
            view.setUint32(byteOffset, year);
            byteOffset += 4;

            if (!isUint8(month)) throw new InvalidArgumentError("Month must be a uint32");
            view.setUint8(byteOffset, month);
            byteOffset += 1;

            if (!isUint8(day)) throw new InvalidArgumentError("Day must be a uint32");
            view.setUint8(byteOffset, day);
            byteOffset += 1;
            break;
        }
        case "RelativeToday": {
            view.setUint8(0, 3);
            break;
        }
        case "RelativeAfterToday": {
            view.setUint8(0, 4);

            serializeTaskQueryFilterDateOperationDuration(
                date.duration,
                new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
            );
            break;
        }
        case "RelativeBeforeToday": {
            view.setUint8(0, 5);

            serializeTaskQueryFilterDateOperationDuration(
                date.duration,
                new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
            );
            break;
        }
        default:
            throw exhaustive(date);
    }
}

function deserializeTaskQueryFilterDateOperationDate(view: DataView): {
    date: TaskQueryFilterDateOperationDate;
    byteLength: number;
} {
    const typeByte = view.getUint8(0);

    switch (typeByte) {
        case 1: {
            let byteOffset = 1;

            const year = view.getUint32(byteOffset);
            byteOffset += 4;

            const month = view.getUint8(byteOffset);
            byteOffset += 1;

            const day = view.getUint8(byteOffset);
            byteOffset += 1;

            const date = new CalendarDate(new GregorianCalendar(), year, month, day);

            return {
                date: {type: "Absolute", date},
                byteLength: byteOffset,
            };
        }
        case 2: {
            return {
                date: {type: "Absolute", date: null},
                byteLength: 1,
            };
        }
        case 3: {
            return {
                date: {type: "RelativeToday"},
                byteLength: 1,
            };
        }
        case 4: {
            const {duration, byteLength} = deserializeTaskQueryFilterDateOperationDuration(
                new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
            );

            return {
                date: {type: "RelativeAfterToday", duration},
                byteLength: 1 + byteLength,
            };
        }
        case 5: {
            const {duration, byteLength} = deserializeTaskQueryFilterDateOperationDuration(
                new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
            );

            return {
                date: {type: "RelativeBeforeToday", duration},
                byteLength: 1 + byteLength,
            };
        }
        default:
            throw new InvalidArgumentError(`Unrecognized date type ${typeByte}`);
    }
}

export type TaskQueryFilterDateOperation =
    | {
          readonly type: "LessThan";
          readonly date: TaskQueryFilterDateOperationDate;
      }
    | {
          readonly type: "GreaterThan";
          readonly date: TaskQueryFilterDateOperationDate;
      };

function getTaskQueryFilterDateOperationByteLength(operation: TaskQueryFilterDateOperation) {
    return 1 + getTaskQueryFilterDateOperationDateByteLength(operation.date);
}

function serializeTaskQueryFilterDateOperation(
    operation: TaskQueryFilterDateOperation,
    view: DataView,
) {
    view.setUint8(0, operation.type === "LessThan" ? 1 : 2);

    serializeTaskQueryFilterDateOperationDate(
        operation.date,
        new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
    );
}

function deserializeTaskQueryFilterDateOperation(view: DataView): {
    operation: TaskQueryFilterDateOperation;
    byteLength: number;
} {
    const typeByte = view.getUint8(0);
    let type: "LessThan" | "GreaterThan";
    switch (typeByte) {
        case 1:
            type = "LessThan";
            break;
        case 2:
            type = "GreaterThan";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeByte}`);
    }

    const {date, byteLength} = deserializeTaskQueryFilterDateOperationDate(
        new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
    );
    return {operation: {type, date}, byteLength: byteLength + 1};
}

export type TaskQueryDueDateFilter = {
    readonly type: "DueDate";
    readonly operation:
        | {readonly type: "Overdue"}
        | {readonly type: "IsEmpty"}
        | TaskQueryFilterDateOperation;
};

function getTaskQueryDueDateFilterByteLength(filter: TaskQueryDueDateFilter) {
    if (filter.operation.type === "Overdue" || filter.operation.type === "IsEmpty") {
        return 1;
    } else {
        return getTaskQueryFilterDateOperationByteLength(filter.operation);
    }
}

function serializeTaskQueryDueDateFilter(filter: TaskQueryDueDateFilter, view: DataView) {
    if (filter.operation.type === "Overdue") {
        view.setUint8(0, 255);
    } else if (filter.operation.type === "IsEmpty") {
        view.setUint8(0, 254);
    } else {
        serializeTaskQueryFilterDateOperation(filter.operation, view);
    }
}

function deserializeTaskQueryDueDateFilter(view: DataView): {
    filter: TaskQueryDueDateFilter;
    byteLength: number;
} {
    const firstByte = view.getUint8(0);
    if (firstByte === 255) {
        return {filter: {type: "DueDate", operation: {type: "Overdue"}}, byteLength: 1};
    } else if (firstByte === 254) {
        return {filter: {type: "DueDate", operation: {type: "IsEmpty"}}, byteLength: 1};
    }

    const {operation, byteLength} = deserializeTaskQueryFilterDateOperation(view);
    return {filter: {type: "DueDate", operation}, byteLength};
}

export type TaskQueryCreatedDateFilter = {
    readonly type: "CreatedDate";
    readonly operation: TaskQueryFilterDateOperation;
};

function getTaskQueryCreatedDateFilterByteLength(filter: TaskQueryCreatedDateFilter) {
    return getTaskQueryFilterDateOperationByteLength(filter.operation);
}

function serializeTaskQueryCreatedDateFilter(filter: TaskQueryCreatedDateFilter, view: DataView) {
    serializeTaskQueryFilterDateOperation(filter.operation, view);
}

function deserializeTaskQueryCreatedDateFilter(view: DataView): {
    filter: TaskQueryCreatedDateFilter;
    byteLength: number;
} {
    const {operation, byteLength} = deserializeTaskQueryFilterDateOperation(view);
    return {filter: {type: "CreatedDate", operation}, byteLength};
}

export type TaskQueryAssignedDateFilter = {
    readonly type: "AssignedDate";
    readonly operation: TaskQueryFilterDateOperation;
};

function getTaskQueryAssignedDateFilterByteLength(filter: TaskQueryAssignedDateFilter) {
    return getTaskQueryFilterDateOperationByteLength(filter.operation);
}

function serializeTaskQueryAssignedDateFilter(filter: TaskQueryAssignedDateFilter, view: DataView) {
    serializeTaskQueryFilterDateOperation(filter.operation, view);
}

function deserializeTaskQueryAssignedDateFilter(view: DataView): {
    filter: TaskQueryAssignedDateFilter;
    byteLength: number;
} {
    const {operation, byteLength} = deserializeTaskQueryFilterDateOperation(view);
    return {filter: {type: "AssignedDate", operation}, byteLength};
}

export type TaskQueryClosedDateFilter = {
    readonly type: "ClosedDate";
    readonly operation: TaskQueryFilterDateOperation;
};

function getTaskQueryClosedDateFilterByteLength(filter: TaskQueryClosedDateFilter) {
    return getTaskQueryFilterDateOperationByteLength(filter.operation);
}

function serializeTaskQueryClosedDateFilter(filter: TaskQueryClosedDateFilter, view: DataView) {
    serializeTaskQueryFilterDateOperation(filter.operation, view);
}

function deserializeTaskQueryClosedDateFilter(view: DataView): {
    filter: TaskQueryClosedDateFilter;
    byteLength: number;
} {
    const {operation, byteLength} = deserializeTaskQueryFilterDateOperation(view);
    return {filter: {type: "ClosedDate", operation}, byteLength};
}

export type TaskQueryActivatedDateFilter = {
    readonly type: "ActivatedDate";
    readonly operation: TaskQueryFilterDateOperation;
};

function getTaskQueryActivatedDateFilterByteLength(filter: TaskQueryActivatedDateFilter) {
    return getTaskQueryFilterDateOperationByteLength(filter.operation);
}

function serializeTaskQueryActivatedDateFilter(
    filter: TaskQueryActivatedDateFilter,
    view: DataView,
) {
    serializeTaskQueryFilterDateOperation(filter.operation, view);
}

function deserializeTaskQueryActivatedDateFilter(view: DataView): {
    filter: TaskQueryActivatedDateFilter;
    byteLength: number;
} {
    const {operation, byteLength} = deserializeTaskQueryFilterDateOperation(view);
    return {filter: {type: "ActivatedDate", operation}, byteLength};
}
