import {findSpans} from "unicode-default-word-boundary";
import {approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiSearchResultMatch,
    ApiSearchResultResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {contentMentionTextTruncatedSuffix} from "~/shared/content/truncate_content_mention_text.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
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

        bodySnippet.matches = mergeApiSearchResultMatchesSeparatedByWhitespace(
            bodySnippet.text,
            bodySnippet.matches,
        );
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
            const postTitle = model.initialData.title;

            const title =
                postTitle !== null
                    ? `${getAccountShortNameWithoutFullNameTooltip(entity.post.author.initialData)} ${postTitle}`
                    : getMissingSearchEntityTitle(entity);

            let titleMatches = createApiSearchResultTitleMatches(title, queryText);

            // HACK: Posts uniquely generate the post title from the post's body. This leads to
            // an awkward situation for our search API where if left alone `title` and
            // `bodySnippet` will have the same content. This then looks weird for anyone
            // processing API results (like our MCP search tool) because you'll see the same
            // content repeated twice if you're printing both the body snippet and title.
            //
            // So try to detect when we've matched some part of the body that's also present in
            // the title and drop that part of the body from the `bodySnippet`. Sometimes
            // dropping the fully body if the body is fully contained by the title!
            //
            // The title string and body string should be character-for-character identical in
            // most cases.
            //
            // - We write the title + body atomically when indexing a post for search so they
            //   should be based on the same data. Including the referenced channel which is
            //   also loaded and inlined by the search indexer atomically across both the title
            //   and body.
            //
            // - To print a title `createPostSearchEntityTitle()` we take a snippet of the body
            //   content (`getContentSnippet()`) and then use
            //   `printContentSingleLineTextSnippet()` to print it to a string.
            //
            // - To print the body to a string is more complicated. We use
            //   `chunkSearchContent()` to generate the markdown we index in OpenSearch for
            //   search content. Then we use `parseSearchContent()` to convert the markdown
            //   from OpenSearch back into a string. We try hard to make sure all content
            //   printed by `chunkSearchContent()` can be exactly parsed to the same thing by
            //   `parseSearchContent()` minus some meaningless details for the purpose of
            //   rendering to a string like mention or link URLs (see
            //   `chunk_search_content.test.ts`). Then after `parseSearchContent()` on the
            //   highlighted text from OpenSearch we use `printContentSingleLineTextSnippet()`
            //   to print our content back into a string.
            //
            //     So if all goes well, we end up calling `printContentSingleLineTextSnippet()`
            //     on identical content as we had when printing the title and so we should get
            //     identical strings.
            //
            //     One possible problem is that we call `parseSearchContent()` on text selected
            //     by OpenSearch using the "highlight" feature. The highlight feature truncates
            //     the body at some point before and after the matched text. This means
            //     OpenSearch might truncate essential markdown we need for
            //     `parseSearchContent()` to return identical content as what we had when
            //     printing the title. We accept this hack not working in that case, the body
            //     match will already be shifted forward a bit so it won't start at the same
            //     place as the post title anyway. _shrug_
            if (postTitle !== null && bodySnippet !== null) {
                const postTitleForBodyOverlap = postTitle.endsWith(
                    contentMentionTextTruncatedSuffix,
                )
                    ? postTitle.slice(0, -contentMentionTextTruncatedSuffix.length)
                    : postTitle;

                let dropLength = 0;
                let titleDropIndex = 0;

                for (let i1 = 0; i1 < postTitleForBodyOverlap.length; i1++) {
                    const c1 = postTitleForBodyOverlap[i1]!;

                    if (!(dropLength < bodySnippet.text.length)) break;

                    const c2 = bodySnippet.text[dropLength]!;

                    if (c1 === c2) {
                        if (dropLength === 0) titleDropIndex = i1;
                        dropLength++;
                    } else if (dropLength > 0) {
                        // If there's a character mismatch then this is an invalid drop. Cancel the loop.
                        dropLength = 0;
                        break;
                    }
                }

                if (dropLength > 0) {
                    const titleIndexOffset = title.length - postTitle.length + titleDropIndex;
                    const bodyTitleMatches = filterMapArray(bodySnippet.matches, match => {
                        const length = Math.min(match.length, dropLength - match.index);
                        if (length <= 0) return;

                        return {
                            index: titleIndexOffset + match.index,
                            length,
                        };
                    });
                    if (bodyTitleMatches.length > 0) {
                        titleMatches = mergeApiSearchResultMatchesSeparatedByWhitespace(title, [
                            ...titleMatches,
                            ...bodyTitleMatches,
                        ]);
                    }

                    if (!(dropLength < bodySnippet.text.length)) {
                        bodySnippet = null;
                    } else {
                        bodySnippet.text = bodySnippet.text.slice(dropLength);

                        bodySnippet.matches = filterMapArray(bodySnippet.matches, match => {
                            const index = match.index - dropLength;
                            if (index >= 0) return {index, length: match.length};

                            const length = match.length + index;
                            if (length <= 0) return;

                            return {index: 0, length};
                        });
                    }
                }
            }

            return {
                type: "Post",
                id: entity.post.id,
                // Posts start with "in ${channelName}: " and expect client rendering code to add
                // the post author name to the start of the title.
                title,
                titleMatches,
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

    return mergeApiSearchResultMatchesSeparatedByWhitespace(title, titleMatches);
}

function mergeApiSearchResultMatchesSeparatedByWhitespace(
    text: string,
    matches: Array<ApiSearchResultMatch>,
): Array<ApiSearchResultMatch> {
    const mergedMatches: Array<ApiSearchResultMatch> = [];

    const sortedMatches = matches.toSorted((match1, match2) => match1.index - match2.index);
    for (const match of sortedMatches) {
        const previousMatch = mergedMatches.at(-1);
        if (previousMatch === undefined) {
            mergedMatches.push(match);
            continue;
        }

        const previousMatchEndIndex = previousMatch.index + previousMatch.length;
        const matchEndIndex = match.index + match.length;
        const textBetweenMatches = text.slice(previousMatchEndIndex, match.index);

        if (
            match.index <= previousMatchEndIndex ||
            /^\p{White_Space}*$/u.test(textBetweenMatches)
        ) {
            mergedMatches[mergedMatches.length - 1] = {
                index: previousMatch.index,
                length: Math.max(previousMatchEndIndex, matchEndIndex) - previousMatch.index,
            };
        } else {
            mergedMatches.push(match);
        }
    }

    return mergedMatches;
}

function getMissingSearchEntityTitle(entity: {type: SearchDynamicEntityType}): string {
    return `${missingSearchEntityTitle} ${getSearchEntityNoun(entity.type)}`;
}
