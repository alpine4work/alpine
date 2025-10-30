import {intoApiAccount} from "~/server/api/internal/shared/into_api_account.js";
import {
    ApiSearchResult,
    ApiSearchResultBodyMatch,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {missingSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {
    isSearchDynamicEntityIdWithoutAccount,
    parseSearchDynamicEntityIdWithoutAccount,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";

export function intoApiSearchResult({
    model,
    bodyTextSnippet,
}: SearchEntityResultModel): ApiSearchResult | null {
    const bodyMatch =
        bodyTextSnippet.length > 0
            ? bodyTextSnippet.map(
                  (snippet): ApiSearchResultBodyMatch => ({
                      text: snippet.text,
                      ...(snippet.isHighlighted ? {isMatch: true} : {}),
                  }),
              )
            : null;

    if (model instanceof AccountModel) {
        return {
            type: "Account",
            path: `/accounts/${model.id}`,
            title: model.initialData.name,
            bodyMatch: null,
        };
    }

    assert(model instanceof SearchEntityModel);

    const searchEntityId = model.getSearchEntityId();

    // Check if this is a valid dynamic entity ID we can handle. This check helps
    // TypeScript narrow down the entity type, but in practice, we don't expect
    // static search entities (e.g. `My Tasks`) in the API search endpoint
    if (!isSearchDynamicEntityIdWithoutAccount(searchEntityId)) {
        return null;
    }

    const entity = parseSearchDynamicEntityIdWithoutAccount(searchEntityId);
    switch (entity.type) {
        case "Channel": {
            return {
                type: "Channel",
                path: `/channels/${entity.channelId}`,
                title: model.initialData.title ?? missingSearchEntityTitle,
                bodyMatch: null,
            };
        }
        case "Chat": {
            return {
                type: "Chat",
                path: `/chats/${entity.chatId}`,
                title: model.initialData.title ?? missingSearchEntityTitle,
                bodyMatch: null,
            };
        }
        case "ChatMessage": {
            assert(
                model.initialData.media?.type === "Account",
                "ChatMessage SearchEntityModel should have an account media object",
            );
            // look at `get_search_entity` to see which data is supposed to be there
            const author = intoApiAccount(model.initialData.media.account.initialData);
            assert(bodyMatch !== null);

            return {
                type: "ChatMessage",
                path: `/chats/${entity.chatId}/messages/${entity.messageIndex}`,
                title: null,
                bodyMatch,
                author,
            };
        }
        case "Document": {
            return {
                type: "Document",
                path: `/documents/${entity.documentId}`,
                title: model.initialData.title ?? missingSearchEntityTitle,
                bodyMatch,
            };
        }
        case "DocumentComment": {
            assert(
                model.initialData.media?.type === "Account",
                "DocumentComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);

            return {
                type: "DocumentMessage",
                path: `/documents/${entity.documentId}/threads/${entity.commentThreadId}/messages/${entity.commentIndex}`,
                title: null,
                bodyMatch,
                author,
            };
        }
        case "Post": {
            assert(
                model.initialData.media?.type === "Account",
                "Post SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);

            return {
                type: "Post",
                path: `/posts/${entity.postId}`,
                bodyMatch,
                author,
                title: model.initialData.title ?? missingSearchEntityTitle,
            };
        }
        case "PostComment": {
            assert(
                model.initialData.media?.type === "Account",
                "PostComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);

            return {
                type: "PostMessage",
                path: `/posts/${entity.postId}/messages/${entity.commentIndex}`,
                title: null,
                bodyMatch,
                author,
            };
        }
        case "Task": {
            assert(model.initialData.media?.type === "TaskDisplayStatus");

            return {
                type: "Task",
                path: `/tasks/${entity.taskId}`,
                title: model.initialData.title ?? missingSearchEntityTitle,
                bodyMatch,
                status: intoApiTaskStatus(model.initialData.media.displayStatus),
            };
        }
        case "TaskCollection": {
            return {
                type: "TaskCollection",
                path: `/task-collections/${entity.collectionId}`,
                title: model.initialData.title ?? missingSearchEntityTitle,
                bodyMatch: null,
            };
        }
        case "TaskComment": {
            assert(
                model.initialData.media?.type === "Account",
                "TaskComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);

            return {
                type: "TaskMessage",
                path: `/tasks/${entity.taskId}/messages/${entity.commentIndex}`,
                title: null,
                bodyMatch,
                author,
            };
        }
        default:
            throw exhaustive(entity);
    }
}

function intoApiTaskStatus(
    taskDisplayStatus: TaskDisplayStatus,
): {type: "Open"; isActive: boolean} | {type: "Closed"} {
    switch (taskDisplayStatus) {
        case "OpenInactive":
            return {type: "Open", isActive: false};
        case "OpenActive":
            return {type: "Open", isActive: true};
        case "Closed":
            return {type: "Closed"};
        default:
            throw exhaustive(taskDisplayStatus);
    }
}
