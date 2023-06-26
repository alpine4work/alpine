import {CalendarDate, maxDate, minDate} from "@internationalized/date";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {AccountId, LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {
    TaskQueryCollectionsFilter,
    TaskQueryFilter,
    TaskQueryFilterAccountOperation,
    TaskQueryFilterDateOperation,
    TaskQueryFilterDateOperationDate,
    TaskQueryPriorityFilter,
    TaskQueryStatusFilter,
} from "~/shared/tasks/task_query_filter";

type NonEmptyReadonlySet<T> = ReadonlySet<T> & {readonly _NonEmptyReadonlySet: never};

function isNonEmptyReadonlySet<T>(set: ReadonlySet<T>): set is NonEmptyReadonlySet<T> {
    return set.size > 0;
}

/**
 * Representation of a normalized filter set.
 *
 * Leverages TypeScript to make sure impossible states are actually impossible.
 */
export type TaskQueryNormalizedFilters = {
    readonly statusFilter: TaskQueryStatusNormalizedFilter;
    readonly collectionsFilter?: TaskQueryCollectionsNormalizedFilter;
    readonly priorityFilter?: TaskQueryPriorityNormalizedFilter;
    readonly assigneeFilter?: TaskQueryAccountNormalizedFilter;
    readonly creatorFilter?: TaskQueryAccountNormalizedFilter;
    readonly assignerFilter?: TaskQueryAccountNormalizedFilter;
    readonly dueDateFilter?: TaskQueryDateNormalizedFilter | {readonly type: "IsEmpty"};
    readonly createdDateFilter?: TaskQueryDateNormalizedFilter;
    readonly assignedDateFilter?: TaskQueryDateNormalizedFilter;
    readonly closedDateFilter?: TaskQueryDateNormalizedFilter;
    readonly activatedDateFilter?: TaskQueryDateNormalizedFilter;
};

// At least one of the three statuses must be included in this filter. Otherwise
// the filter is impossible.
export type TaskQueryStatusNormalizedFilter =
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

export type TaskQueryCollectionsNormalizedFilter =
    | {
          readonly type: "IncludesOneOf";
          readonly collectionIds: NonEmptyReadonlySet<LocalTaskCollectionId>;
      }
    | {
          readonly type: "IncludesAllOf";
          readonly collectionIds: NonEmptyReadonlySet<LocalTaskCollectionId>;
      }
    | {
          readonly type: "ExcludesAllOf";
          readonly collectionIds: NonEmptyReadonlySet<LocalTaskCollectionId>;
      }
    | {
          readonly type: "IsEmpty";
      };

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

export type TaskQueryAccountNormalizedFilter =
    | {
          readonly type: "OneOf";
          readonly accountIds: NonEmptyReadonlySet<AccountId | "NoAccount">;
      }
    | {
          readonly type: "NoneOf";
          readonly accountIds: NonEmptyReadonlySet<AccountId | "NoAccount">;
      };

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
    context: {
        currentAccountId: AccountId;
        currentDate: CalendarDate;
    },
): {type: "Possible"; normalizedFilters: TaskQueryNormalizedFilters} | {type: "Impossible"} {
    let hasDefaultStatusFilter = true;

    const normalizedFilters: {
        -readonly [K in keyof TaskQueryNormalizedFilters]: TaskQueryNormalizedFilters[K];
    } = {
        statusFilter: {
            ifOpenInactive: true,
            ifOpenActive: true,
            ifClosed: false,
        },
    };

    for (const filter of filters) {
        switch (filter.type) {
            case "Status": {
                const normalizeResult = normalizeTaskQueryStatusFilter(filter);
                if (normalizeResult.type === "Undefined") continue;
                if (normalizeResult.type === "AlwaysFalse") return {type: "Impossible"};

                if (hasDefaultStatusFilter) {
                    normalizedFilters.statusFilter = normalizeResult.filter;
                    hasDefaultStatusFilter = false;
                } else {
                    const mergeResult = mergeTaskQueryStatusFilters(
                        normalizedFilters.statusFilter,
                        normalizeResult.filter,
                    );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.statusFilter = mergeResult.filter;
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

                    normalizedFilters.collectionsFilter = mergeResult.filter;
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
            case "Assignee": {
                const normalizeResult = normalizeTaskQueryFilterAccountOperation(
                    filter.operation,
                    context,
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
                    context,
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
                    context,
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
                                  exclusiveLowerBoundDate: context.currentDate,
                                  exclusiveUpperBoundDate: null,
                              },
                          }
                        : filter.operation.type === "IsEmpty"
                        ? {type: "Filter", filter: {type: "IsEmpty"}}
                        : normalizeTaskQueryFilterDateOperation(filter.operation, context);

                if (normalizeResult.type === "AlwaysTrue") continue;

                if (!normalizedFilters.dueDateFilter) {
                    normalizedFilters.dueDateFilter = normalizeResult.filter;
                } else {
                    const mergeResult:
                        | {
                              type: "Filter";
                              filter: TaskQueryDateNormalizedFilter | {type: "IsEmpty"};
                          }
                        | {type: "AlwaysFalse"} =
                        normalizedFilters.dueDateFilter.type === "IsEmpty" &&
                        normalizeResult.filter.type === "IsEmpty"
                            ? {type: "Filter", filter: {type: "IsEmpty"}}
                            : normalizedFilters.dueDateFilter.type === "IsEmpty"
                            ? {type: "AlwaysFalse"}
                            : normalizeResult.filter.type === "IsEmpty"
                            ? {type: "AlwaysFalse"}
                            : mergeTaskQueryDateNormalizedFilters(
                                  normalizedFilters.dueDateFilter,
                                  normalizeResult.filter,
                              );
                    if (mergeResult.type === "AlwaysFalse") return {type: "Impossible"};

                    normalizedFilters.dueDateFilter = mergeResult.filter;
                }
                break;
            }
            case "CreatedDate": {
                const normalizeResult = normalizeTaskQueryFilterDateOperation(
                    filter.operation,
                    context,
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
                    context,
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
                    context,
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
                    context,
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

function normalizeTaskQueryStatusFilter(
    filter: TaskQueryStatusFilter,
):
    | {type: "Filter"; filter: TaskQueryStatusNormalizedFilter}
    | {type: "Undefined"}
    | {type: "AlwaysFalse"} {
    if (filter.operation.statuses.size === 0) return {type: "Undefined"};

    let ifOpenInactive: boolean;
    let ifOpenActive: boolean;
    let ifClosed: boolean;

    switch (filter.operation.type) {
        case "OneOf": {
            ifOpenInactive = filter.operation.statuses.has("OpenInactive");
            ifOpenActive = filter.operation.statuses.has("OpenActive");
            ifClosed = filter.operation.statuses.has("Closed");
            break;
        }
        case "NoneOf": {
            ifOpenInactive = !filter.operation.statuses.has("OpenInactive");
            ifOpenActive = !filter.operation.statuses.has("OpenActive");
            ifClosed = !filter.operation.statuses.has("Closed");
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

function mergeTaskQueryStatusFilters(
    filter1: TaskQueryStatusNormalizedFilter,
    filter2: TaskQueryStatusNormalizedFilter,
): {type: "Filter"; filter: TaskQueryStatusNormalizedFilter} | {type: "AlwaysFalse"} {
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
            return {type: "Filter", filter: {type: "IsEmpty"}};
        }
        case "IncludesOneOf": {
            if (!isNonEmptyReadonlySet(filter.operation.collectionIds)) return {type: "AlwaysTrue"};

            return {
                type: "Filter",
                filter: {type: "IncludesOneOf", collectionIds: filter.operation.collectionIds},
            };
        }
        case "IncludesAllOf": {
            if (!isNonEmptyReadonlySet(filter.operation.collectionIds)) return {type: "AlwaysTrue"};

            return {
                type: "Filter",
                filter: {type: "IncludesAllOf", collectionIds: filter.operation.collectionIds},
            };
        }
        case "ExcludesAllOf": {
            if (!isNonEmptyReadonlySet(filter.operation.collectionIds)) return {type: "AlwaysTrue"};

            return {
                type: "Filter",
                filter: {type: "ExcludesAllOf", collectionIds: filter.operation.collectionIds},
            };
        }
        default:
            throw exhaustive(filter.operation);
    }
}

function mergeTaskQueryCollectionsFilters(
    filter1: TaskQueryCollectionsNormalizedFilter,
    filter2: TaskQueryCollectionsNormalizedFilter,
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    switch (filter1.type) {
        case "IncludesOneOf": {
            switch (filter2.type) {
                case "IncludesOneOf": {
                    return mergeTaskQueryCollectionsIncludesOneOfFilterWithIncludesOneOfFilter(
                        filter1,
                        filter2,
                    );
                }
                case "IncludesAllOf": {
                    return mergeTaskQueryCollectionsIncludesOneOfFilterWithIncludesAllOfFilter(
                        filter1,
                        filter2,
                    );
                }
                case "ExcludesAllOf": {
                    return mergeTaskQueryCollectionsIncludesOneOfFilterWithExcludesAllOfFilter(
                        filter1,
                        filter2,
                    );
                }
                case "IsEmpty": {
                    return mergeTaskQueryCollectionsIncludesOneOfFilterWithIsEmptyFilter(
                        filter1,
                        filter2,
                    );
                }
                default:
                    throw exhaustive(filter2);
            }
        }
        case "IncludesAllOf": {
            switch (filter2.type) {
                case "IncludesOneOf": {
                    return mergeTaskQueryCollectionsIncludesOneOfFilterWithIncludesAllOfFilter(
                        filter2,
                        filter1,
                    );
                }
                case "IncludesAllOf": {
                    return mergeTaskQueryCollectionsIncludesAllOfFilterWithIncludesAllOfFilter(
                        filter1,
                        filter2,
                    );
                }
                case "ExcludesAllOf": {
                    return mergeTaskQueryCollectionsIncludesAllOfFilterWithExcludesAllOfFilter(
                        filter1,
                        filter2,
                    );
                }
                case "IsEmpty": {
                    return mergeTaskQueryCollectionsIncludesAllOfFilterWithIsEmptyFilter(
                        filter1,
                        filter2,
                    );
                }
                default:
                    throw exhaustive(filter2);
            }
        }
        case "ExcludesAllOf": {
            switch (filter2.type) {
                case "IncludesOneOf": {
                    return mergeTaskQueryCollectionsIncludesOneOfFilterWithExcludesAllOfFilter(
                        filter2,
                        filter1,
                    );
                }
                case "IncludesAllOf": {
                    return mergeTaskQueryCollectionsIncludesAllOfFilterWithExcludesAllOfFilter(
                        filter2,
                        filter1,
                    );
                }
                case "ExcludesAllOf": {
                    return mergeTaskQueryCollectionsExcludesAllOfFilterWithExcludesAllOfFilter(
                        filter1,
                        filter2,
                    );
                }
                case "IsEmpty": {
                    return mergeTaskQueryCollectionsExcludesAllOfFilterWithIsEmptyFilter(
                        filter1,
                        filter2,
                    );
                }
                default:
                    throw exhaustive(filter2);
            }
        }
        case "IsEmpty": {
            switch (filter2.type) {
                case "IncludesOneOf": {
                    return mergeTaskQueryCollectionsIncludesOneOfFilterWithIsEmptyFilter(
                        filter2,
                        filter1,
                    );
                }
                case "IncludesAllOf": {
                    return mergeTaskQueryCollectionsIncludesAllOfFilterWithIsEmptyFilter(
                        filter2,
                        filter1,
                    );
                }
                case "ExcludesAllOf": {
                    return mergeTaskQueryCollectionsExcludesAllOfFilterWithIsEmptyFilter(
                        filter2,
                        filter1,
                    );
                }
                case "IsEmpty": {
                    return mergeTaskQueryCollectionsIsEmptyFilterWithIsEmptyFilter(
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

function mergeTaskQueryCollectionsIncludesOneOfFilterWithIncludesOneOfFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "IncludesOneOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "IncludesOneOf"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    const collectionIds = intersectSets(filter1.collectionIds, filter2.collectionIds);

    if (!isNonEmptyReadonlySet(collectionIds)) {
        return {type: "AlwaysFalse"};
    }

    return {
        type: "Filter",
        filter: {
            type: "IncludesOneOf",
            collectionIds,
        },
    };
}

function mergeTaskQueryCollectionsIncludesOneOfFilterWithIncludesAllOfFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "IncludesOneOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "IncludesAllOf"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    const collectionIds = intersectSets(filter1.collectionIds, filter2.collectionIds);

    // If any of the collections in `IncludesAllOf` is not present in
    // `IncludesOneOf` then no tasks will match the two filters.
    if (collectionIds.size !== filter2.collectionIds.size) {
        return {type: "AlwaysFalse"};
    }

    return {
        type: "Filter",
        filter: {
            type: "IncludesAllOf",
            collectionIds: filter2.collectionIds,
        },
    };
}

function mergeTaskQueryCollectionsIncludesOneOfFilterWithExcludesAllOfFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "IncludesOneOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "ExcludesAllOf"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    const collectionIds = diffSets(filter1.collectionIds, filter2.collectionIds);

    if (!isNonEmptyReadonlySet(collectionIds)) {
        return {type: "AlwaysFalse"};
    }

    return {
        type: "Filter",
        filter: {
            type: "IncludesOneOf",
            collectionIds,
        },
    };
}

function mergeTaskQueryCollectionsIncludesOneOfFilterWithIsEmptyFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "IncludesOneOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "IsEmpty"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    return {type: "AlwaysFalse"};
}

function mergeTaskQueryCollectionsIncludesAllOfFilterWithIncludesAllOfFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "IncludesAllOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "IncludesAllOf"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    const largerCollectionIds =
        filter1.collectionIds.size > filter2.collectionIds.size
            ? filter1.collectionIds
            : filter2.collectionIds;
    const smallerCollectionIds =
        filter1.collectionIds.size > filter2.collectionIds.size
            ? filter2.collectionIds
            : filter1.collectionIds;

    const collectionIds = diffSets(smallerCollectionIds, largerCollectionIds);

    // If `smallerCollectionIds` is a subset of `largerCollectionIds` we may keep
    // filtering by `largerCollectionIds`. Otherwise the filters will never match.
    if (collectionIds.size === 0) {
        return {type: "AlwaysFalse"};
    }

    return {
        type: "Filter",
        filter: {
            type: "IncludesAllOf",
            collectionIds: largerCollectionIds,
        },
    };
}

function mergeTaskQueryCollectionsIncludesAllOfFilterWithExcludesAllOfFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "IncludesAllOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "ExcludesAllOf"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    const collectionIds = diffSets(filter1.collectionIds, filter2.collectionIds);

    // If `ExcludesAllOf` takes away any collections then the filter can't be
    // evaluated.
    if (collectionIds.size !== filter1.collectionIds.size) {
        return {type: "AlwaysFalse"};
    }

    return {
        type: "Filter",
        filter: {
            type: "IncludesAllOf",
            collectionIds: filter1.collectionIds,
        },
    };
}

function mergeTaskQueryCollectionsIncludesAllOfFilterWithIsEmptyFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "IncludesAllOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "IsEmpty"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    return {type: "AlwaysFalse"};
}

function mergeTaskQueryCollectionsExcludesAllOfFilterWithExcludesAllOfFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "ExcludesAllOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "ExcludesAllOf"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    return {
        type: "Filter",
        filter: {
            type: "ExcludesAllOf",
            collectionIds: unionSets(filter1.collectionIds, filter2.collectionIds),
        },
    };
}

function mergeTaskQueryCollectionsExcludesAllOfFilterWithIsEmptyFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "ExcludesAllOf"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "IsEmpty"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    return {type: "Filter", filter: filter2};
}

function mergeTaskQueryCollectionsIsEmptyFilterWithIsEmptyFilter(
    filter1: TaskQueryCollectionsNormalizedFilter & {type: "IsEmpty"},
    filter2: TaskQueryCollectionsNormalizedFilter & {type: "IsEmpty"},
): {type: "Filter"; filter: TaskQueryCollectionsNormalizedFilter} | {type: "AlwaysFalse"} {
    return {type: "Filter", filter: filter1};
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
    context: {currentAccountId: AccountId},
): {type: "Filter"; filter: TaskQueryAccountNormalizedFilter} | {type: "AlwaysTrue"} {
    const accountIds = new Set<AccountId | "NoAccount">();

    for (const account of operation.accounts) {
        switch (account.type) {
            case "Account": {
                accountIds.add(account.accountId);
                break;
            }
            case "CurrentAccount": {
                accountIds.add(context.currentAccountId);
                break;
            }
            case "NoAccount": {
                accountIds.add("NoAccount");
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
    const accountIds = unionSets(filter1.accountIds, filter2.accountIds);
    return {type: "Filter", filter: {type: "OneOf", accountIds}};
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
    context: {currentDate: CalendarDate},
): {type: "Filter"; filter: TaskQueryDateNormalizedFilter} | {type: "AlwaysTrue"} {
    const date = normalizeTaskQueryFilterDateOperationDate(operation.date, context);
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
    context: {currentDate: CalendarDate},
): CalendarDate | null {
    switch (date.type) {
        case "Absolute":
            return date.date;
        case "RelativeToday":
            return context.currentDate;
        case "RelativeAfterToday": {
            switch (date.duration.type) {
                case "Days":
                    return context.currentDate.add({days: date.duration.count});
                case "Weeks":
                    return context.currentDate.add({weeks: date.duration.count});
                case "Months":
                    return context.currentDate.add({months: date.duration.count});
                case "Years":
                    return context.currentDate.add({years: date.duration.count});
                default:
                    throw exhaustive(date.duration);
            }
        }
        case "RelativeBeforeToday": {
            switch (date.duration.type) {
                case "Days":
                    return context.currentDate.subtract({days: date.duration.count});
                case "Weeks":
                    return context.currentDate.subtract({weeks: date.duration.count});
                case "Months":
                    return context.currentDate.subtract({months: date.duration.count});
                case "Years":
                    return context.currentDate.subtract({years: date.duration.count});
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
            : filter1.exclusiveLowerBoundDate ?? filter2.exclusiveLowerBoundDate;

    const exclusiveUpperBoundDate =
        filter1.exclusiveUpperBoundDate !== null && filter2.exclusiveUpperBoundDate !== null
            ? minDate(filter1.exclusiveUpperBoundDate, filter2.exclusiveUpperBoundDate)
            : filter1.exclusiveUpperBoundDate ?? filter2.exclusiveUpperBoundDate;

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

function intersectSets<T>(set1: ReadonlySet<T>, set2: ReadonlySet<T>): Set<T> {
    const newSet = new Set<T>();

    for (const item of set1) {
        if (set2.has(item)) {
            newSet.add(item);
        }
    }

    return newSet;
}

function unionSets<T>(
    set1: NonEmptyReadonlySet<T>,
    set2: NonEmptyReadonlySet<T>,
): NonEmptyReadonlySet<T>;
function unionSets<T>(set1: ReadonlySet<T>, set2: ReadonlySet<T>): Set<T>;
function unionSets<T>(set1: ReadonlySet<T>, set2: ReadonlySet<T>): Set<T> | NonEmptyReadonlySet<T> {
    const newSet = new Set<T>();

    for (const item of set1) {
        newSet.add(item);
    }

    for (const item of set2) {
        newSet.add(item);
    }

    return newSet;
}

function diffSets<T>(set1: ReadonlySet<T>, set2: ReadonlySet<T>): Set<T> {
    const newSet = new Set<T>(set1);

    for (const item of set2) {
        newSet.delete(item);
    }

    return newSet;
}
