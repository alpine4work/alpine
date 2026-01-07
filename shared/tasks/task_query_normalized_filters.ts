import {CalendarDate, maxDate, minDate} from "@internationalized/date";
import {compareArrays} from "~/shared/helpers/array/compare_arrays.js";
import {
    NonEmptyReadonlyArray,
    isNonEmptyReadonlyArray,
} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {diffSets} from "~/shared/helpers/set/diff_sets.js";
import {intersectSets} from "~/shared/helpers/set/intersect_sets.js";
import {unionSets} from "~/shared/helpers/set/union_sets.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {ObjectSchema, Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";
import {analyzeTaskTitleText} from "~/shared/tasks/analyze_task_title_text.js";
import {CalendarDateSchema} from "~/shared/tasks/calendar_date_schema.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {
    TaskQueryCollectionsFilter,
    TaskQueryDisplayStatusFilter,
    TaskQueryFilter,
    TaskQueryFilterAccountOperation,
    TaskQueryFilterDateOperation,
    TaskQueryFilterDateOperationDate,
    TaskQueryPriorityFilter,
} from "~/shared/tasks/task_query_filter.js";

function assertNonEmptyReadonlyArray<T>(array: ReadonlyArray<T>): NonEmptyReadonlyArray<T> {
    assert(isNonEmptyReadonlyArray(array));
    return array;
}

type NonEmptyReadonlySet<T> = ReadonlySet<T> & {readonly _NonEmptyReadonlySet: never};

function isNonEmptyReadonlySet<T>(set: ReadonlySet<T>): set is NonEmptyReadonlySet<T> {
    return set.size > 0;
}

export function assertNonEmptyReadonlySet<V>(set: ReadonlySet<V>): NonEmptyReadonlySet<V> {
    assert(isNonEmptyReadonlySet(set));
    return set;
}

type NonEmptyReadonlyMap<K, V> = ReadonlyMap<K, V> & {readonly _NonEmptyReadonlyMap: never};

function isNonEmptyReadonlyMap<K, V>(map: ReadonlyMap<K, V>): map is NonEmptyReadonlyMap<K, V> {
    return map.size > 0;
}

export function assertNonEmptyReadonlyMap<K, V>(map: ReadonlyMap<K, V>): NonEmptyReadonlyMap<K, V> {
    assert(isNonEmptyReadonlyMap(map));
    return map;
}

/**
 * Representation of a normalized filter set.
 *
 * Leverages TypeScript to make sure impossible states are actually impossible.
 */
export type TaskQueryNormalizedFilters = {
    readonly displayStatusFilter: TaskQueryDisplayStatusNormalizedFilter;
    readonly collectionsFilter?: TaskQueryCollectionsNormalizedFilter;
    readonly priorityFilter?: TaskQueryPriorityNormalizedFilter;
    readonly titleFilter?: TaskQueryTitleNormalizedFilter;
    readonly assigneeFilter?: TaskQueryAccountNormalizedFilter;
    readonly creatorFilter?: TaskQueryAccountNormalizedFilter;
    readonly assignerFilter?: TaskQueryAccountNormalizedFilter;
    readonly dueDateFilter?:
        | TaskQueryDateNormalizedFilter
        | {readonly type: "IsEmpty"}
        | Replace<TaskQueryDateNormalizedFilter, {readonly type: "RangeOrIsEmpty"}>;
    readonly createdDateFilter?: TaskQueryDateNormalizedFilter;
    readonly assignedDateFilter?: TaskQueryDateNormalizedFilter;
    readonly closedDateFilter?: TaskQueryDateNormalizedFilter;
    readonly activatedDateFilter?: TaskQueryDateNormalizedFilter;
    readonly parentFilter?: TaskQueryParentNormalizedFilter;
};

export const defaultTaskQueryNormalizedFilters: TaskQueryNormalizedFilters = {
    displayStatusFilter: {ifOpenInactive: true, ifOpenActive: true, ifClosed: false},
};

// At least one of the three statuses must be included in this filter. Otherwise
// the filter is impossible.
export type TaskQueryDisplayStatusNormalizedFilter =
    | {
          readonly ifOpenInactive: true;
          readonly ifOpenActive: boolean;
          readonly ifClosed: boolean;
      }
    | {
          readonly ifOpenInactive: boolean;
          readonly ifOpenActive: true;
          readonly ifClosed: boolean;
      }
    | {
          readonly ifOpenInactive: boolean;
          readonly ifOpenActive: boolean;
          readonly ifClosed: true;
      };

const TaskQueryDisplayStatusNormalizedFilterSchema = Schema.object({
    ifOpenInactive: Schema.boolean,
    ifOpenActive: Schema.boolean,
    ifClosed: Schema.boolean,
}) as Schema<TaskQueryDisplayStatusNormalizedFilter>;

/**
 * The normalized format for collection filters is in [conjunctive normal
 * form][1].
 *
 * - The items in the top-level array are "and"ed together.
 * - The entries of the nested map are "or"ed together.
 * - If the value of an entry in the nested map is true then that entry
 *   is "not"ed.
 * - If the key of an entry in the nested map is a `TaskCollectionId` the
 *   expression is `collections.has(collectionId)`.
 * - If the key of an entry in the nested map is `IsEmpty` then expression is
 *   `collections.size === 0`.
 *
 * Conjunctive normal form allows us to easily perform logical analysis on our
 * boolean expression.
 *
 * We call the nested map a "clause" and a key in that map a "term".
 *
 * [1]: https://en.wikipedia.org/wiki/Conjunctive_normal_form
 */
export type TaskQueryCollectionsNormalizedFilter =
    NonEmptyReadonlyArray<TaskQueryCollectionsNormalizedFilterClause>;

export type TaskQueryCollectionsNormalizedFilterClause = NonEmptyReadonlyMap<
    TaskCollectionId | "IsEmpty",
    boolean
>;

const TaskQueryCollectionsNormalizedFilterSchema = Schema.array(
    Schema.map(Schema.string, Schema.boolean),
).transform<TaskQueryCollectionsNormalizedFilter>({
    serialize: filter => filter,
    deserialize: filter => {
        if (filter.length === 0) throw new SchemaDeserializationError("Expected non-empty array");

        for (const filterClause of filter) {
            if (filterClause.size === 0)
                throw new SchemaDeserializationError("Expected non-empty map");

            for (const term of filterClause.keys()) {
                if (term !== "IsEmpty" && !isId(term)) {
                    throw new SchemaDeserializationError(
                        "Expected map keys to either be a `TaskCollectionId` or the string `IsEmpty`",
                    );
                }
            }
        }

        return filter as TaskQueryCollectionsNormalizedFilter;
    },
});

export type TaskQueryTitleNormalizedFilter = NonEmptyReadonlyArray<{
    readonly operationType: "Includes" | "Excludes";
    readonly titleQuery: string;
    readonly titleQueryWords: NonEmptyReadonlyArray<string>;
}>;

const TaskQueryTitleNormalizedFilterSchema = Schema.array(
    Schema.object({
        operationType: Schema.enum(["Includes", "Excludes"]),
        titleQuery: Schema.string,
    }),
).transform<TaskQueryTitleNormalizedFilter>({
    serialize: filter => filter,
    deserialize: serializedFilter => {
        const filter = serializedFilter.map(operation => {
            const titleQueryWords = analyzeTaskTitleText(operation.titleQuery);

            if (!isNonEmptyReadonlyArray(titleQueryWords))
                throw new SchemaDeserializationError("Expected non-empty title query");

            return {
                operationType: operation.operationType,
                titleQuery: operation.titleQuery,
                titleQueryWords,
            };
        });

        if (!isNonEmptyReadonlyArray(filter))
            throw new SchemaDeserializationError("Expected non-empty array");

        return filter;
    },
});

// At least one of the five priorities must be included in this filter. Otherwise
// the filter is impossible.
export type TaskQueryPriorityNormalizedFilter =
    | {
          readonly ifNull: true;
          readonly ifLow: boolean;
          readonly ifMedium: boolean;
          readonly ifHigh: boolean;
          readonly ifUrgent: boolean;
      }
    | {
          readonly ifNull: boolean;
          readonly ifLow: true;
          readonly ifMedium: boolean;
          readonly ifHigh: boolean;
          readonly ifUrgent: boolean;
      }
    | {
          readonly ifNull: boolean;
          readonly ifLow: boolean;
          readonly ifMedium: true;
          readonly ifHigh: boolean;
          readonly ifUrgent: boolean;
      }
    | {
          readonly ifNull: boolean;
          readonly ifLow: boolean;
          readonly ifMedium: boolean;
          readonly ifHigh: true;
          readonly ifUrgent: boolean;
      }
    | {
          readonly ifNull: boolean;
          readonly ifLow: boolean;
          readonly ifMedium: boolean;
          readonly ifHigh: boolean;
          readonly ifUrgent: true;
      };

const TaskQueryPriorityNormalizedFilterSchema = Schema.object({
    ifNull: Schema.boolean,
    ifLow: Schema.boolean,
    ifMedium: Schema.boolean,
    ifHigh: Schema.boolean,
    ifUrgent: Schema.boolean,
}) as Schema<TaskQueryPriorityNormalizedFilter>;

export type TaskQueryAccountNormalizedFilter =
    | {
          readonly type: "OneOf";
          readonly accountIds: NonEmptyReadonlySet<AccountId | "MissingAccount">;
      }
    | {
          readonly type: "NoneOf";
          readonly accountIds: NonEmptyReadonlySet<AccountId | "MissingAccount">;
      };

const TaskQueryAccountNormalizedFilterAccountIdsSchema = Schema.set(Schema.string).transform<
    NonEmptyReadonlySet<AccountId | "MissingAccount">
>({
    serialize: accountIds => accountIds,
    deserialize: accountIds => {
        if (accountIds.size === 0) throw new SchemaDeserializationError("Expected non-empty set");

        for (const accountId of accountIds) {
            if (accountId !== "MissingAccount" && !isId(accountId)) {
                throw new SchemaDeserializationError(
                    "Expected set values to either be an `AccountId` or the string `MissingAccount`",
                );
            }
        }

        return accountIds as NonEmptyReadonlySet<AccountId | "MissingAccount">;
    },
});

const TaskQueryAccountNormalizedFilterSchema = Schema.union({
    OneOf: Schema.object({
        type: Schema.value("OneOf"),
        accountIds: TaskQueryAccountNormalizedFilterAccountIdsSchema,
    }),
    NoneOf: Schema.object({
        type: Schema.value("NoneOf"),
        accountIds: TaskQueryAccountNormalizedFilterAccountIdsSchema,
    }),
});

// At least one of `exclusiveUpperBoundDate` or `exclusiveLowerBoundDate` must
// be set.
export type TaskQueryDateNormalizedFilter =
    | {
          readonly type: "Range";
          readonly exclusiveLowerBoundDate: CalendarDate | null;
          readonly exclusiveUpperBoundDate: CalendarDate;
      }
    | {
          readonly type: "Range";
          readonly exclusiveLowerBoundDate: CalendarDate;
          readonly exclusiveUpperBoundDate: CalendarDate | null;
      };

const TaskQueryDateNormalizedFilterBaseSchema = Schema.object({
    exclusiveLowerBoundDate: CalendarDateSchema.nullable(),
    exclusiveUpperBoundDate: CalendarDateSchema.nullable(),
});

const TaskQueryDateNormalizedFilterSchema = Schema.object({
    type: Schema.value("Range"),
}).merge(TaskQueryDateNormalizedFilterBaseSchema) as ObjectSchema<TaskQueryDateNormalizedFilter>;

export type TaskQueryParentNormalizedFilter = {
    readonly parentTaskId: TaskId;
};

const TaskQueryParentNormalizedFilterSchema = Schema.object({
    parentTaskId: Schema.id<TaskId>(),
});

export const TaskQueryNormalizedFiltersSchema: Schema<TaskQueryNormalizedFilters> = Schema.object({
    displayStatusFilter: TaskQueryDisplayStatusNormalizedFilterSchema,
    collectionsFilter: TaskQueryCollectionsNormalizedFilterSchema.optional(),
    priorityFilter: TaskQueryPriorityNormalizedFilterSchema.optional(),
    titleFilter: TaskQueryTitleNormalizedFilterSchema.optional(),
    assigneeFilter: TaskQueryAccountNormalizedFilterSchema.optional(),
    creatorFilter: TaskQueryAccountNormalizedFilterSchema.optional(),
    assignerFilter: TaskQueryAccountNormalizedFilterSchema.optional(),
    dueDateFilter: Schema.union({
        Range: TaskQueryDateNormalizedFilterSchema,
        IsEmpty: Schema.object({type: Schema.value("IsEmpty")}),
        RangeOrIsEmpty: Schema.object({type: Schema.value("RangeOrIsEmpty")}).merge(
            TaskQueryDateNormalizedFilterBaseSchema,
        ),
    }).optional(),
    createdDateFilter: TaskQueryDateNormalizedFilterSchema.optional(),
    assignedDateFilter: TaskQueryDateNormalizedFilterSchema.optional(),
    closedDateFilter: TaskQueryDateNormalizedFilterSchema.optional(),
    activatedDateFilter: TaskQueryDateNormalizedFilterSchema.optional(),
    parentFilter: TaskQueryParentNormalizedFilterSchema.optional(),
});

/**
 * Convert an array of task query filters to a normalized representation which
 * consolidates all filters on the same fields and removes any dynamic
 * variables like the current date or current account.
 *
 * Normalized filters are useful for actually performing query execution. While
 * a list of task query filters from the UI may have repetitive terms, we may
 * not need to re-evaluate.
 */
export function normalizeTaskQueryFilters(
    filters: ReadonlyArray<TaskQueryFilter>,
    evaluationContext: TaskQueryEvaluationContext,
): {type: "Possible"; normalizedFilters: TaskQueryNormalizedFilters} | {type: "Impossible"} {
    let hasDefaultStatusFilter = true;

    const normalizedFilters: {
        -readonly [K in keyof TaskQueryNormalizedFilters]: TaskQueryNormalizedFilters[K];
    } = {
        displayStatusFilter: {
            ifOpenInactive: true,
            ifOpenActive: true,
            ifClosed: false,
        },
    };

    for (const filter of filters) {
        switch (filter.type) {
            case "DisplayStatus": {
                const normalizeResult = normalizeTaskQueryDisplayStatusFilter(filter);
                if (normalizeResult.type === "Undefined") continue;
                if (normalizeResult.type === "AlwaysFalse") return {type: "Impossible"};

                if (hasDefaultStatusFilter) {
                    normalizedFilters.displayStatusFilter = normalizeResult.filter;
                    hasDefaultStatusFilter = false;
                } else {
                    const mergeResult = mergeTaskQueryDisplayStatusFilters(
                        normalizedFilters.displayStatusFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.displayStatusFilter = mergeResult.filter;
                }
                break;
            }
            case "Collections": {
                const normalizeResult = normalizeTaskQueryCollectionsFilter(filter);
                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.collectionsFilter) {
                    normalizedFilters.collectionsFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryCollectionsFilters(
                        normalizedFilters.collectionsFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    if (mergeResult.type === "AlwaysTrue") {
                        delete normalizedFilters.collectionsFilter;
                    } else {
                        normalizedFilters.collectionsFilter = mergeResult.filter;
                    }
                }
                break;
            }
            case "Priority": {
                const normalizeResult = normalizeTaskQueryPriorityFilter(filter);
                if (normalizeResult.type === "Undefined") continue;
                if (normalizeResult.type === "AlwaysFalse") return {type: "Impossible"};

                if (!normalizedFilters.priorityFilter) {
                    normalizedFilters.priorityFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryPriorityFilters(
                        normalizedFilters.priorityFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.priorityFilter = mergeResult.filter;
                }
                break;
            }
            case "Title": {
                const newTitleFilter = [...(normalizedFilters.titleFilter ?? [])];

                // We need to analyze the title query string the same way OpenSearch (which
                // uses Lucene under the hood) would. The OpenSearch standard analyzer we use
                // splits up words based on the Unicode default word boundary specification so
                // we do as well.
                //
                // https://github.com/apache/lucene/blob/dd4e66dad6726c53f2d89c5b7bcf74216949e4d3/lucene/core/src/java/org/apache/lucene/analysis/standard/StandardTokenizerImpl.java#L26-L43
                const titleQueryWords = analyzeTaskTitleText(filter.operation.titleQuery);

                // Empty strings or strings with only whitespace do not contribute to
                // filtering. They act as if the filter doesn't exist at all.
                if (isNonEmptyReadonlyArray(titleQueryWords)) {
                    newTitleFilter.push({
                        operationType: filter.operation.type,
                        titleQuery: filter.operation.titleQuery,
                        titleQueryWords,
                    });
                }

                // Sort so that we end up with the same normalized filter array no matter what
                // order the filters were added in.
                newTitleFilter.sort((filter1, filter2) => {
                    if (filter1.operationType !== filter2.operationType) {
                        return defaultCompareStrings(filter1.operationType, filter2.operationType);
                    }
                    return compareArrays(
                        filter1.titleQueryWords,
                        filter2.titleQueryWords,
                        defaultCompareStrings,
                    );
                });

                if (isNonEmptyReadonlyArray(newTitleFilter)) {
                    normalizedFilters.titleFilter = newTitleFilter;
                } else if (normalizedFilters.titleFilter) {
                    delete normalizedFilters.titleFilter;
                }
                break;
            }
            case "Assignee": {
                const normalizeResult = normalizeTaskQueryFilterAccountOperation(
                    filter.operation,
                    evaluationContext,
                );
                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.assigneeFilter) {
                    normalizedFilters.assigneeFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryAccountNormalizedFilters(
                        normalizedFilters.assigneeFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.assigneeFilter = mergeResult.filter;
                }
                break;
            }
            case "Creator": {
                const normalizeResult = normalizeTaskQueryFilterAccountOperation(
                    filter.operation,
                    evaluationContext,
                );
                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.creatorFilter) {
                    normalizedFilters.creatorFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryAccountNormalizedFilters(
                        normalizedFilters.creatorFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.creatorFilter = mergeResult.filter;
                }
                break;
            }
            case "Assigner": {
                const normalizeResult = normalizeTaskQueryFilterAccountOperation(
                    filter.operation,
                    evaluationContext,
                );
                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.assignerFilter) {
                    normalizedFilters.assignerFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryAccountNormalizedFilters(
                        normalizedFilters.assignerFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.assignerFilter = mergeResult.filter;
                }
                break;
            }
            case "DueDate": {
                const normalizeResult:
                    | {type: "Filter"; filter: TaskQueryDateNormalizedFilter | {type: "IsEmpty"}}
                    | {type: "AlwaysTrue"} =
                    filter.operation.type === "Overdue"
                        ? {
                              type: "Filter",
                              filter: {
                                  type: "Range",
                                  exclusiveLowerBoundDate: null,
                                  exclusiveUpperBoundDate: evaluationContext.currentDate,
                              },
                          }
                        : filter.operation.type === "IsEmpty"
                          ? {type: "Filter", filter: {type: "IsEmpty"}}
                          : normalizeTaskQueryFilterDateOperation(
                                filter.operation,
                                evaluationContext,
                            );

                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.dueDateFilter) {
                    normalizedFilters.dueDateFilter = normalizeResult.filter;
                } else {
                    let mergeResult:
                        | {
                              type: "Filter";
                              filter:
                                  | TaskQueryDateNormalizedFilter
                                  | {readonly type: "IsEmpty"}
                                  | Replace<
                                        TaskQueryDateNormalizedFilter,
                                        {readonly type: "RangeOrIsEmpty"}
                                    >;
                          }
                        | {type: "AlwaysFalse"};

                    switch (normalizedFilters.dueDateFilter.type) {
                        case "Range": {
                            if (normalizeResult.filter.type === "IsEmpty") {
                                mergeResult = {type: "AlwaysFalse"};
                                break;
                            } else {
                                mergeResult = mergeTaskQueryDateNormalizedFilters(
                                    normalizedFilters.dueDateFilter,
                                    normalizeResult.filter,
                                );
                                break;
                            }
                        }
                        case "IsEmpty": {
                            if (normalizeResult.filter.type === "IsEmpty") {
                                mergeResult = {type: "Filter", filter: {type: "IsEmpty"}};
                                break;
                            } else {
                                mergeResult = {type: "AlwaysFalse"};
                                break;
                            }
                        }
                        case "RangeOrIsEmpty": {
                            if (normalizeResult.filter.type === "IsEmpty") {
                                mergeResult = {type: "Filter", filter: {type: "IsEmpty"}};
                                break;
                            } else {
                                mergeResult = mergeTaskQueryDateNormalizedFilters(
                                    {
                                        ...normalizedFilters.dueDateFilter,
                                        type: "Range",
                                    } as TaskQueryDateNormalizedFilter,
                                    normalizeResult.filter,
                                );
                                break;
                            }
                        }
                        default:
                            throw exhaustive(normalizedFilters.dueDateFilter);
                    }

                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.dueDateFilter = mergeResult.filter;
                }
                break;
            }
            case "CreatedDate": {
                const normalizeResult = normalizeTaskQueryFilterDateOperation(
                    filter.operation,
                    evaluationContext,
                );
                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.createdDateFilter) {
                    normalizedFilters.createdDateFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryDateNormalizedFilters(
                        normalizedFilters.createdDateFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.createdDateFilter = mergeResult.filter;
                }
                break;
            }
            case "AssignedDate": {
                const normalizeResult = normalizeTaskQueryFilterDateOperation(
                    filter.operation,
                    evaluationContext,
                );
                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.assignedDateFilter) {
                    normalizedFilters.assignedDateFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryDateNormalizedFilters(
                        normalizedFilters.assignedDateFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.assignedDateFilter = mergeResult.filter;
                }
                break;
            }
            case "ClosedDate": {
                const normalizeResult = normalizeTaskQueryFilterDateOperation(
                    filter.operation,
                    evaluationContext,
                );
                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.closedDateFilter) {
                    normalizedFilters.closedDateFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryDateNormalizedFilters(
                        normalizedFilters.closedDateFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.closedDateFilter = mergeResult.filter;
                }
                break;
            }
            case "ActivatedDate": {
                const normalizeResult = normalizeTaskQueryFilterDateOperation(
                    filter.operation,
                    evaluationContext,
                );
                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.activatedDateFilter) {
                    normalizedFilters.activatedDateFilter = normalizeResult.filter;
                } else {
                    const mergeResult = mergeTaskQueryDateNormalizedFilters(
                        normalizedFilters.activatedDateFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.activatedDateFilter = mergeResult.filter;
                }
                break;
            }
            default:
                throw exhaustive(filter);
        }
    }

    return {type: "Possible", normalizedFilters};
}

function normalizeTaskQueryDisplayStatusFilter(
    filter: TaskQueryDisplayStatusFilter,
):
    | {type: "Filter"; filter: TaskQueryDisplayStatusNormalizedFilter}
    | {type: "Undefined"}
    | {type: "AlwaysFalse"} {
    if (filter.operation.displayStatuses.size === 0) return {type: "Undefined"};

    let ifOpenInactive: boolean;
    let ifOpenActive: boolean;
    let ifClosed: boolean;

    switch (filter.operation.type) {
        case "OneOf": {
            ifOpenInactive = filter.operation.displayStatuses.has("OpenInactive");
            ifOpenActive = filter.operation.displayStatuses.has("OpenActive");
            ifClosed = filter.operation.displayStatuses.has("Closed");
            break;
        }
        case "NoneOf": {
            ifOpenInactive = !filter.operation.displayStatuses.has("OpenInactive");
            ifOpenActive = !filter.operation.displayStatuses.has("OpenActive");
            ifClosed = !filter.operation.displayStatuses.has("Closed");
            break;
        }
        default:
            throw exhaustive(filter.operation);
    }

    if (ifOpenInactive) {
        return {type: "Filter", filter: {ifOpenInactive, ifOpenActive, ifClosed}};
    } else if (ifOpenActive) {
        return {type: "Filter", filter: {ifOpenInactive, ifOpenActive, ifClosed}};
    } else if (ifClosed) {
        return {type: "Filter", filter: {ifOpenInactive, ifOpenActive, ifClosed}};
    } else {
        return {type: "AlwaysFalse"};
    }
}

function mergeTaskQueryDisplayStatusFilters(
    filter1: TaskQueryDisplayStatusNormalizedFilter,
    filter2: TaskQueryDisplayStatusNormalizedFilter,
): {type: "Filter"; filter: TaskQueryDisplayStatusNormalizedFilter} | {type: "AlwaysFalse"} {
    const ifOpenInactive = filter1.ifOpenInactive && filter2.ifOpenInactive;
    const ifOpenActive = filter1.ifOpenActive && filter2.ifOpenActive;
    const ifClosed = filter1.ifClosed && filter2.ifClosed;

    if (ifOpenInactive) {
        return {type: "Filter", filter: {ifOpenInactive, ifOpenActive, ifClosed}};
    } else if (ifOpenActive) {
        return {type: "Filter", filter: {ifOpenInactive, ifOpenActive, ifClosed}};
    } else if (ifClosed) {
        return {type: "Filter", filter: {ifOpenInactive, ifOpenActive, ifClosed}};
    } else {
        return {type: "AlwaysFalse"};
    }
}

function normalizeTaskQueryCollectionsFilter(
    filter: TaskQueryCollectionsFilter,
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysTrue"} {
    switch (filter.operation.type) {
        case "IsEmpty": {
            return {
                type: "Filter",
                filter: [assertNonEmptyReadonlyMap(new Map([["IsEmpty", false]]))],
            };
        }
        case "IncludesAllOf": {
            if (!isNonEmptyReadonlySet(filter.operation.collectionIds)) return {type: "AlwaysTrue"};

            return {
                type: "Filter",
                filter: assertNonEmptyReadonlyArray(
                    Array.from(filter.operation.collectionIds, collectionId =>
                        assertNonEmptyReadonlyMap(new Map([[collectionId, false]])),
                    ),
                ),
            };
        }
        case "IncludesOneOf": {
            if (!isNonEmptyReadonlySet(filter.operation.collectionIds)) return {type: "AlwaysTrue"};

            return {
                type: "Filter",
                filter: [
                    assertNonEmptyReadonlyMap(
                        new Map(
                            Array.from(filter.operation.collectionIds, collectionId => [
                                collectionId,
                                false,
                            ]),
                        ),
                    ),
                ],
            };
        }
        case "ExcludesAllOf": {
            if (!isNonEmptyReadonlySet(filter.operation.collectionIds)) return {type: "AlwaysTrue"};

            return {
                type: "Filter",
                filter: assertNonEmptyReadonlyArray(
                    Array.from(filter.operation.collectionIds, collectionId =>
                        assertNonEmptyReadonlyMap(new Map([[collectionId, true]])),
                    ),
                ),
            };
        }
        default:
            throw exhaustive(filter.operation);
    }
}

function mergeTaskQueryCollectionsFilters(
    filter1: TaskQueryCollectionsNormalizedFilter,
    filter2: TaskQueryCollectionsNormalizedFilter,
):
    | {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter}
    | {type: "AlwaysFalse"}
    | {type: "AlwaysTrue"} {
    const newFilter = [...filter1];
    const stack = [...filter2];

    while (stack.length > 0) {
        const stackClause = stack.shift()!;
        let wasStackClauseMerged = false;

        for (let i = 0; i < newFilter.length; i++) {
            const newFilterClause = newFilter[i]!;
            const result = mergeTaskQueryCollectionsFilterClauses(stackClause, newFilterClause);

            switch (result.type) {
                case "AlwaysFalse": {
                    return {type: "AlwaysFalse"};
                }
                case "Merged": {
                    newFilter.splice(i, 1);
                    stack.unshift(result.clause);
                    wasStackClauseMerged = true;
                    break;
                }
                case "Unchanged": {
                    break;
                }
                default:
                    throw exhaustive(result);
            }

            // We can exit the loop if our stack clause was merged. The merged clause is on
            // the stack so we'll revisit it.
            if (wasStackClauseMerged) {
                break;
            }
        }

        // If our stack clause was not merged then add it as-is.
        if (!wasStackClauseMerged) {
            newFilter.push(stackClause);
        }
    }

    if (!isNonEmptyReadonlyArray(newFilter)) {
        return {type: "AlwaysTrue"};
    }

    // Sort our filters so that we always return the same result no matter what
    // order the filters you pass into `normalizeTaskQueryFilters()` are in.
    newFilter.sort((a, b) => {
        return compareArrays(
            Array.from(a, ([k, v]) => `${k}-${v ? 1 : 0}`).sort(),
            Array.from(b, ([k, v]) => `${k}-${v ? 1 : 0}`).sort(),
            defaultCompareStrings,
        );
    });

    return {type: "Filter", filter: newFilter};
}

function mergeTaskQueryCollectionsFilterClauses(
    clause1: TaskQueryCollectionsNormalizedFilterClause,
    clause2: TaskQueryCollectionsNormalizedFilterClause,
):
    | {type: "AlwaysFalse"}
    | {type: "Merged"; clause: TaskQueryCollectionsNormalizedFilterClause}
    | {type: "Unchanged"} {
    // These are combined as:
    // distributedClause || (newClause1 && newClause2)
    const distributedClause = new Map<TaskCollectionId | "IsEmpty", boolean>();
    const newClause1 = new Map<TaskCollectionId | "IsEmpty", boolean>();
    const newClause2 = new Map<TaskCollectionId | "IsEmpty", boolean>(clause2);

    // Distributive law:
    // (a || b) && (a || c) === a || (b && c)
    //
    // https://en.wikipedia.org/wiki/Logical_equivalence
    for (const [term, not1] of clause1) {
        if (not1 === clause2.get(term)) {
            newClause2.delete(term);
            distributedClause.set(term, not1);
        } else {
            newClause1.set(term, not1);
        }
    }

    // Identity laws:
    // a && false === false
    //
    // https://en.wikipedia.org/wiki/Logical_equivalence
    if (newClause1.size === 0 || newClause2.size === 0) {
        if (!isNonEmptyReadonlyMap(distributedClause)) return {type: "AlwaysFalse"};
        return {type: "Merged", clause: distributedClause};
    }

    if (newClause1.size === 1 && newClause2.size === 1) {
        const [term1, not1] = assertExists(iterableFirst(newClause1));
        const [term2, not2] = assertExists(iterableFirst(newClause2));

        // Negation laws:
        // a && !a === false
        //
        // https://en.wikipedia.org/wiki/Logical_equivalence
        if (term1 === term2 && not1 !== not2) {
            if (!isNonEmptyReadonlyMap(distributedClause)) return {type: "AlwaysFalse"};
            return {type: "Merged", clause: distributedClause};
        }

        // Property specific to our terms:
        // ((collections.size === 0) && collections.has(collectionId)) === false
        if (term1 === "IsEmpty" && not1 === false && term2 !== "IsEmpty" && not2 === false) {
            if (!isNonEmptyReadonlyMap(distributedClause)) return {type: "AlwaysFalse"};
            return {type: "Merged", clause: distributedClause};
        }
        if (term2 === "IsEmpty" && not2 === false && term1 !== "IsEmpty" && not1 === false) {
            if (!isNonEmptyReadonlyMap(distributedClause)) return {type: "AlwaysFalse"};
            return {type: "Merged", clause: distributedClause};
        }

        // Property specific to our terms:
        // ((collections.size === 0) && !collections.has(collectionId)) === (collections.size === 0)
        if (term1 === "IsEmpty" && not1 === false && term2 !== "IsEmpty" && not2 === true) {
            return {
                type: "Merged",
                clause: assertNonEmptyReadonlyMap(
                    new Map(concatIterables(distributedClause, newClause1)),
                ),
            };
        }
        if (term2 === "IsEmpty" && not2 === false && term1 !== "IsEmpty" && not1 === true) {
            return {
                type: "Merged",
                clause: assertNonEmptyReadonlyMap(
                    new Map(concatIterables(distributedClause, newClause2)),
                ),
            };
        }
    }

    return {type: "Unchanged"};
}

function normalizeTaskQueryPriorityFilter(
    filter: TaskQueryPriorityFilter,
):
    | {type: "Filter"; filter: TaskQueryPriorityNormalizedFilter}
    | {type: "Undefined"}
    | {type: "AlwaysFalse"} {
    if (filter.operation.priorities.size === 0) return {type: "Undefined"};

    let ifNull: boolean;
    let ifLow: boolean;
    let ifMedium: boolean;
    let ifHigh: boolean;
    let ifUrgent: boolean;

    switch (filter.operation.type) {
        case "OneOf": {
            ifNull = filter.operation.priorities.has(null);
            ifLow = filter.operation.priorities.has("Low");
            ifMedium = filter.operation.priorities.has("Medium");
            ifHigh = filter.operation.priorities.has("High");
            ifUrgent = filter.operation.priorities.has("Urgent");
            break;
        }
        case "NoneOf": {
            ifNull = !filter.operation.priorities.has(null);
            ifLow = !filter.operation.priorities.has("Low");
            ifMedium = !filter.operation.priorities.has("Medium");
            ifHigh = !filter.operation.priorities.has("High");
            ifUrgent = !filter.operation.priorities.has("Urgent");
            break;
        }
        default:
            throw exhaustive(filter.operation);
    }

    if (ifNull) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else if (ifLow) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else if (ifMedium) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else if (ifHigh) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else if (ifUrgent) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else {
        return {type: "AlwaysFalse"};
    }
}

function mergeTaskQueryPriorityFilters(
    filter1: TaskQueryPriorityNormalizedFilter,
    filter2: TaskQueryPriorityNormalizedFilter,
): {type: "Filter"; filter: TaskQueryPriorityNormalizedFilter} | {type: "AlwaysFalse"} {
    const ifNull = filter1.ifNull && filter2.ifNull;
    const ifLow = filter1.ifLow && filter2.ifLow;
    const ifMedium = filter1.ifMedium && filter2.ifMedium;
    const ifHigh = filter1.ifHigh && filter2.ifHigh;
    const ifUrgent = filter1.ifUrgent && filter2.ifUrgent;

    if (ifNull) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else if (ifLow) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else if (ifMedium) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else if (ifHigh) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else if (ifUrgent) {
        return {type: "Filter", filter: {ifNull, ifLow, ifMedium, ifHigh, ifUrgent}};
    } else {
        return {type: "AlwaysFalse"};
    }
}

function normalizeTaskQueryFilterAccountOperation(
    operation: TaskQueryFilterAccountOperation,
    evaluationContext: TaskQueryEvaluationContext,
): {type: "Filter"; filter: TaskQueryAccountNormalizedFilter} | {type: "AlwaysTrue"} {
    const accountIds = new Set<AccountId | "MissingAccount">();

    for (const account of operation.accounts) {
        switch (account.type) {
            case "Account": {
                accountIds.add(account.accountId);
                break;
            }
            case "CurrentAccount": {
                if (evaluationContext.currentAccountId !== null) {
                    accountIds.add(evaluationContext.currentAccountId);
                }
                break;
            }
            case "MissingAccount": {
                accountIds.add("MissingAccount");
                break;
            }
            default:
                throw exhaustive(account);
        }
    }

    if (!isNonEmptyReadonlySet(accountIds)) return {type: "AlwaysTrue"};

    return {
        type: "Filter",
        filter: {
            type: operation.type,
            accountIds,
        },
    };
}

function mergeTaskQueryAccountNormalizedFilters(
    filter1: TaskQueryAccountNormalizedFilter,
    filter2: TaskQueryAccountNormalizedFilter,
): {type: "Filter"; filter: TaskQueryAccountNormalizedFilter} | {type: "AlwaysFalse"} {
    switch (filter1.type) {
        case "OneOf": {
            switch (filter2.type) {
                case "OneOf": {
                    return mergeTaskQueryAccountOneOfNormalizedFilterWithOneOfNormalizedFilter(
                        filter1,
                        filter2,
                    );
                }
                case "NoneOf": {
                    return mergeTaskQueryAccountOneOfNormalizedFilterWithNoneOfNormalizedFilter(
                        filter1,
                        filter2,
                    );
                }
                default:
                    throw exhaustive(filter2);
            }
        }
        case "NoneOf": {
            switch (filter2.type) {
                case "OneOf": {
                    return mergeTaskQueryAccountOneOfNormalizedFilterWithNoneOfNormalizedFilter(
                        filter2,
                        filter1,
                    );
                }
                case "NoneOf": {
                    return mergeTaskQueryAccountNoneOfNormalizedFilterWithNoneOfNormalizedFilter(
                        filter1,
                        filter2,
                    );
                }
                default:
                    throw exhaustive(filter2);
            }
        }
        default:
            throw exhaustive(filter1);
    }
}

function mergeTaskQueryAccountOneOfNormalizedFilterWithOneOfNormalizedFilter(
    filter1: TaskQueryAccountNormalizedFilter & {type: "OneOf"},
    filter2: TaskQueryAccountNormalizedFilter & {type: "OneOf"},
): {type: "Filter"; filter: TaskQueryAccountNormalizedFilter} | {type: "AlwaysFalse"} {
    const accountIds = intersectSets(filter1.accountIds, filter2.accountIds);
    if (!isNonEmptyReadonlySet(accountIds)) return {type: "AlwaysFalse"};
    return {type: "Filter", filter: {type: "OneOf", accountIds}};
}

function mergeTaskQueryAccountNoneOfNormalizedFilterWithNoneOfNormalizedFilter(
    filter1: TaskQueryAccountNormalizedFilter & {type: "NoneOf"},
    filter2: TaskQueryAccountNormalizedFilter & {type: "NoneOf"},
): {type: "Filter"; filter: TaskQueryAccountNormalizedFilter} | {type: "AlwaysFalse"} {
    const accountIds = assertNonEmptyReadonlySet(unionSets(filter1.accountIds, filter2.accountIds));
    return {type: "Filter", filter: {type: "NoneOf", accountIds}};
}

function mergeTaskQueryAccountOneOfNormalizedFilterWithNoneOfNormalizedFilter(
    filter1: TaskQueryAccountNormalizedFilter & {type: "OneOf"},
    filter2: TaskQueryAccountNormalizedFilter & {type: "NoneOf"},
): {type: "Filter"; filter: TaskQueryAccountNormalizedFilter} | {type: "AlwaysFalse"} {
    const accountIds = diffSets(filter1.accountIds, filter2.accountIds);
    if (!isNonEmptyReadonlySet(accountIds)) return {type: "AlwaysFalse"};
    return {type: "Filter", filter: {type: "OneOf", accountIds}};
}

function normalizeTaskQueryFilterDateOperation(
    operation: TaskQueryFilterDateOperation,
    evaluationContext: TaskQueryEvaluationContext,
): {type: "Filter"; filter: TaskQueryDateNormalizedFilter} | {type: "AlwaysTrue"} {
    const date = normalizeTaskQueryFilterDateOperationDate(operation.date, evaluationContext);
    if (date === null) return {type: "AlwaysTrue"};

    switch (operation.type) {
        case "GreaterThan": {
            return {
                type: "Filter",
                filter: {
                    type: "Range",
                    exclusiveLowerBoundDate: date,
                    exclusiveUpperBoundDate: null,
                },
            };
        }
        case "LessThan": {
            return {
                type: "Filter",
                filter: {
                    type: "Range",
                    exclusiveLowerBoundDate: null,
                    exclusiveUpperBoundDate: date,
                },
            };
        }
        default:
            throw exhaustive(operation);
    }
}

function normalizeTaskQueryFilterDateOperationDate(
    date: TaskQueryFilterDateOperationDate,
    evaluationContext: TaskQueryEvaluationContext,
): CalendarDate | null {
    switch (date.type) {
        case "Absolute":
            return date.date;
        case "RelativeToday":
            return evaluationContext.currentDate;
        case "RelativeAfterToday": {
            switch (date.duration.type) {
                case "Days":
                    return evaluationContext.currentDate.add({days: date.duration.count});
                case "Weeks":
                    return evaluationContext.currentDate.add({weeks: date.duration.count});
                case "Months":
                    return evaluationContext.currentDate.add({months: date.duration.count});
                case "Years":
                    return evaluationContext.currentDate.add({years: date.duration.count});
                default:
                    throw exhaustive(date.duration);
            }
        }
        case "RelativeBeforeToday": {
            switch (date.duration.type) {
                case "Days":
                    return evaluationContext.currentDate.subtract({days: date.duration.count});
                case "Weeks":
                    return evaluationContext.currentDate.subtract({weeks: date.duration.count});
                case "Months":
                    return evaluationContext.currentDate.subtract({months: date.duration.count});
                case "Years":
                    return evaluationContext.currentDate.subtract({years: date.duration.count});
                default:
                    throw exhaustive(date.duration);
            }
        }
        default:
            throw exhaustive(date);
    }
}

function mergeTaskQueryDateNormalizedFilters(
    filter1: TaskQueryDateNormalizedFilter,
    filter2: TaskQueryDateNormalizedFilter,
): {type: "Filter"; filter: TaskQueryDateNormalizedFilter} | {type: "AlwaysFalse"} {
    const exclusiveLowerBoundDate =
        filter1.exclusiveLowerBoundDate !== null && filter2.exclusiveLowerBoundDate !== null
            ? maxDate(filter1.exclusiveLowerBoundDate, filter2.exclusiveLowerBoundDate)
            : (filter1.exclusiveLowerBoundDate ?? filter2.exclusiveLowerBoundDate);

    const exclusiveUpperBoundDate =
        filter1.exclusiveUpperBoundDate !== null && filter2.exclusiveUpperBoundDate !== null
            ? minDate(filter1.exclusiveUpperBoundDate, filter2.exclusiveUpperBoundDate)
            : (filter1.exclusiveUpperBoundDate ?? filter2.exclusiveUpperBoundDate);

    if (
        exclusiveLowerBoundDate !== null &&
        exclusiveUpperBoundDate !== null &&
        exclusiveLowerBoundDate.compare(exclusiveUpperBoundDate) >= 0
    ) {
        return {type: "AlwaysFalse"};
    }

    if (exclusiveLowerBoundDate) {
        return {
            type: "Filter",
            filter: {type: "Range", exclusiveLowerBoundDate, exclusiveUpperBoundDate},
        };
    } else if (exclusiveUpperBoundDate) {
        return {
            type: "Filter",
            filter: {type: "Range", exclusiveLowerBoundDate, exclusiveUpperBoundDate},
        };
    } else {
        // Should be safe because the inputs to this function have at least one
        // non-null lower/upper bound.
        assert(false);
    }
}
