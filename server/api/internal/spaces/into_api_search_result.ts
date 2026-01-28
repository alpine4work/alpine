import {intoApiTaskStatus} from "~/server/api/content/into_api_task_status.js";
import {
    ApiSearchResult,
    ApiSearchResultBodyMatchItem,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
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

export function intoApiSearchResult(entity: SearchEntityResultModel): ApiSearchResult | null {
    const result = actuallyIntoApiSearchResult(entity);

    if (result === null) return null;

    // In development, make sure the properties shared across all results are in a
    // consistent order. So the JSON we send to the client is neat and pretty.
    //
    // TODO(calebmer): Maybe we should have a more generic assertion that objects
    // have the same key order as the `api_specification.yaml` JSON schema.
    if (process.env.NODE_ENV !== "production") {
        const resultEntries = Object.keys(result);

        const expectedKeys = [];

        expectedKeys.push("title");
        expectedKeys.push("bodyMatch");

        if (hasOwnProperty(result, "parsedFilter")) {
            expectedKeys.push("parsedFilter");
        }

        expectedKeys.push("type");

        if (hasOwnProperty(result, "id")) {
            expectedKeys.push("id");
        }

        assert(isDeepEqual(resultEntries.slice(0, expectedKeys.length), expectedKeys));
    }

    return result;
}

function actuallyIntoApiSearchResult({
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

    if (model instanceof AccountModel) {
        return {
            title: model.initialData.name,
            bodyMatch: null,
            type: "Account",
            id: model.id,
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

    const parsedFilter = resultParsedFilter ?? undefined;

    const entity = parseSearchDynamicEntityIdWithoutAccount(searchEntityId);
    switch (entity.type) {
        case "Channel": {
            return {
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
                type: "Channel",
                id: entity.channelId,
            };
        }
        case "Chat": {
            return {
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
                type: "Chat",
                id: entity.chatId,
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
                title: null,
                bodyMatch,
                parsedFilter,
                type: "ChatMessage",
                id: entity.chatId,
                index: entity.messageIndex,
                author,
            };
        }
        case "Document": {
            return {
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
                type: "Document",
                id: entity.documentId,
            };
        }
        case "DocumentComment": {
            assert(
                model.initialData.media?.type === "Account",
                "DocumentComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);

            return {
                title: null,
                bodyMatch,
                parsedFilter,
                type: "DocumentMessage",
                id: entity.documentId,
                threadId: entity.commentThreadId,
                index: entity.commentIndex,
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
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
                type: "Post",
                id: entity.postId,
                author,
            };
        }
        case "PostComment": {
            assert(
                model.initialData.media?.type === "Account",
                "PostComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);

            return {
                title: null,
                bodyMatch,
                parsedFilter,
                type: "PostMessage",
                id: entity.postId,
                index: entity.commentIndex,
                author,
            };
        }
        case "Task": {
            assert(model.initialData.media?.type === "TaskDisplayStatus");

            return {
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch,
                parsedFilter,
                type: "Task",
                id: entity.taskId,
                status: intoApiTaskStatus(model.initialData.media.displayStatus),
            };
        }
        case "TaskCollection": {
            return {
                title: model.initialData.title ?? getMissingSearchEntityTitle(entity),
                bodyMatch: null,
                parsedFilter,
                type: "TaskCollection",
                id: entity.collectionId,
            };
        }
        case "TaskComment": {
            assert(
                model.initialData.media?.type === "Account",
                "TaskComment SearchEntityModel should have an account media object",
            );
            const author = intoApiAccount(model.initialData.media.account.initialData);

            return {
                title: null,
                bodyMatch,
                parsedFilter,
                type: "TaskMessage",
                id: entity.taskId,
                index: entity.commentIndex,
                author,
            };
        }
        default:
            throw exhaustive(entity);
    }
}

function getMissingSearchEntityTitle(entity: {type: SearchDynamicEntityType}): string {
    return `${missingSearchEntityTitle} ${getSearchEntityNoun(entity.type)}`;
}
