import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {unsafelyGenerateStableChronologicalId} from "~/shared/id/chronological_id.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    SearchDynamicEntityIdObject,
    SearchEntityId,
    parseSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

export function getSearchEntityPath({
    spaceId,
    entityId,
    randomSeed,
    currentTime,
    routeLayout,
}: {
    spaceId: SpaceId;
    entityId: SearchEntityId;
    randomSeed: string;
    currentTime: Date;
    routeLayout: RouteLayout;
}): string {
    const getStableRandom = () => new StableRandom(`getSearchEntityPath:${randomSeed}`);

    switch (entityId) {
        case "CreateChatMessage": {
            return `/s/${spaceId}/chat/new`;
        }
        case "CreatePost": {
            // Make sure we use the same `draftId` consistently for the current search result
            // list.
            const draftId = unsafelyGenerateStableChronologicalId(
                getStableRandom(),
                entityId,
                currentTime.getTime(),
            );

            return `/s/${spaceId}/posts/new/${draftId}`;
        }
        case "CreateChannel": {
            return `/s/${spaceId}/channels/new?focus=none`;
        }
        case "CreateDocument": {
            // Make sure we use the same `documentId` consistently for the current search
            // result list.
            const documentId = unsafelyGenerateStableId(getStableRandom(), entityId);

            // Documents are only created once the user starts typing in them. The user doesn't
            // create a document every time they navigate to this search route.
            return `/s/${spaceId}/documents/${documentId}?create`;
        }
        case "CreateTaskCollection": {
            // Make sure we use the same `collectionId` consistently for the current search
            // result list.
            const collectionId = unsafelyGenerateStableId(getStableRandom(), entityId);

            return `/s/${spaceId}/tasks/collections/${collectionId}?create&focus=none`;
        }
        case "CreateTaskView": {
            return `/s/${spaceId}/tasks/view`;
        }
        case "CreateTask": {
            // Make sure we use the same `taskId` consistently for the current search result
            // list.
            const taskId = unsafelyGenerateStableId(getStableRandom(), entityId);

            return `/s/${spaceId}/tasks/${taskId}?create`;
        }
        case "TaskPersonal": {
            return `/s/${spaceId}/tasks`;
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks I\u2019ve created");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return `/s/${spaceId}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`;
        }
        case "TaskQueryFilteredToAssigneeIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks assigned to me");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return `/s/${spaceId}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`;
        }
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive": {
            const nameSearchParam = encodeURIComponent("Active tasks assigned to me");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenActive"]),
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "ActivatedTime",
                    direction: "Descending",
                },
            ]);

            return `/s/${spaceId}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`;
        }
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks I\u2019ve assigned to others");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Assigner",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Assignee",
                    operation: {
                        type: "NoneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return `/s/${spaceId}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`;
        }
        case "SearchFavorites": {
            return `/s/${spaceId}/favorites`;
        }
        default: {
            const entityIdObject = parseSearchDynamicEntityId(entityId);
            return getSearchDynamicEntityPath(spaceId, entityIdObject, routeLayout);
        }
    }
}

export function getSearchDynamicEntityPath(
    spaceId: SpaceId,
    entityId: SearchDynamicEntityIdObject,
    routeLayout: RouteLayout,
): string {
    switch (entityId.type) {
        case "Account": {
            // NOTE(calebmer): Eventually I'd like to have a profile page for accounts. Since
            // we don't currently have that, route to a 1:1 chat with the account.
            //
            // Though even if we had a profile page for accounts, routing to the 1:1 chat in
            // search may be more useful.
            return `/s/${spaceId}/chat/with/${entityId.accountId}`;
        }
        case "Document": {
            return `/s/${spaceId}/documents/${entityId.documentId}`;
        }
        case "DocumentComment": {
            return `/s/${spaceId}/documents/${entityId.documentId}?comments=${entityId.commentThreadId}&comment=${entityId.commentIndex}`;
        }
        case "Channel": {
            return `/s/${spaceId}/channels/${entityId.channelId}`;
        }
        case "Post": {
            return `/s/${spaceId}/posts/${entityId.postId}`;
        }
        case "PostComment": {
            return `/s/${spaceId}/posts/${entityId.postId}?comment=${entityId.commentIndex}`;
        }
        case "Chat": {
            return `/s/${spaceId}/chat/${entityId.chatId}`;
        }
        case "ChatMessage": {
            return `/s/${spaceId}/chat/${entityId.chatId}?message=${entityId.messageIndex}`;
        }
        case "Task": {
            return `/s/${spaceId}/tasks/${entityId.taskId}`;
        }
        case "TaskCollection": {
            return `/s/${spaceId}/tasks/collections/${entityId.collectionId}`;
        }
        case "TaskComment": {
            if (routeLayout !== "narrow") {
                return `/s/${spaceId}/tasks/${entityId.taskId}?comments=show&comment=${entityId.commentIndex}`;
            } else {
                return `/s/${spaceId}/tasks/${entityId.taskId}/comments?comment=${entityId.commentIndex}`;
            }
        }
        default:
            throw exhaustive(entityId);
    }
}
