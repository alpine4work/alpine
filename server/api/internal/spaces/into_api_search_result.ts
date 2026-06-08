import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {intoApiTaskStatus} from "~/shared/api/content/into_api_task_status.js";
import {
    ApiSearchResult,
    ApiSearchResultBodyMatchItem,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {missingSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {
    SearchDynamicEntityType,
    isSearchDynamicEntityIdWithoutAccount,
    parseSearchDynamicEntityIdWithoutAccount,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";

export function intoApiSearchResult({
    model,
    bodyTextSnippet,
    parsedFilter: resultParsedFilter,
}: SearchEntityResultModel): ApiSearchResult | null {
    const bodyMatch =
        bodyTextSnippet.length > 0
            ? bodyTextSnippet.map(
                  (snippet): ApiSearchResultBodyMatchItem => ({
                      text: snippet.text,
                      ...(snippet.isHighlighted ? {isMatch: true} : {}),
                  }),
              )
            : null;

    const parsedFilter = resultParsedFilter ?? undefined;

    if (model instanceof AccountModel) {
        return {
            type: "Account",
            id: model.id,
            title: model.initialData.name,
            bodyMatch: null,
            parsedFilter,
            // NOCOMMIT: Test that `shortName` and `botId` is returned from:
            //
            // 1. `/accounts/{id}/reference`
            // 2. Search for an account
            // 3. In content reference
            shortName: getAccountShortNameWithoutFullNameTooltip(model.initialData),
            bot: model.botId !== undefined ? {id: model.botId} : undefined,
        };
    }

    assert(model instanceof SearchEntityModel);

    const searchEntityId = model.getSearchEntityId();

    // Check if this is a valid dynamic entity ID we can handle. This check helps
    // TypeScript narrow down the entity type, but in practice, we don't expect static
    // search entities (e.g. `My Tasks`) in the API search endpoint
    if (!isSearchDynamicEntityIdWithoutAccount(searchEntityId)) {
        return null;
    }

    const entity = parseSearchDynamicEntityIdWithoutAccount(searchEntityId);
    switch (entity.type) {
        case "Channel": {
            return {
                type: "Channel",
                id: entity.channelId,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
            };
        }
        case "Chat": {
            return {
                type: "Chat",
                id: entity.chatId,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
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
                id: entity.chatId,
                index: entity.messageIndex,
                title: null,
                bodyMatch,
                parsedFilter,
                author,
            };
        }
        case "Document": {
            return {
                type: "Document",
                id: entity.documentId,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
            };
        }
        case "DocumentComment": {
            assert(
                model.initialData.media?.type === "Account",
                "DocumentComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);
            assert(bodyMatch !== null);

            return {
                type: "DocumentMessage",
                id: entity.documentId,
                threadId: entity.commentThreadId,
                index: entity.commentIndex,
                title: null,
                bodyMatch,
                parsedFilter,
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
                id: entity.postId,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
                author,
            };
        }
        case "PostComment": {
            assert(
                model.initialData.media?.type === "Account",
                "PostComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);
            assert(bodyMatch !== null);

            return {
                type: "PostMessage",
                id: entity.postId,
                index: entity.commentIndex,
                title: null,
                bodyMatch,
                parsedFilter,
                author,
            };
        }
        case "Task": {
            assert(model.initialData.media?.type === "TaskDisplayStatus");

            return {
                type: "Task",
                id: entity.taskId,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
                status: intoApiTaskStatus(model.initialData.media.displayStatus),
            };
        }
        case "TaskCollection": {
            return {
                type: "TaskCollection",
                id: entity.collectionId,
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
            };
        }
        case "TaskComment": {
            assert(
                model.initialData.media?.type === "Account",
                "TaskComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);
            assert(bodyMatch !== null);

            return {
                type: "TaskMessage",
                id: entity.taskId,
                index: entity.commentIndex,
                title: null,
                bodyMatch,
                parsedFilter,
                author,
            };
        }
        case "Site": {
            // TODO(#sites): Implement site search entity support
            throw new UnimplementedError("Site search entity support is not implemented");
        }
        default:
            throw exhaustive(entity);
    }
}

function getMissingSearchEntityTitle(entity: {type: SearchDynamicEntityType}): string {
    return `${missingSearchEntityTitle} ${getSearchEntityNoun(entity.type)}`;
}
