import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {AccountId, TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskCollectionModelSearchResultSchema} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";

/**
 * Data referenced by a `TaskQueryFilter` that we need to load to render a
 * `TaskQueryFilter`.
 */
export type TaskQueryFilterReferences = SchemaType<typeof TaskQueryFilterReferencesSchema>;

export const TaskQueryFilterReferencesSchema = Schema.object({
    accountById: Schema.map(Schema.id<AccountId>(), AccountModel.schema),
    collectionResultById: Schema.map(
        Schema.id<TaskCollectionId>(),
        TaskCollectionModelSearchResultSchema,
    ),
});

export type TaskQueryFilterReferencedIds = {
    readonly accountIds: ReadonlySet<AccountId>;
    readonly collectionIds: ReadonlySet<TaskCollectionId>;
};

export const emptyTaskQueryFilterReferences: TaskQueryFilterReferences = {
    accountById: new Map(),
    collectionResultById: new Map(),
};

/**
 * Is the provided `TaskQueryFilterReferences` object empty?
 */
export function isEmptyTaskQueryFilterReferences(references: TaskQueryFilterReferences): boolean {
    // If you add more data to `TaskQueryFilterReferences` in the future, you'll need
    // to come back and update this function.
    assertEqualTypes<keyof TaskQueryFilterReferences, "accountById" | "collectionResultById">();

    return references.accountById.size === 0 && references.collectionResultById.size === 0;
}

/**
 * Merge two `TaskQueryFilterReferences` into one. References in the second object
 * will override references in the first.
 */
export function mergeTaskQueryFilterReferences(
    references1: TaskQueryFilterReferences,
    references2: TaskQueryFilterReferences,
): TaskQueryFilterReferences {
    // Optimization: Don't create a new references object for every step we receive
    // from the server with empty references.
    if (isEmptyTaskQueryFilterReferences(references1)) return references2;
    if (isEmptyTaskQueryFilterReferences(references2)) return references1;

    return {
        accountById: new Map(concatIterables(references1.accountById, references2.accountById)),
        collectionResultById: new Map(
            concatIterables(references1.collectionResultById, references2.collectionResultById),
        ),
    };
}

/**
 * Get the IDs of objects referenced by a `TaskQueryFilter`.
 */
export function getTaskQueryFilterReferencedIds(
    filter: TaskQueryFilter,
): TaskQueryFilterReferencedIds {
    const referencedIds = {
        accountIds: new Set<AccountId>(),
        collectionIds: new Set<TaskCollectionId>(),
    };

    addTaskQueryFilterReferencedIds(filter, referencedIds);

    return referencedIds;
}

/**
 * Get the IDs of objects referenced by many `TaskQueryFilter`s.
 */
export function getTaskQueryFiltersReferencedIds(
    filters: ReadonlyArray<TaskQueryFilter>,
): TaskQueryFilterReferencedIds {
    const referencedIds = {
        accountIds: new Set<AccountId>(),
        collectionIds: new Set<TaskCollectionId>(),
    };

    for (const filter of filters) {
        addTaskQueryFilterReferencedIds(filter, referencedIds);
    }

    return referencedIds;
}

function addTaskQueryFilterReferencedIds(
    filter: TaskQueryFilter,
    {accountIds, collectionIds}: {accountIds: Set<AccountId>; collectionIds: Set<TaskCollectionId>},
) {
    switch (filter.type) {
        case "DisplayStatus":
        case "Priority":
        case "Layout":
        case "Title":
        case "DueDate":
        case "CreatedDate":
        case "AssignedDate":
        case "ClosedDate":
        case "ActivatedDate": {
            // No references...
            break;
        }
        case "Collections": {
            switch (filter.operation.type) {
                case "IncludesOneOf":
                case "IncludesAllOf":
                case "ExcludesAllOf": {
                    for (const collectionId of filter.operation.collectionIds) {
                        collectionIds.add(collectionId);
                    }
                    break;
                }
                case "IsEmpty": {
                    break;
                }
                default:
                    throw exhaustive(filter.operation);
            }
            break;
        }
        case "Assignee":
        case "Creator":
        case "Assigner": {
            for (const account of filter.operation.accounts) {
                switch (account.type) {
                    case "CurrentAccount":
                    case "MissingAccount": {
                        // No references...
                        break;
                    }
                    case "Account": {
                        accountIds.add(account.accountId);
                        break;
                    }
                    default:
                        throw exhaustive(account);
                }
            }
            break;
        }
        default:
            throw exhaustive(filter);
    }
}
