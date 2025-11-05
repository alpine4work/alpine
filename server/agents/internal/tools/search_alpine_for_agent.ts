import {Link, ListItem, Paragraph, PhrasingContent} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {agentSearchAlpineResultLimitCount} from "~/server/agents/internal/agent_tool_page_sizing.js";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {
    createAgentLink,
    printEscapedMarkdownLinkLabel,
} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {printAgentLinkPath} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiMessageRoomPathObject,
    ApiPathObject,
    parseApiPath,
    printApiMessageRoomPath,
} from "~/shared/api/parse_api_path.js";
import {
    ApiAccount,
    ApiMessageRoomPath,
    ApiSearchResult,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";

import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {missingSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function searchAlpineForAgent(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient" | "room">,
    query: string,
): Promise<string> {
    const {data} = await request.apiClient.get(tracer, `/spaces/{id}/search`, {
        params: {
            path: {id: request.spaceId},
            query: {query, limit: agentSearchAlpineResultLimitCount},
        },
    });
    if (!data || data.results.length === 0) return "No results found";

    const results = data.results.filter(
        result =>
            !isApiSearchResultInConversationState(printApiMessageRoomPath(request.room), result),
    );
    if (results.length === 0) return "No results found";

    const matchedFilterToResults: Map<string, Array<ApiSearchResult>> = new Map();
    for (const result of results) {
        if (result.parsedFilter) {
            matchedFilterToResults.set(result.parsedFilter.summary, [
                ...(matchedFilterToResults.get(result.parsedFilter.summary) || []),
                result,
            ]);
        }
    }

    // Group results by whether they matched a natural language filter
    const otherResults = results.filter(result => !result.parsedFilter);

    const sections: Array<any> = [];

    // Add matching results sections if any results matched a filter
    if (matchedFilterToResults.size > 0) {
        for (const [filterText, results] of matchedFilterToResults.entries()) {
            const matchingListItems = await runAllPromises(
                results.map(result => getOrderedListItemForSearchEntityResult(transaction, result)),
            );

            sections.push(
                {
                    type: "heading",
                    depth: 1,
                    children: [{type: "text", value: "Matching results"}],
                },
                {
                    type: "paragraph",
                    children: [
                        {
                            type: "text",
                            value: `The following search results are all ${filterText}.`,
                        },
                    ],
                },
                {
                    type: "list",
                    ordered: true,
                    children: matchingListItems,
                },
            );
        }
    }

    // Add other results section if there are non-matching results
    if (otherResults.length > 0) {
        const otherListItems = await runAllPromises(
            otherResults.map(result =>
                getOrderedListItemForSearchEntityResult(transaction, result),
            ),
        );
        const matchFilterSuperset =
            matchedFilterToResults.size > 0
                ? joinPrettyConjunctionList(Array.from(matchedFilterToResults.keys()), "or")
                : null;

        sections.push(
            {
                type: "heading",
                depth: 1,
                children: [{type: "text", value: "Other results"}],
            },
            {
                type: "paragraph",
                children: [
                    {
                        type: "text",
                        value:
                            matchFilterSuperset !== null
                                ? // eslint-disable-next-line string-quotes
                                  `The following search results are _not_ ${matchFilterSuperset} but Alpine thought might be relevant anyway. Use your best judgement when determining if they're actually useful for responding to the user's request.`
                                : "The following search results matched the keyword search but did not match any specific filters.",
                    },
                ],
            },
            {
                type: "list",
                ordered: true,
                children: otherListItems,
            },
        );
    }

    return printMarkdownTree({
        type: "root",
        children: sections,
    });
}

async function getOrderedListItemForSearchEntityResult(
    transaction: DurableObjectTransaction,
    result: ApiSearchResult,
): Promise<ListItem> {
    const pathObject = parseApiPath(result.path);
    switch (result.type) {
        case "Account": {
            assert(pathObject.type === "Account");
            const accountLink = await createAgentLink(transaction, {
                type: "Account",
                account: {
                    id: pathObject.accountId,
                    name: result.title,
                },
            });

            return createListItemWithSnippet(accountLink, result);
        }
        case "Channel": {
            assert(pathObject.type === "Channel");
            const channelLink = await createAgentLink(transaction, {
                type: "Channel",
                channel: {
                    id: pathObject.channelId,
                    name: result.title,
                },
            });

            return createListItemWithSnippet(channelLink, result);
        }
        case "Document": {
            assert(pathObject.type === "Document");
            const documentLink = await createAgentLink(transaction, {
                type: "Document",
                document: {
                    id: pathObject.documentId,
                    title: result.title,
                },
            });

            return createListItemWithSnippet(documentLink, result);
        }
        case "Post": {
            assert(pathObject.type === "Post");
            const postLink = await createAgentLink(transaction, {
                type: "Post",
                post: {
                    id: pathObject.postId,
                    contentPreview: result.title,
                },
            });

            return createListItemWithSnippet(postLink, result);
        }
        case "Task": {
            assert(pathObject.type === "Task");
            const taskLink = await createAgentLink(transaction, {
                type: "Task",
                task: {
                    id: pathObject.taskId,
                    title: result.title,
                },
            });

            return createListItemWithSnippet(taskLink, result);
        }
        case "TaskCollection": {
            assert(pathObject.type === "TaskCollection");
            const taskCollectionLink = await createAgentLink(transaction, {
                type: "TaskCollection",
                taskCollection: {
                    id: pathObject.collectionId,
                    name: result.title,
                },
            });

            return createListItemWithSnippet(taskCollectionLink, result);
        }
        case "PostMessage": {
            assert(pathObject.type === "PostComment");

            const postCommentsLink = await createAgentLink(transaction, {
                type: "PostComment",
                postId: pathObject.postId,
                commentIndex: pathObject.commentIndex,
                // TODO(ifitzsimmons, #ai): Truncate match content to build `preview`
                // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/7ekqemr523z5tjhskead8hxeqc
                preview: printMissingSearchEntityTitleForMessage(result.type, result.author),
            });

            return createListItemWithSnippet(postCommentsLink, result);
        }
        case "Chat": {
            assert(pathObject.type === "Chat");
            const chatLink = await createAgentLink(transaction, {
                type: "Chat",
                chatId: pathObject.chatId,
                name: result.title,
            });

            return createListItemWithSnippet(chatLink, result);
        }
        case "ChatMessage": {
            assert(pathObject.type === "ChatMessage");

            const chatMessageLink = await createAgentLink(transaction, {
                type: "ChatMessage",
                chatId: pathObject.chatId,
                messageIndex: pathObject.messageIndex,
                // TODO(ifitzsimmons, #ai): Truncate match content to build `preview`
                // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/7ekqemr523z5tjhskead8hxeqc
                preview: printMissingSearchEntityTitleForMessage(result.type, result.author),
            });

            return createListItemWithSnippet(chatMessageLink, result);
        }
        case "DocumentMessage": {
            assert(pathObject.type === "DocumentComment");

            const documentCommentLink = await createAgentLink(transaction, {
                type: "DocumentComment",
                documentId: pathObject.documentId,
                commentThreadId: pathObject.commentThreadId,
                commentIndex: pathObject.commentIndex,
                // TODO(ifitzsimmons, #ai): Truncate match content to build `preview`
                // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/7ekqemr523z5tjhskead8hxeqc
                preview: printMissingSearchEntityTitleForMessage(result.type, result.author),
            });

            return createListItemWithSnippet(documentCommentLink, result);
        }
        case "TaskMessage": {
            assert(pathObject.type === "TaskComment");

            const taskCommentLink = await createAgentLink(transaction, {
                type: "TaskComment",
                taskId: pathObject.taskId,
                commentIndex: pathObject.commentIndex,
                // TODO(ifitzsimmons, #ai): Truncate match content to build `preview`
                // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/7ekqemr523z5tjhskead8hxeqc
                preview: printMissingSearchEntityTitleForMessage(result.type, result.author),
            });

            return createListItemWithSnippet(taskCommentLink, result);
        }
        default:
            throw exhaustive(result);
    }
}

function createListItemWithSnippet(link: AgentLink, result: ApiSearchResult | null): ListItem {
    const linkToSearchResult: Link = {
        type: "link",
        url: printAgentLinkPath(link),
        children: [
            {
                type: "text",
                value: printEscapedMarkdownLinkLabel(link),
            },
        ],
    };

    const bodyMatchContent: Array<PhrasingContent> = result?.bodyMatch
        ? result.bodyMatch.map(({text, isMatch}) => {
              const textContent: PhrasingContent = {type: "text", value: text};
              if (!isMatch) return textContent;
              return {type: "strong", children: [textContent]};
          })
        : [];

    const bodyMatchParagraph: Paragraph | null =
        bodyMatchContent.length > 0
            ? {
                  type: "paragraph",
                  children: bodyMatchContent,
              }
            : null;

    return {
        type: "listItem",
        children: [
            {
                type: "paragraph",
                children: [linkToSearchResult],
            },
            ...(bodyMatchParagraph ? [bodyMatchParagraph] : []),
        ],
    };
}

function printMissingSearchEntityTitleForMessage(
    type: "ChatMessage" | "DocumentMessage" | "PostMessage" | "TaskMessage",
    author: ApiAccount,
): string {
    switch (type) {
        case "ChatMessage":
            return `${author.shortName}: ${missingSearchEntityTitle} chat message`;
        case "DocumentMessage":
            return `${author.shortName}: ${missingSearchEntityTitle} document comment`;
        case "PostMessage":
            return `${author.shortName}: ${missingSearchEntityTitle} post comment`;
        case "TaskMessage":
            return `${author.shortName}: ${missingSearchEntityTitle} task comment`;
        default:
            throw exhaustive(type);
    }
}

// TODO(ifitzsimmons, #ai): Right now, we load all of the messages into the agent conversation.
// Eventually, we will use pagination to load messages into the agent conversation (likely from
// the end of the conversation). When that happens, we will need to update this function such
// that it only returns `true` if the message is in the current room **and** the message is
// loaded in the conversation state.
//
// https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/w11jwcrp2asdf79nre611p48fr
function isApiSearchResultInConversationState(
    currentMessageRoomPath: ApiMessageRoomPath,
    result: ApiSearchResult,
): boolean {
    const pathObject = parseApiPath(result.path);
    const resultMessageRoomPath = intoApiMessageRoomPathFromPathIfPossible(pathObject);

    if (resultMessageRoomPath === null) {
        return false;
    } else {
        return printApiMessageRoomPath(resultMessageRoomPath) === currentMessageRoomPath;
    }
}

export function intoApiMessageRoomPathFromPathIfPossible(
    apiPath: ApiPathObject,
): ApiMessageRoomPathObject | null {
    switch (apiPath.type) {
        case "Account":
        case "Channel":
        case "Document":
        case "TaskCollection":
        // NOTE(ifitzsimmons, 2025-11-05): Tasks are not loaded with task comments, so if the
        // current conversation is occurring in task comments, there's no guarantee that the
        // task data is already loaded in the conversation.
        case "Task":
            return null;
        case "Post":
        case "PostComment":
        case "PostComments":
            return {type: "Post", postId: apiPath.postId};
        case "Chat":
        case "ChatMessage":
        case "ChatMessages":
            return {type: "Chat", chatId: apiPath.chatId};
        case "DocumentComment":
        case "DocumentCommentThread":
        case "DocumentCommentThreadComments":
            return {
                type: "DocumentCommentThread",
                documentId: apiPath.documentId,
                commentThreadId: apiPath.commentThreadId,
            };
        case "TaskComment":
        case "TaskComments":
            return {type: "Task", taskId: apiPath.taskId};
        default:
            throw exhaustive(apiPath);
    }
}
