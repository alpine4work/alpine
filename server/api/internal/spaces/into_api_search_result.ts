import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiSearchResultBodyMatch,
    ApiSearchResultResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {missingSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {SearchDynamicEntityType} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";

export function intoApiSearchResult({
    model,
    bodyTextSnippet,
    parsedFilter: resultParsedFilter,
}: SearchEntityResultModel): ApiSearchResultResponse | null {
    const bodyMatch =
        bodyTextSnippet.length > 0
            ? bodyTextSnippet.map((snippet): ApiSearchResultBodyMatch[number] => ({
                  text: snippet.text,
                  ...(snippet.isHighlighted ? {isMatch: true} : {}),
              }))
            : null;

    const parsedFilter = resultParsedFilter ?? undefined;

    if (model instanceof AccountModel) {
        return {
            type: "Account",
            id: model.id,
            title: model.initialData.name,
            bodyMatch: null,
            parsedFilter,
            shortName: getAccountShortNameWithoutFullNameTooltip(model.initialData),
            bot: model.botId !== undefined ? {id: model.botId} : undefined,
        };
    }

    assert(model instanceof SearchEntityModel);

    const entity = model.initialData;

    // Check if this is a valid dynamic entity ID we can handle. This check helps
    // TypeScript narrow down the entity type, but in practice, we don't expect static
    // search entities (e.g. `My Tasks`) in the API search endpoint
    if (entity.type === "Static") {
        return null;
    }

    switch (entity.type) {
        case "Channel": {
            return {
                type: "Channel",
                id: entity.channel.id,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
            };
        }
        case "Chat": {
            return {
                type: "Chat",
                id: entity.chat.id,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
            };
        }
        case "ChatMessage": {
            // look at `get_search_entity` to see which data is supposed to be there
            assert(bodyMatch !== null);

            return {
                type: "ChatMessage",
                id: entity.message.chatId,
                index: entity.message.index,
                title: null,
                bodyMatch,
                parsedFilter,
                author: intoApiAccount(entity.message.author.initialData),
            };
        }
        case "Document": {
            return {
                type: "Document",
                id: entity.document.id,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
            };
        }
        case "DocumentComment": {
            assert(bodyMatch !== null);

            return {
                type: "DocumentMessage",
                id: entity.comment.documentId,
                threadId: entity.comment.commentThreadId,
                index: entity.comment.index,
                title: null,
                bodyMatch,
                parsedFilter,
                author: intoApiAccount(entity.comment.author.initialData),
            };
        }
        case "Post": {
            return {
                type: "Post",
                id: entity.post.id,
                // NOCOMMIT: Add author name to title?
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
                author: intoApiAccount(entity.post.author.initialData),
            };
        }
        case "PostComment": {
            assert(bodyMatch !== null);

            return {
                type: "PostMessage",
                id: entity.comment.postId,
                index: entity.comment.index,
                title: null,
                bodyMatch,
                parsedFilter,
                author: intoApiAccount(entity.comment.author.initialData),
            };
        }
        case "Task": {
            return {
                type: "Task",
                id: entity.task.id,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
                status: intoApiTaskStatus(entity.task.displayStatus.value),
            };
        }
        case "TaskCollection": {
            return {
                type: "TaskCollection",
                id: entity.collection.id,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
            };
        }
        case "TaskComment": {
            assert(bodyMatch !== null);

            return {
                type: "TaskMessage",
                id: entity.comment.taskId,
                index: entity.comment.index,
                title: null,
                bodyMatch,
                parsedFilter,
                author: intoApiAccount(entity.comment.author.initialData),
            };
        }
        case "Site": {
            return {
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
                type: "Site",
                id: entity.site.id,
            };
        }
        default:
            throw exhaustive(entity);
    }
}

function getMissingSearchEntityTitle(entity: {type: SearchDynamicEntityType}): string {
    return `${missingSearchEntityTitle} ${getSearchEntityNoun(entity.type)}`;
}
