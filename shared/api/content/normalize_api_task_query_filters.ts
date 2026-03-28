import {
    ApiTaskQueryAccountFilterOperation,
    ApiTaskQueryFilter,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Normalizes a list of API task filters into the canonical form printed by
 * `printAgentWebTaskQueryFilters()` and returned by `parseAgentWebTaskQueryFilters()`.
 * Normalizing never changes which tasks a list of filters matches.
 *
 * Repeated values in a single filter are deduped keeping the first occurrence
 * (e.g. a status filter with `[Open, Open, Closed]` becomes `[Open, Closed]`).
 * This mirrors `fromApiTaskQueryFilter()` which collects these values into sets when
 * converting to the canonical `TaskQueryFilter` representation.
 *
 * This gives the agent web task filter format an exact round-trip property for any
 * list of API task filters:
 *
 * ```ts
 * parseAgentWebTaskQueryFilters(
 *     storage,
 *     new URLSearchParams(await printAgentWebTaskQueryFilters(storage, filters)),
 * ) === normalizeApiTaskQueryFilters(filters);
 * ```
 */
export function normalizeApiTaskQueryFilters<Filter extends ApiTaskQueryFilter>(
    filters: ReadonlyArray<Filter>,
): ReadonlyArray<Filter> {
    return filters.map(normalizeApiTaskQueryFilter);
}

function normalizeApiTaskQueryFilter<Filter extends ApiTaskQueryFilter>(filter: Filter): Filter {
    switch (filter.type) {
        case "Status": {
            return {
                ...filter,
                operation: {
                    ...filter.operation,
                    statuses: dedupeApiTaskQueryFilterValues(filter.operation.statuses, status =>
                        status.type === "Open" ? `Open:${status.isActive}` : "Closed",
                    ),
                },
            };
        }
        case "Collections": {
            const {operation} = filter;
            if (operation.type === "IsEmpty") return filter;

            return {
                ...filter,
                operation: {
                    ...filter.operation,
                    collections: dedupeApiTaskQueryFilterValues(
                        operation.collections,
                        collection => collection.id,
                    ),
                },
            };
        }
        case "Priority": {
            return {
                ...filter,
                operation: {
                    ...filter.operation,
                    priorities: dedupeApiTaskQueryFilterValues(
                        filter.operation.priorities,
                        priority => (priority === null ? "None" : priority.type),
                    ),
                },
            };
        }
        case "Layout": {
            return {
                ...filter,
                operation: {
                    ...filter.operation,
                    layouts: dedupeApiTaskQueryFilterValues(
                        filter.operation.layouts,
                        layout => layout.type,
                    ),
                },
            };
        }
        case "Title": {
            return filter;
        }
        case "Assignee": {
            return {
                ...filter,
                operation: {
                    ...filter.operation,
                    accounts: dedupeApiTaskQueryFilterValues(
                        filter.operation.accounts,
                        printApiTaskQueryFilterAccountDedupeKey,
                    ),
                },
            };
        }
        case "Creator": {
            return {
                ...filter,
                operation: {
                    ...filter.operation,
                    accounts: dedupeApiTaskQueryFilterValues(
                        filter.operation.accounts,
                        printApiTaskQueryFilterAccountDedupeKey,
                    ),
                },
            };
        }
        case "Assigner": {
            return {
                ...filter,
                operation: {
                    ...filter.operation,
                    accounts: dedupeApiTaskQueryFilterValues(
                        filter.operation.accounts,
                        printApiTaskQueryFilterAccountDedupeKey,
                    ),
                },
            };
        }
        case "Due":
        case "CreatedTime":
        case "AssignedTime":
        case "ClosedTime":
        case "ActivatedTime": {
            return filter;
        }
        default:
            throw exhaustive(filter);
    }
}

function dedupeApiTaskQueryFilterValues<Value>(
    values: ReadonlyArray<Value>,
    printValueDedupeKey: (value: Value) => string,
): ReadonlyArray<Value> {
    const seenDedupeKeys = new Set<string>();
    const dedupedValues: Array<Value> = [];

    for (const value of values) {
        const dedupeKey = printValueDedupeKey(value);
        if (seenDedupeKeys.has(dedupeKey)) continue;
        seenDedupeKeys.add(dedupeKey);
        dedupedValues.push(value);
    }

    return dedupedValues;
}

function printApiTaskQueryFilterAccountDedupeKey(
    account: ApiTaskQueryAccountFilterOperation["accounts"][number],
): string {
    return account.type === "Account" ? `Account:${account.account.id}` : account.type;
}
