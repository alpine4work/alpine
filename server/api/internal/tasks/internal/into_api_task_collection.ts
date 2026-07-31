import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getTaskQueryFilterReferences} from "~/server/tasks/data/get_task_query_filter_references.js";
import {intoApiTaskQueryFilter} from "~/shared/api/content/closed_source/into_api_task_query_filter.js";
import {intoApiTaskQuerySort} from "~/shared/api/content/closed_source/into_api_task_query_sort.js";
import {intoApiThemeColor} from "~/shared/api/content/closed_source/into_api_theme_color.js";
import {
    ApiTaskCollectionResponse,
    ApiTaskQueryDefaultsResponse,
    ApiTaskQueryFilter,
    ApiTaskQueryFilterResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskQueryDefaults} from "~/shared/tasks/task_query_defaults.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";

export async function intoApiTaskCollection(
    context: ServerActionContext,
    collection: TaskCollectionModel,
): Promise<ApiTaskCollectionResponse> {
    const defaults = collection.getDefaults();

    const references = await getTaskQueryFilterReferences(
        context.dynamo.unexpectStrongReadConsistency(),
        collection.getSpaceId(),
        defaults.filters,
    );

    return {
        id: collection.id,
        creator: collection.rawData.creator?.accountId
            ? {id: collection.rawData.creator.accountId}
            : undefined,
        name: collection.getName(),
        color: collection.getColor() ? intoApiThemeColor(collection.getColor()!) : undefined,
        defaults: intoApiTaskQueryDefaults(defaults, references),
    };
}

function intoApiTaskQueryDefaults(
    defaults: TaskQueryDefaults,
    references: TaskQueryFilterReferences,
): ApiTaskQueryDefaultsResponse {
    return {
        filters: defaults.filters.map(filter => intoApiTaskQueryFilterResponse(filter, references)),
        sorts: defaults.sorts.map(intoApiTaskQuerySort),
    };
}

function intoApiTaskQueryFilterResponse(
    originalFilter: TaskQueryFilter,
    references: TaskQueryFilterReferences,
): ApiTaskQueryFilterResponse {
    const filter: ApiTaskQueryFilter = intoApiTaskQueryFilter(originalFilter);

    switch (filter.type) {
        case "Collections": {
            if (filter.operation.type === "IsEmpty") {
                return {type: "Collections", operation: filter.operation};
            }

            return {
                type: "Collections",
                operation: {
                    type: filter.operation.type,
                    collections: filter.operation.collections.map(collection => ({
                        id: collection.id,
                        name: assertExists(
                            references.collectionResultById.get(collection.id),
                        ).collection.getName(),
                    })),
                },
            };
        }
        case "Assignee":
        case "Assigner": {
            return {
                type: filter.type,
                operation: {
                    type: filter.operation.type,
                    accounts: filter.operation.accounts.map(account =>
                        account.type === "Account"
                            ? {
                                  type: "Account",
                                  account: intoApiAccount(
                                      assertExists(references.accountById.get(account.account.id))
                                          .initialData,
                                  ),
                              }
                            : account,
                    ),
                },
            };
        }
        case "Creator": {
            return {
                type: "Creator",
                operation: {
                    type: filter.operation.type,
                    accounts: filter.operation.accounts.map(account =>
                        account.type === "Account"
                            ? {
                                  type: "Account",
                                  account: intoApiAccount(
                                      assertExists(references.accountById.get(account.account.id))
                                          .initialData,
                                  ),
                              }
                            : account,
                    ),
                },
            };
        }
        default:
            return filter;
    }
}
