import {CalendarDate, DateDuration, GregorianCalendar, toCalendar} from "@internationalized/date";
import {InvalidArgumentError} from "~/shared/error/error";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {decodeIdInto, encodeId, idByteLength} from "~/shared/id/id";
import {AccountId, LocalTaskCollectionId} from "~/shared/id/types/id_types";

export type TaskQueryFilter =
    | TaskQueryStatusFilter
    | TaskQueryCollectionsFilter
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
        case "Status":
            typeId = 1;
            break;
        case "Collections":
            typeId = 2;
            break;
        case "Assignee":
            typeId = 3;
            break;
        case "Creator":
            typeId = 4;
            break;
        case "Assigner":
            typeId = 5;
            break;
        case "DueDate":
            typeId = 6;
            break;
        case "CreatedDate":
            typeId = 7;
            break;
        case "AssignedDate":
            typeId = 8;
            break;
        case "ClosedDate":
            typeId = 9;
            break;
        case "ActivatedDate":
            typeId = 10;
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
            return deserializeTaskQueryStatusFilter(view);
        case 2:
            return deserializeTaskQueryCollectionsFilter(view);
        case 3:
            return deserializeTaskQueryAssigneeFilter(view);
        case 4:
            return deserializeTaskQueryCreatorFilter(view);
        case 5:
            return deserializeTaskQueryAssignerFilter(view);
        case 6:
            return deserializeTaskQueryDueDateFilter(view);
        case 7:
            return deserializeTaskQueryCreatedDateFilter(view);
        case 8:
            return deserializeTaskQueryAssignedDateFilter(view);
        case 9:
            return deserializeTaskQueryClosedDateFilter(view);
        case 10:
            return deserializeTaskQueryActivatedDateFilter(view);
        default:
            throw new InvalidArgumentError(`Unrecognized filter type ${typeId}`);
    }
}

function getTaskQueryFilterWithoutTypeByteLength(filter: TaskQueryFilter) {
    switch (filter.type) {
        case "Status":
            return getTaskQueryStatusFilterByteLength(filter);
        case "Collections":
            return getTaskQueryCollectionsFilterByteLength(filter);
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
        default:
            throw exhaustive(filter);
    }
}

function serializeTaskQueryFilterWithoutType(filter: TaskQueryFilter, view: DataView) {
    switch (filter.type) {
        case "Status":
            return serializeTaskQueryStatusFilter(filter, view);
        case "Collections":
            return serializeTaskQueryCollectionsFilter(filter, view);
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
        default:
            throw exhaustive(filter);
    }
}

export type TaskQueryStatusFilter = {
    readonly type: "Status";
    readonly operation:
        | {
              readonly type: "OneOf";
              readonly statuses: ReadonlySet<"Open" | "Active" | "Closed">;
          }
        | {
              readonly type: "NoneOf";
              readonly statuses: ReadonlySet<"Open" | "Active" | "Closed">;
          };
};

function getTaskQueryStatusFilterByteLength(filter: TaskQueryStatusFilter) {
    return 1;
}

function serializeTaskQueryStatusFilter(filter: TaskQueryStatusFilter, view: DataView) {
    const byte =
        // Operation type is stored in the first 4 bits
        ((filter.operation.type === "OneOf" ? 1 : 2) << 4) |
        // Statuses are stored in the last 4 bits as a bitset
        (filter.operation.statuses.has("Open") ? 0b00001000 : 0b00000000) |
        (filter.operation.statuses.has("Active") ? 0b00000100 : 0b00000000) |
        (filter.operation.statuses.has("Closed") ? 0b00000010 : 0b00000000);

    view.setUint8(0, byte);
}

function deserializeTaskQueryStatusFilter(view: DataView): {
    filter: TaskQueryStatusFilter;
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

    const statuses = new Set<"Open" | "Active" | "Closed">();

    if (byte & 0b00001000) statuses.add("Open");
    if (byte & 0b00000100) statuses.add("Active");
    if (byte & 0b00000010) statuses.add("Closed");

    return {
        filter: {type: "Status", operation: {type, statuses}},
        byteLength: 1,
    };
}

export type TaskQueryCollectionsFilter = {
    readonly type: "Collections";
    readonly operation:
        | {
              readonly type: "IncludesOneOf";
              readonly collectionIds: ReadonlySet<LocalTaskCollectionId>;
          }
        | {
              readonly type: "ExcludesAllOf";
              readonly collectionIds: ReadonlySet<LocalTaskCollectionId>;
          };
};

function getTaskQueryCollectionsFilterByteLength(filter: TaskQueryCollectionsFilter) {
    return 1 + filter.operation.collectionIds.size * idByteLength;
}

function serializeTaskQueryCollectionsFilter(filter: TaskQueryCollectionsFilter, view: DataView) {
    // We use the first two bits of our `collectionIds` length byte to encode the
    // operation type. We reserve 0 for null.
    if (filter.operation.collectionIds.size > 2 ** 6 - 1)
        throw new InvalidArgumentError("Too many collections");

    const typeAndCollectionIdsSizeByte =
        ((filter.operation.type === "IncludesOneOf" ? 1 : 2) << 6) |
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
    let type: "IncludesOneOf" | "ExcludesAllOf";
    switch (typeBits) {
        case 1:
            type = "IncludesOneOf";
            break;
        case 2:
            type = "ExcludesAllOf";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeBits}`);
    }

    const collectionIdsSize = typeAndCollectionIdsSizeByte & 0b00111111;
    const collectionIds = new Set<LocalTaskCollectionId>();
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

export type TaskQueryFilterAccountOperation =
    | {
          readonly type: "OneOf";
          readonly accounts: ReadonlyArray<
              | {readonly type: "Account"; readonly accountId: AccountId}
              | {readonly type: "CurrentAccount"}
              | {readonly type: "NoAccount"}
          >;
      }
    | {
          readonly type: "NoneOf";
          readonly accounts: ReadonlyArray<
              | {readonly type: "Account"; readonly accountId: AccountId}
              | {readonly type: "CurrentAccount"}
              | {readonly type: "NoAccount"}
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
        | {readonly type: "NoAccount"}
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
                accounts.push({type: "NoAccount"});
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

export type TaskQueryFilterDateOperationDate =
    | {
          readonly type: "Absolute";
          readonly date: CalendarDate;
      }
    | {
          readonly type: "RelativeAfterToday";
          readonly duration: DateDuration;
      }
    | {
          readonly type: "RelativeBeforeToday";
          readonly duration: DateDuration;
      };

function getTaskQueryFilterDateOperationDateByteLength(date: TaskQueryFilterDateOperationDate) {
    switch (date.type) {
        case "Absolute": {
            return (
                1 + // Tag
                4 + // Year (0 through 2^32 - 1, ~4 billion)
                1 + // Month (0 through 255)
                1 // Day (0 through 255)
            );
        }
        case "RelativeAfterToday":
        case "RelativeBeforeToday": {
            return (
                1 + // Tag
                4 + // Years
                4 + // Months
                4 + // Weeks
                4 // Days
            );
        }
        default:
            throw exhaustive(date);
    }
}

function isUint32(number: number) {
    return Number.isInteger(number) && number >= 0 && number <= 2 ** 32 - 1;
}

function isUint8(number: number) {
    return Number.isInteger(number) && number >= 0 && number <= 2 ** 8 - 1;
}

function serializeTaskQueryFilterDateOperationDate(
    date: TaskQueryFilterDateOperationDate,
    view: DataView,
) {
    switch (date.type) {
        case "Absolute": {
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
        case "RelativeAfterToday": {
            let byteOffset = 0;

            view.setUint8(byteOffset, 2);
            byteOffset += 1;

            const {years = 0, months = 0, weeks = 0, days = 0} = date.duration;

            if (!isUint32(years)) throw new InvalidArgumentError("Years must be a uint32");
            view.setUint32(byteOffset, years);
            byteOffset += 4;

            if (!isUint32(months)) throw new InvalidArgumentError("Months must be a uint32");
            view.setUint32(byteOffset, months);
            byteOffset += 4;

            if (!isUint32(weeks)) throw new InvalidArgumentError("Weeks must be a uint32");
            view.setUint32(byteOffset, weeks);
            byteOffset += 4;

            if (!isUint32(days)) throw new InvalidArgumentError("Days must be a uint32");
            view.setUint32(byteOffset, days);
            byteOffset += 4;
            break;
        }
        case "RelativeBeforeToday": {
            let byteOffset = 0;

            view.setUint8(byteOffset, 3);
            byteOffset += 1;

            const {years = 0, months = 0, weeks = 0, days = 0} = date.duration;

            if (!isUint32(years)) throw new InvalidArgumentError("Years must be a uint32");
            view.setUint32(byteOffset, years);
            byteOffset += 4;

            if (!isUint32(months)) throw new InvalidArgumentError("Months must be a uint32");
            view.setUint32(byteOffset, months);
            byteOffset += 4;

            if (!isUint32(weeks)) throw new InvalidArgumentError("Weeks must be a uint32");
            view.setUint32(byteOffset, weeks);
            byteOffset += 4;

            if (!isUint32(days)) throw new InvalidArgumentError("Days must be a uint32");
            view.setUint32(byteOffset, days);
            byteOffset += 4;
            break;
        }
    }
}

function deserializeTaskQueryFilterDateOperationDate(view: DataView): {
    date: TaskQueryFilterDateOperationDate;
    byteLength: number;
} {
    let byteOffset = 0;

    const typeByte = view.getUint8(byteOffset);
    byteOffset += 1;

    switch (typeByte) {
        case 1: {
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
            const years = view.getUint32(byteOffset);
            byteOffset += 4;

            const months = view.getUint32(byteOffset);
            byteOffset += 4;

            const weeks = view.getUint32(byteOffset);
            byteOffset += 4;

            const days = view.getUint32(byteOffset);
            byteOffset += 4;

            const duration: DateDuration = {};
            if (years !== 0) duration.years = years;
            if (months !== 0) duration.months = months;
            if (weeks !== 0) duration.weeks = weeks;
            if (days !== 0) duration.days = days;

            return {
                date: {type: "RelativeAfterToday", duration},
                byteLength: byteOffset,
            };
        }
        case 3: {
            const years = view.getUint32(byteOffset);
            byteOffset += 4;

            const months = view.getUint32(byteOffset);
            byteOffset += 4;

            const weeks = view.getUint32(byteOffset);
            byteOffset += 4;

            const days = view.getUint32(byteOffset);
            byteOffset += 4;

            const duration: DateDuration = {};
            if (years !== 0) duration.years = years;
            if (months !== 0) duration.months = months;
            if (weeks !== 0) duration.weeks = weeks;
            if (days !== 0) duration.days = days;

            return {
                date: {type: "RelativeBeforeToday", duration},
                byteLength: byteOffset,
            };
        }
        default:
            throw new InvalidArgumentError(`Unrecognized date type ${typeByte}`);
    }
}

export type TaskQueryFilterDateOperation =
    | {
          readonly type: "LessThanOrEqualTo";
          readonly date: TaskQueryFilterDateOperationDate | null;
      }
    | {
          readonly type: "GreaterThanOrEqualTo";
          readonly date: TaskQueryFilterDateOperationDate | null;
      };

function getTaskQueryFilterDateOperationByteLength(operation: TaskQueryFilterDateOperation) {
    return 1 + (operation.date ? getTaskQueryFilterDateOperationDateByteLength(operation.date) : 1);
}

function serializeTaskQueryFilterDateOperation(
    operation: TaskQueryFilterDateOperation,
    view: DataView,
) {
    view.setUint8(0, operation.type === "LessThanOrEqualTo" ? 1 : 2);

    if (!operation.date) {
        view.setUint8(1, 0);
    } else {
        serializeTaskQueryFilterDateOperationDate(
            operation.date,
            new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
        );
    }
}

function deserializeTaskQueryFilterDateOperation(view: DataView): {
    operation: TaskQueryFilterDateOperation;
    byteLength: number;
} {
    const typeByte = view.getUint8(0);
    let type: "LessThanOrEqualTo" | "GreaterThanOrEqualTo";
    switch (typeByte) {
        case 1:
            type = "LessThanOrEqualTo";
            break;
        case 2:
            type = "GreaterThanOrEqualTo";
            break;
        default:
            throw new InvalidArgumentError(`Unrecognized operation type ${typeByte}`);
    }

    const firstDateByte = view.getUint8(1);
    if (firstDateByte === 0) {
        return {operation: {type, date: null}, byteLength: 2};
    }

    const {date, byteLength} = deserializeTaskQueryFilterDateOperationDate(
        new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1),
    );
    return {operation: {type, date}, byteLength: byteLength + 1};
}

export type TaskQueryDueDateFilter = {
    readonly type: "DueDate";
    readonly operation: {readonly type: "Overdue"} | TaskQueryFilterDateOperation;
};

function getTaskQueryDueDateFilterByteLength(filter: TaskQueryDueDateFilter) {
    if (filter.operation.type === "Overdue") {
        return 1;
    } else {
        return getTaskQueryFilterDateOperationByteLength(filter.operation);
    }
}

function serializeTaskQueryDueDateFilter(filter: TaskQueryDueDateFilter, view: DataView) {
    if (filter.operation.type === "Overdue") {
        view.setUint8(0, 255);
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
