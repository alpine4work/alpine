import {OpensearchIndexTypeFlattenedKeysType} from "~/server/opensearch/opensearch_index_type.js";
import {
    OpensearchQueryClause,
    OpensearchQueryValue,
} from "~/server/opensearch/opensearch_query_clause.js";
import {
    TaskIndexDocType,
    TaskStatusTypeIntegerMapping,
} from "~/server/tasks/data/task_index_doc.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {AccountId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskDisplayStatus,
    TaskDisplayStatusIntegerMapping,
} from "~/shared/tasks/task_display_status.js";
import {TaskLayout, TaskLayoutIntegerMapping} from "~/shared/tasks/task_layout.js";
import {TaskPriority, TaskPriorityIntegerMapping} from "~/shared/tasks/task_priority.js";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryDateNormalizedFilter,
    TaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";

// TypeScript errors here when new normalized filters are added. If you add a new
// normalized filter you should make sure to update
// `getTaskQueryNormalizedFiltersTaskIndexQueryClause()`.
assertEqualTypes<
    keyof TaskQueryNormalizedFilters,
    | "displayStatusFilter"
    | "collectionsFilter"
    | "priorityFilter"
    | "layoutFilter"
    | "titleFilter"
    | "assigneeFilter"
    | "creatorFilter"
    | "assignerFilter"
    | "dueDateFilter"
    | "createdDateFilter"
    | "assignedDateFilter"
    | "closedDateFilter"
    | "activatedDateFilter"
    | "parentFilter"
>();

type TaskIndexFlattenedKeys = OpensearchIndexTypeFlattenedKeysType<typeof TaskIndexDocType>;

/**
 * Get the OpenSearch query for the provided normalized filters.
 *
 * Returns a query using a filter context and includes standard filters for
 * searching our task index (e.g. exclude deleted tasks).
 */
export function getTaskQueryNormalizedFiltersOpensearchQueryClause(
    spaceId: SpaceId,
    filters: TaskQueryNormalizedFilters,
): OpensearchQueryClause<TaskIndexFlattenedKeys> {
    return {
        bool: {
            // OpenSearch query clauses to be used in a filter context. Query clauses in a
            // filter context may be cached.
            // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
            filter: [
                // Only return tasks in a single space.
                {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                // Never return deleted tasks.
                {term: {isDeleted: new OpensearchQueryValue(false)}},

                ...getTaskQueryNormalizedFiltersOpensearchFilterQueryClauses(filters),
            ],
        },
    };
}

/**
 * Get the OpenSearch filter query clauses for the provided normalized filters.
 * These clauses should be "and"ed together.
 *
 * These query clauses should also be executed in a filter context so OpenSearch
 * caches them.
 */
function getTaskQueryNormalizedFiltersOpensearchFilterQueryClauses(
    filters: TaskQueryNormalizedFilters,
): Array<OpensearchQueryClause<TaskIndexFlattenedKeys>> {
    const filterQueryClauses: Array<OpensearchQueryClause<TaskIndexFlattenedKeys>> = [];

    // Optimization: Use `status.value.type` when possible since that's a part of our
    // index sort. Which will make the search more efficient since we can skip over
    // documents.
    if (
        filters.displayStatusFilter.ifOpenActive &&
        filters.displayStatusFilter.ifOpenInactive &&
        !filters.displayStatusFilter.ifClosed
    ) {
        filterQueryClauses.push({
            term: {
                "status.value.type": new OpensearchQueryValue(
                    TaskStatusTypeIntegerMapping.into("Open"),
                ),
            },
        });
    } else if (
        filters.displayStatusFilter.ifClosed &&
        !filters.displayStatusFilter.ifOpenActive &&
        !filters.displayStatusFilter.ifOpenInactive
    ) {
        filterQueryClauses.push({
            term: {
                "status.value.type": new OpensearchQueryValue(
                    TaskStatusTypeIntegerMapping.into("Closed"),
                ),
            },
        });
    } else if (
        filters.displayStatusFilter.ifClosed &&
        filters.displayStatusFilter.ifOpenActive &&
        filters.displayStatusFilter.ifOpenInactive
    ) {
        // Don't add a filter clause if the task can be any status...
    } else {
        const terms: Array<TaskDisplayStatus> = [];

        if (filters.displayStatusFilter.ifOpenActive) terms.push("OpenActive");
        if (filters.displayStatusFilter.ifOpenInactive) terms.push("OpenInactive");
        if (filters.displayStatusFilter.ifClosed) terms.push("Closed");

        if (terms.length === 1) {
            filterQueryClauses.push({
                term: {
                    displayStatus: new OpensearchQueryValue(
                        TaskDisplayStatusIntegerMapping.into(terms[0]!),
                    ),
                },
            });
        } else if (terms.length > 0) {
            filterQueryClauses.push({
                terms: {
                    displayStatus: new OpensearchQueryValue(
                        terms.map(TaskDisplayStatusIntegerMapping.into),
                    ),
                },
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
                            "collections.ids": new OpensearchQueryValue(
                                assertExists(iterableFirst(clause.keys())),
                            ),
                        },
                    });
                } else {
                    filterQueryClauses.push({
                        terms: {
                            "collections.ids": new OpensearchQueryValue(Array.from(clause.keys())),
                        },
                    });
                }
                continue;
            }

            const shouldTerms = Array.from(
                clause,
                ([term, not]): OpensearchQueryClause<TaskIndexFlattenedKeys> => {
                    if (term === "IsEmpty") {
                        if (!not) {
                            return {bool: {must_not: {exists: {field: "collections.ids"}}}};
                        } else {
                            return {exists: {field: "collections.ids"}};
                        }
                    } else {
                        // NOTE(calebmer): While this is supported in theory by our normalized filter type,
                        // there's currently no way to construct this filter since you'd need to say
                        // `collections.has(collectionId) || collections.size === 0` and we don't currently
                        // have an "OR" operator.
                        //
                        // The only "OR" construction we support right now is testing for one of a few
                        // collections: `collections.has(collectionId1) || collections.has(collectionId2)`.
                        if (!not) {
                            return {
                                bool: {
                                    must_not: {
                                        term: {"collections.ids": new OpensearchQueryValue(term)},
                                    },
                                },
                            };
                        } else {
                            return {term: {"collections.ids": new OpensearchQueryValue(term)}};
                        }
                    }
                },
            );

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
                bool: {
                    must_not: {
                        term: {
                            "collections.ids": new OpensearchQueryValue(
                                excludesAllCollectionIds[0]!,
                            ),
                        },
                    },
                },
            });
        } else if (excludesAllCollectionIds.length > 0) {
            filterQueryClauses.push({
                bool: {
                    must_not: {
                        terms: {
                            "collections.ids": new OpensearchQueryValue(excludesAllCollectionIds),
                        },
                    },
                },
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
                terms: {
                    "priority.value": new OpensearchQueryValue(
                        terms.map(TaskPriorityIntegerMapping.into),
                    ),
                },
            });
        } else if (terms.length === 0) {
            filterQueryClauses.push({bool: {must_not: {exists: {field: "priority.value"}}}});
        } else {
            filterQueryClauses.push({
                bool: {
                    minimum_should_match: 1,
                    should: [
                        {
                            terms: {
                                "priority.value": new OpensearchQueryValue(
                                    terms.map(TaskPriorityIntegerMapping.into),
                                ),
                            },
                        },
                        {bool: {must_not: {exists: {field: "priority.value"}}}},
                    ],
                },
            });
        }
    }

    if (filters.layoutFilter) {
        const terms: Array<TaskLayout> = [];

        if (filters.layoutFilter.ifProject) terms.push("Project");

        if (!filters.layoutFilter.ifNull) {
            filterQueryClauses.push({
                terms: {
                    "layout.value": new OpensearchQueryValue(
                        terms.map(TaskLayoutIntegerMapping.into),
                    ),
                },
            });
        } else if (terms.length === 0) {
            filterQueryClauses.push({bool: {must_not: {exists: {field: "layout.value"}}}});
        } else {
            filterQueryClauses.push({
                bool: {
                    minimum_should_match: 1,
                    should: [
                        {
                            terms: {
                                "layout.value": new OpensearchQueryValue(
                                    terms.map(TaskLayoutIntegerMapping.into),
                                ),
                            },
                        },
                        {bool: {must_not: {exists: {field: "layout.value"}}}},
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
                                query: new OpensearchQueryValue(titleFilter.titleQuery),
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
                                        query: new OpensearchQueryValue(titleFilter.titleQuery),
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
            getTaskQueryAccountNormalizedFilterOpensearchQueryClause(
                "assignee.value.assignee.accountId",
                filters.assigneeFilter,
            ),
        );
    }

    if (filters.creatorFilter) {
        filterQueryClauses.push(
            getTaskQueryAccountNormalizedFilterOpensearchQueryClause(
                "creator.accountId",
                filters.creatorFilter,
            ),
        );
    }

    if (filters.assignerFilter) {
        filterQueryClauses.push(
            getTaskQueryAccountNormalizedFilterOpensearchQueryClause(
                "assignee.value.assigner.accountId",
                filters.assignerFilter,
            ),
        );
    }

    if (filters.dueDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterOpensearchQueryClause(
                "dueDate.value",
                filters.dueDateFilter,
            ),
        );
    }

    if (filters.createdDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterOpensearchQueryClause(
                "createdTime.setterDate",
                filters.createdDateFilter,
            ),
        );
    }

    if (filters.assignedDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterOpensearchQueryClause(
                "assignee.value.assignedTime.setterDate",
                filters.assignedDateFilter,
            ),
        );
    }

    if (filters.closedDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterOpensearchQueryClause(
                "status.value.closedTime.setterDate",
                filters.closedDateFilter,
            ),
        );
    }

    if (filters.activatedDateFilter) {
        filterQueryClauses.push(
            getTaskQueryDateNormalizedFilterOpensearchQueryClause(
                "assigneeStatus.value.activatedTime.setterDate",
                filters.activatedDateFilter,
            ),
        );
    }

    if (filters.parentFilter) {
        filterQueryClauses.push({
            term: {
                "parent.taskId.value": new OpensearchQueryValue(filters.parentFilter.parentTaskId),
            },
        });
    }

    return filterQueryClauses;
}

function getTaskQueryAccountNormalizedFilterOpensearchQueryClause(
    fieldName: TaskIndexFlattenedKeys,
    filter: TaskQueryAccountNormalizedFilter,
): OpensearchQueryClause<TaskIndexFlattenedKeys> {
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
                    ? {term: {[fieldName]: new OpensearchQueryValue(accountIds[0]!)}}
                    : {terms: {[fieldName]: new OpensearchQueryValue(accountIds)}};
            } else {
                return {
                    bool: {
                        minimum_should_match: 1,
                        should: [
                            accountIds.length === 1
                                ? {term: {[fieldName]: new OpensearchQueryValue(accountIds[0]!)}}
                                : {terms: {[fieldName]: new OpensearchQueryValue(accountIds)}},
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
                    ? {
                          bool: {
                              must_not: {
                                  term: {[fieldName]: new OpensearchQueryValue(accountIds[0]!)},
                              },
                          },
                      }
                    : {
                          bool: {
                              must_not: {
                                  terms: {[fieldName]: new OpensearchQueryValue(accountIds)},
                              },
                          },
                      };
            } else {
                return {
                    bool: {
                        must: [
                            accountIds.length === 1
                                ? {
                                      bool: {
                                          must_not: {
                                              term: {
                                                  [fieldName]: new OpensearchQueryValue(
                                                      accountIds[0]!,
                                                  ),
                                              },
                                          },
                                      },
                                  }
                                : {
                                      bool: {
                                          must_not: {
                                              terms: {
                                                  [fieldName]: new OpensearchQueryValue(accountIds),
                                              },
                                          },
                                      },
                                  },
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

function getTaskQueryDateNormalizedFilterOpensearchQueryClause(
    fieldName: TaskIndexFlattenedKeys,
    filter:
        | TaskQueryDateNormalizedFilter
        | {readonly type: "IsEmpty"}
        | Replace<TaskQueryDateNormalizedFilter, {readonly type: "RangeOrIsEmpty"}>,
): OpensearchQueryClause<TaskIndexFlattenedKeys> {
    switch (filter.type) {
        case "IsEmpty": {
            return {bool: {must_not: {exists: {field: fieldName}}}};
        }
        case "Range": {
            return {
                range: {
                    [fieldName]: {
                        gt: filter.exclusiveLowerBoundDate
                            ? new OpensearchQueryValue(
                                  filter.exclusiveLowerBoundDate.toDate("UTC").toISOString(),
                              )
                            : undefined,
                        lt: filter.exclusiveUpperBoundDate
                            ? new OpensearchQueryValue(
                                  filter.exclusiveUpperBoundDate.toDate("UTC").toISOString(),
                              )
                            : undefined,
                    },
                },
            };
        }
        case "RangeOrIsEmpty": {
            return {
                bool: {
                    minimum_should_match: 1,
                    should: [
                        {bool: {must_not: {exists: {field: fieldName}}}},
                        {
                            range: {
                                [fieldName]: {
                                    gt: filter.exclusiveLowerBoundDate
                                        ? new OpensearchQueryValue(
                                              filter.exclusiveLowerBoundDate
                                                  .toDate("UTC")
                                                  .toISOString(),
                                          )
                                        : undefined,
                                    lt: filter.exclusiveUpperBoundDate
                                        ? new OpensearchQueryValue(
                                              filter.exclusiveUpperBoundDate
                                                  .toDate("UTC")
                                                  .toISOString(),
                                          )
                                        : undefined,
                                },
                            },
                        },
                    ],
                },
            };
        }
        default:
            throw exhaustive(filter);
    }
}
