import {OpensearchIndexFlattenedKeysType} from "~/server/opensearch/opensearch_index_type.js";
import {OpensearchQueryClause} from "~/server/opensearch/opensearch_query_clause.js";
import {
    TaskDisplayStatusIntegerMapping,
    TaskIndexDocType,
    TaskPriorityIntegerMapping,
    TaskStatusTypeIntegerMapping,
} from "~/server/tasks/index/task_index_doc.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {AccountId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
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
    | "titleFilter"
    | "assigneeFilter"
    | "creatorFilter"
    | "assignerFilter"
    | "dueDateFilter"
    | "createdDateFilter"
    | "assignedDateFilter"
    | "closedDateFilter"
    | "activatedDateFilter"
>();

type TaskIndexFlattenedKeys = OpensearchIndexFlattenedKeysType<typeof TaskIndexDocType>;
type TaskIndexQueryClause = OpensearchQueryClause<TaskIndexFlattenedKeys>;

/**
 * Get the OpenSearch query for the provided normalized filters.
 *
 * Returns a query using a filter context and includes standard filters for
 * searching our task index (e.g. exclude deleted tasks).
 */
export function getTaskQueryNormalizedFiltersIndexQueryClause(
    spaceId: SpaceId,
    filters: TaskQueryNormalizedFilters,
): TaskIndexQueryClause {
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

                ...getTaskQueryNormalizedFiltersIndexFilterQueryClauses(filters),
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
function getTaskQueryNormalizedFiltersIndexFilterQueryClauses(
    filters: TaskQueryNormalizedFilters,
): Array<TaskIndexQueryClause> {
    const filterQueryClauses: Array<TaskIndexQueryClause> = [];

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
    } else if (
        filters.statusFilter.ifClosed &&
        filters.statusFilter.ifOpenActive &&
        filters.statusFilter.ifOpenInactive
    ) {
        // Don't add a filter clause if the task can be any status...
    } else {
        const terms: Array<TaskDisplayStatus> = [];

        if (filters.statusFilter.ifOpenActive) terms.push("OpenActive");
        if (filters.statusFilter.ifOpenInactive) terms.push("OpenInactive");
        if (filters.statusFilter.ifClosed) terms.push("Closed");

        if (terms.length === 1) {
            filterQueryClauses.push({
                term: {displayStatus: TaskDisplayStatusIntegerMapping.into(terms[0]!)},
            });
        } else if (terms.length > 0) {
            filterQueryClauses.push({
                terms: {displayStatus: terms.map(TaskDisplayStatusIntegerMapping.into)},
            });
        }
    }

    if (filters.collectionsFilter) {
        const excludesAllCollectionIds: Array<TaskCollectionId> = [];

        for (const clause of filters.collectionsFilter) {
            if (clause.size === 1) {
                const [term, not] = assertExists(iterableFirst(clause));
                if (term !== "IsEmpty" && not) {
                    excludesAllCollectionIds.push(term);
                    continue;
                }
            }

            if (iterableEvery(clause, ([term, not]) => term !== "IsEmpty" && !not)) {
                if (clause.size === 1) {
                    filterQueryClauses.push({
                        term: {
                            "collections.ids": assertExists(iterableFirst(clause.keys())),
                        },
                    });
                } else {
                    filterQueryClauses.push({
                        terms: {
                            "collections.ids": Array.from(clause.keys()),
                        },
                    });
                }
                continue;
            }

            const shouldTerms = Array.from(clause, ([term, not]): TaskIndexQueryClause => {
                if (term === "IsEmpty") {
                    if (!not) {
                        return {bool: {must_not: {exists: {field: "collections.ids"}}}};
                    } else {
                        return {exists: {field: "collections.ids"}};
                    }
                } else {
                    // NOTE(calebmer): While this is supported in theory by our normalized filter
                    // type, there's currently no way to construct this filter since you'd need to
                    // say `collections.has(collectionId) || collections.size === 0` and we don't
                    // currently have an "OR" operator.
                    //
                    // The only "OR" construction we support right now is testing for one of a few
                    // collections:
                    // `collections.has(collectionId1) || collections.has(collectionId2)`.
                    if (!not) {
                        return {bool: {must_not: {term: {"collections.ids": term}}}};
                    } else {
                        return {term: {"collections.ids": term}};
                    }
                }
            });

            if (shouldTerms.length === 1) {
                filterQueryClauses.push(shouldTerms[0]!);
            } else {
                filterQueryClauses.push({
                    bool: {
                        minimum_should_match: 1,
                        should: shouldTerms,
                    },
                });
            }
        }

        if (excludesAllCollectionIds.length === 1) {
            filterQueryClauses.push({
                bool: {must_not: {term: {"collections.ids": excludesAllCollectionIds[0]!}}},
            });
        } else if (excludesAllCollectionIds.length > 0) {
            filterQueryClauses.push({
                bool: {must_not: {terms: {"collections.ids": excludesAllCollectionIds}}},
            });
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
        } else if (terms.length === 0) {
            filterQueryClauses.push({bool: {must_not: {exists: {field: "priority.value"}}}});
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

    if (filters.titleFilter) {
        for (const titleFilter of filters.titleFilter) {
            switch (titleFilter.operationType) {
                case "Includes": {
                    filterQueryClauses.push({
                        match_phrase: {
                            "title.text": {
                                query: titleFilter.titleQuery,
                                analyzer: "standard",
                            },
                        },
                    });
                    break;
                }
                case "Excludes": {
                    filterQueryClauses.push({
                        bool: {
                            must_not: {
                                match_phrase: {
                                    "title.text": {
                                        query: titleFilter.titleQuery,
                                        analyzer: "standard",
                                    },
                                },
                            },
                        },
                    });
                    break;
                }
                default:
                    throw exhaustive(titleFilter.operationType);
            }
        }
    }

    if (filters.assigneeFilter) {
        filterQueryClauses.push(
            getTaskQueryAccountNormalizedFilterIndexQueryClause(
                "assignee.value.assignee.accountId",
                filters.assigneeFilter,
            ),
        );
    }

    if (filters.creatorFilter) {
        filterQueryClauses.push(
            getTaskQueryAccountNormalizedFilterIndexQueryClause(
                "creator.accountId",
                filters.creatorFilter,
            ),
        );
    }

    if (filters.assignerFilter) {
        filterQueryClauses.push(
            getTaskQueryAccountNormalizedFilterIndexQueryClause(
                "assignee.value.assigner.accountId",
                filters.assignerFilter,
            ),
        );
    }

    if (filters.dueDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterIndexQueryClause(
                "dueDate.value",
                filters.dueDateFilter,
            ),
        );
    }

    if (filters.createdDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterIndexQueryClause(
                "createdTime.setterDate",
                filters.createdDateFilter,
            ),
        );
    }

    if (filters.assignedDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterIndexQueryClause(
                "assignee.value.assignedTime.setterDate",
                filters.assignedDateFilter,
            ),
        );
    }

    if (filters.closedDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterIndexQueryClause(
                "status.value.closedTime.setterDate",
                filters.closedDateFilter,
            ),
        );
    }

    if (filters.activatedDateFilter) {
        // `rawAssigneeStatus` may be set even when the task itself isn't active.
        filterQueryClauses.push({
            term: {displayStatus: TaskDisplayStatusIntegerMapping.into("OpenActive")},
        });

        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterIndexQueryClause(
                "rawAssigneeStatus.value.activatedTime.setterDate",
                filters.activatedDateFilter,
            ),
        );
    }

    return filterQueryClauses;
}

function getTaskQueryAccountNormalizedFilterIndexQueryClause(
    fieldName: TaskIndexFlattenedKeys,
    filter: TaskQueryAccountNormalizedFilter,
): TaskIndexQueryClause {
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

            if (hasMissingAccount && accountIds.length === 0) {
                return {bool: {must_not: {exists: {field: fieldName}}}};
            } else if (!hasMissingAccount) {
                return accountIds.length === 1
                    ? {term: {[fieldName]: accountIds[0]!}}
                    : {terms: {[fieldName]: accountIds}};
            } else {
                return {
                    bool: {
                        minimum_should_match: 1,
                        should: [
                            accountIds.length === 1
                                ? {term: {[fieldName]: accountIds[0]!}}
                                : {terms: {[fieldName]: accountIds}},
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

            if (hasMissingAccount && accountIds.length === 0) {
                return {exists: {field: fieldName}};
            } else if (!hasMissingAccount) {
                return accountIds.length === 1
                    ? {bool: {must_not: {term: {[fieldName]: accountIds[0]!}}}}
                    : {bool: {must_not: {terms: {[fieldName]: accountIds}}}};
            } else {
                return {
                    bool: {
                        must: [
                            accountIds.length === 1
                                ? {bool: {must_not: {term: {[fieldName]: accountIds[0]!}}}}
                                : {bool: {must_not: {terms: {[fieldName]: accountIds}}}},
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

function getTaskQueryDateNormalizedFilterIndexQueryClause(
    fieldName: TaskIndexFlattenedKeys,
    filter: TaskQueryDateNormalizedFilter | {type: "IsEmpty"},
): TaskIndexQueryClause {
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
