import {approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiSearchResultMatch,
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

export function intoApiSearchResult(
    {model, bodyTextSnippet, parsedFilter: resultParsedFilter}: SearchEntityResultModel,
    queryText: string,
): ApiSearchResultResponse | null {
    let bodySnippet: {
        text: string;
        matches: Array<ApiSearchResultMatch>;
    } | null;

    if (bodyTextSnippet.length === 0) {
        bodySnippet = null;
    } else {
        bodySnippet = {
            text: "",
            matches: [],
        };

        let bodyIndex = 0;
        for (const {text, isHighlighted} of bodyTextSnippet) {
            bodySnippet.text += text;

            if (isHighlighted && text.length > 0) {
                bodySnippet.matches.push({index: bodyIndex, length: text.length});
            }

            bodyIndex += text.length;
        }
    }

    const parsedFilter = resultParsedFilter ?? undefined;

    if (model instanceof AccountModel) {
        const title = model.initialData.name;

        return {
            type: "Account",
            id: model.id,
            title,
            titleMatches: createApiSearchResultTitleMatches(title, queryText),
            bodySnippet: null,
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
            const title = model.initialData.title ?? getMissingSearchEntityTitle(entity);

            return {
                type: "Channel",
                id: entity.channel.id,
                title,
                titleMatches: createApiSearchResultTitleMatches(title, queryText),
                bodySnippet: null,
                parsedFilter,
            };
        }
        case "Chat": {
            const title = model.initialData.title ?? getMissingSearchEntityTitle(entity);

            return {
                type: "Chat",
                id: entity.chat.id,
                title,
                titleMatches: createApiSearchResultTitleMatches(title, queryText),
                bodySnippet: null,
                parsedFilter,
            };
        }
        case "ChatMessage": {
            // look at `get_search_entity` to see which data is supposed to be there
            assert(bodySnippet !== null);

            return {
                type: "ChatMessage",
                id: entity.message.chatId,
                index: entity.message.index,
                title: null,
                titleMatches: null,
                bodySnippet,
                parsedFilter,
                author: intoApiAccount(entity.message.author.initialData),
            };
        }
        case "Document": {
            const title = model.initialData.title ?? getMissingSearchEntityTitle(entity);

            return {
                type: "Document",
                id: entity.document.id,
                title,
                titleMatches: createApiSearchResultTitleMatches(title, queryText),
                bodySnippet,
                parsedFilter,
            };
        }
        case "DocumentComment": {
            assert(bodySnippet !== null);

            return {
                type: "DocumentMessage",
                id: entity.comment.documentId,
                threadId: entity.comment.commentThreadId,
                index: entity.comment.index,
                title: null,
                titleMatches: null,
                bodySnippet,
                parsedFilter,
                author: intoApiAccount(entity.comment.author.initialData),
            };
        }
        case "Post": {
            const title =
                model.initialData.title !== null
                    ? `${getAccountShortNameWithoutFullNameTooltip(entity.post.author.initialData)} ${model.initialData.title}`
                    : getMissingSearchEntityTitle(entity);

            return {
                type: "Post",
                id: entity.post.id,
                // Posts start with "in ${channelName}: " and expect client rendering code to add
                // the post author name to the start of the title.
                title,
                titleMatches: createApiSearchResultTitleMatches(title, queryText),
                bodySnippet,
                parsedFilter,
                author: intoApiAccount(entity.post.author.initialData),
            };
        }
        case "PostComment": {
            assert(bodySnippet !== null);

            return {
                type: "PostMessage",
                id: entity.comment.postId,
                index: entity.comment.index,
                title: null,
                titleMatches: null,
                bodySnippet,
                parsedFilter,
                author: intoApiAccount(entity.comment.author.initialData),
            };
        }
        case "Task": {
            const title = model.initialData.title ?? getMissingSearchEntityTitle(entity);

            return {
                type: "Task",
                id: entity.task.id,
                title,
                titleMatches: createApiSearchResultTitleMatches(title, queryText),
                bodySnippet,
                parsedFilter,
                status: intoApiTaskStatus(entity.task.displayStatus.value),
            };
        }
        case "TaskCollection": {
            const title = model.initialData.title ?? getMissingSearchEntityTitle(entity);

            return {
                type: "TaskCollection",
                id: entity.collection.id,
                title,
                titleMatches: createApiSearchResultTitleMatches(title, queryText),
                bodySnippet: null,
                parsedFilter,
            };
        }
        case "TaskComment": {
            assert(bodySnippet !== null);

            return {
                type: "TaskMessage",
                id: entity.comment.taskId,
                index: entity.comment.index,
                title: null,
                titleMatches: null,
                bodySnippet,
                parsedFilter,
                author: intoApiAccount(entity.comment.author.initialData),
            };
        }
        case "Site": {
            const title = model.initialData.title ?? getMissingSearchEntityTitle(entity);

            return {
                title,
                titleMatches: createApiSearchResultTitleMatches(title, queryText),
                bodySnippet: null,
                parsedFilter,
                type: "Site",
                id: entity.site.id,
            };
        }
        default:
            throw exhaustive(entity);
    }
}

function createApiSearchResultTitleMatches(
    title: string,
    queryText: string,
): Array<ApiSearchResultMatch> {
    const queryTokens = new Set(
        approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer(queryText).map(
            token => token.text,
        ),
    );

    const titleMatches: Array<ApiSearchResultMatch> = [];

    // As of 2023-12-18 our in-process highlighter doesn't have full compatibility with
    // OpenSearch's highlighter. For example, we don't support highlighting tokens that
    // would have been split up by the `word_delimiter_graph` filter and we don't
    // support highlighting typos from a fuzzy match.
    for (const token of approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer(
        title,
    )) {
        if (!queryTokens.has(token.text)) continue;

        titleMatches.push({
            index: token.sourceStartIndex,
            length: token.sourceLength,
        });
    }

    return titleMatches;
}

function getMissingSearchEntityTitle(entity: {type: SearchDynamicEntityType}): string {
    return `${missingSearchEntityTitle} ${getSearchEntityNoun(entity.type)}`;
}
