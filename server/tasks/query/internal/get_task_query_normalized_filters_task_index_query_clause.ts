import {OpensearchQueryClause} from "~/server/opensearch/opensearch_query_clause.js";
import {
    TaskDisplayStatusIntegerMapping,
    TaskPriorityIntegerMapping,
    TaskStatusTypeIntegerMapping,
} from "~/server/tasks/index/task_index_doc.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryDateNormalizedFilter,
    TaskQueryNormalizedFilters,
} from "~/shared/tasks/normalize_task_query_filters.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

// TypeScript errors here when new normalized filters are added. If you add a
// new normalized filter you should make sure to update
// `getTaskQueryNormalizedFiltersTaskIndexQueryClause()`.
assertEqualTypes<
    keyof TaskQueryNormalizedFilters,
    | "statusFilter"
    | "collectionsFilter"
    | "priorityFilter"
    | "assigneeFilter"
    | "creatorFilter"
    | "assignerFilter"
    | "dueDateFilter"
    | "createdDateFilter"
    | "assignedDateFilter"
    | "closedDateFilter"
    | "activatedDateFilter"
>();

/**
 * Get the OpenSearch query for the provided normalized filters.
 *
 * Returns a query using a filter context and includes standard filters for
 * searching our task index (e.g. exclude deleted tasks).
 */
export function getTaskQueryNormalizedFiltersTaskIndexQueryClause(
    spaceId: SpaceId,
    filters: TaskQueryNormalizedFilters,
): OpensearchQueryClause {
    return {
        bool: {
            // OpenSearch query clauses to be used in a filter context. Query clauses in
            // a filter context may be cached.
            // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
            filter: [
                // Only return tasks in a single space.
                {term: {spaceId}},
                // Never return deleted tasks.
                {term: {isDeleted: false}},

                ...getTaskQueryNormalizedFiltersTaskIndexFilterQueryClauses(filters),
            ],
        },
    };
}

/**
 * Get the OpenSearch filter query clauses for the provided normalized filters.
 * These clauses should be "and"ed together.
 *
 * These query clauses should also be executed in a filter context so
 * OpenSearch caches them.
 */
export function getTaskQueryNormalizedFiltersTaskIndexFilterQueryClauses(
    filters: TaskQueryNormalizedFilters,
): Array<OpensearchQueryClause> {
    const filterQueryClauses: Array<OpensearchQueryClause> = [];

    // Optimization: Use `status.value.type` when possible since that's a part of
    // our index sort. Which will make the search more efficient since we can skip
    // over documents.
    if (
        filters.statusFilter.ifOpenActive &&
        filters.statusFilter.ifOpenInactive &&
        !filters.statusFilter.ifClosed
    ) {
        filterQueryClauses.push({
            term: {"status.value.type": TaskStatusTypeIntegerMapping.into("Open")},
        });
    } else if (
        filters.statusFilter.ifClosed &&
        !filters.statusFilter.ifOpenActive &&
        !filters.statusFilter.ifOpenInactive
    ) {
        filterQueryClauses.push({
            term: {"status.value.type": TaskStatusTypeIntegerMapping.into("Closed")},
        });
    } else {
        const terms: Array<TaskDisplayStatus> = [];

        if (filters.statusFilter.ifOpenActive) terms.push("OpenActive");
        if (filters.statusFilter.ifOpenInactive) terms.push("OpenInactive");
        if (filters.statusFilter.ifClosed) terms.push("Closed");

        if (terms.length > 0) {
            filterQueryClauses.push({
                terms: {displayStatus: terms.map(TaskDisplayStatusIntegerMapping.into)},
            });
        }
    }

    if (filters.collectionsFilter) {
        switch (filters.collectionsFilter.type) {
            case "IncludesOneOf": {
                filterQueryClauses.push({
                    terms: {
                        "collections.ids": Array.from(filters.collectionsFilter.collectionIds),
                    },
                });
                break;
            }
            case "IncludesAllOf": {
                filterQueryClauses.push({
                    bool: {
                        must: Array.from(filters.collectionsFilter.collectionIds, collectionId => ({
                            term: {"collection.ids": collectionId},
                        })),
                    },
                });
                break;
            }
            case "ExcludesAllOf": {
                filterQueryClauses.push({
                    bool: {
                        must_not: {
                            terms: {
                                "collections.ids": Array.from(
                                    filters.collectionsFilter.collectionIds,
                                ),
                            },
                        },
                    },
                });
                break;
            }
            case "IsEmpty": {
                filterQueryClauses.push({bool: {must_not: {exists: {field: "collections.ids"}}}});
                break;
            }
            default:
                throw exhaustive(filters.collectionsFilter);
        }
    }

    if (filters.priorityFilter) {
        const terms: Array<TaskPriority> = [];

        if (filters.priorityFilter.ifLow) terms.push("Low");
        if (filters.priorityFilter.ifMedium) terms.push("Medium");
        if (filters.priorityFilter.ifHigh) terms.push("High");
        if (filters.priorityFilter.ifUrgent) terms.push("Urgent");

        if (!filters.priorityFilter.ifNull) {
            filterQueryClauses.push({
                terms: {"priority.value": terms.map(TaskPriorityIntegerMapping.into)},
            });
        } else {
            filterQueryClauses.push({
                bool: {
                    minimum_should_match: 1,
                    should: [
                        {terms: {"priority.value": terms.map(TaskPriorityIntegerMapping.into)}},
                        {bool: {must_not: {exists: {field: "priority.value"}}}},
                    ],
                },
            });
        }
    }

    if (filters.assigneeFilter) {
        filterQueryClauses.push(
            getTaskQueryAccountNormalizedFilterTaskIndexQueryClause(
                "assignee.assignee.accountId",
                filters.assigneeFilter,
            ),
        );
    }

    if (filters.creatorFilter) {
        filterQueryClauses.push(
            getTaskQueryAccountNormalizedFilterTaskIndexQueryClause(
                "creator.accountId",
                filters.creatorFilter,
            ),
        );
    }

    if (filters.assignerFilter) {
        filterQueryClauses.push(
            getTaskQueryAccountNormalizedFilterTaskIndexQueryClause(
                "assignee.assigner.accountId",
                filters.assignerFilter,
            ),
        );
    }

    if (filters.dueDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterTaskIndexQueryClause(
                "dueDate.value",
                filters.dueDateFilter,
            ),
        );
    }

    if (filters.createdDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterTaskIndexQueryClause(
                "createdTime.setterDate",
                filters.createdDateFilter,
            ),
        );
    }

    if (filters.assignedDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterTaskIndexQueryClause(
                "assignee.assignedTime.setterDate",
                filters.assignedDateFilter,
            ),
        );
    }

    if (filters.closedDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterTaskIndexQueryClause(
                "status.closedTime.setterDate",
                filters.closedDateFilter,
            ),
        );
    }

    if (filters.activatedDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterTaskIndexQueryClause(
                "assigneeStatus.activatedTime.setterDate",
                filters.activatedDateFilter,
            ),
        );
    }

    return filterQueryClauses;
}

function getTaskQueryAccountNormalizedFilterTaskIndexQueryClause(
    fieldName: string,
    filter: TaskQueryAccountNormalizedFilter,
): OpensearchQueryClause {
    switch (filter.type) {
        case "OneOf": {
            let hasMissingAccount = false;
            const accountIds: Array<AccountId> = [];

            for (const accountId of filter.accountIds) {
                if (accountId === "MissingAccount") {
                    hasMissingAccount = true;
                } else {
                    accountIds.push(accountId);
                }
            }

            if (!hasMissingAccount) {
                return {terms: {[fieldName]: accountIds}};
            } else if (hasMissingAccount && accountIds.length === 0) {
                return {bool: {must_not: {exists: {field: fieldName}}}};
            } else {
                return {
                    bool: {
                        minimum_should_match: 1,
                        should: [
                            {terms: {[fieldName]: accountIds}},
                            {bool: {must_not: {exists: {field: fieldName}}}},
                        ],
                    },
                };
            }
        }
        case "NoneOf": {
            let hasMissingAccount = false;
            const accountIds: Array<AccountId> = [];

            for (const accountId of filter.accountIds) {
                if (accountId === "MissingAccount") {
                    hasMissingAccount = true;
                } else {
                    accountIds.push(accountId);
                }
            }

            if (!hasMissingAccount) {
                return {bool: {must_not: {terms: {[fieldName]: accountIds}}}};
            } else if (hasMissingAccount && accountIds.length === 0) {
                return {exists: {field: fieldName}};
            } else {
                return {
                    bool: {
                        minimum_should_match: 1,
                        should: [
                            {bool: {must_not: {terms: {[fieldName]: accountIds}}}},
                            {exists: {field: fieldName}},
                        ],
                    },
                };
            }
        }
        default:
            throw exhaustive(filter);
    }
}

function getTaskQueryDateNormalizedFilterTaskIndexQueryClause(
    fieldName: string,
    filter: TaskQueryDateNormalizedFilter | {type: "IsEmpty"},
): OpensearchQueryClause {
    switch (filter.type) {
        case "IsEmpty": {
            return {bool: {must_not: {exists: {field: fieldName}}}};
        }
        case "Range": {
            return {
                range: {
                    [fieldName]: {
                        gt: filter.exclusiveLowerBoundDate?.toDate("UTC").toISOString(),
                        lt: filter.exclusiveUpperBoundDate?.toDate("UTC").toISOString(),
                    },
                },
            };
        }
    }
}
