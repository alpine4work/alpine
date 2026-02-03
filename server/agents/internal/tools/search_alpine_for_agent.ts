import {Link, ListItem, Paragraph, PhrasingContent} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {agentSearchResultLimit} from "~/server/agents/internal/agent_limits.js";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {getSearchResultContentSnippetAndReturnBodyMatch} from "~/server/agents/internal/tools/get_search_result_content_snippet_and_return_body_match.js";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiMessageRoomTarget,
    ApiSearchChatMessageResult,
    ApiSearchDocumentMessageResult,
    ApiSearchPostMessageResult,
    ApiSearchResult,
    ApiSearchResultBodyMatch,
    ApiSearchTaskMessageResult,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type ApiSearchMessageResult =
    | ApiSearchChatMessageResult
    | ApiSearchTaskMessageResult
    | ApiSearchPostMessageResult
    | ApiSearchDocumentMessageResult;

export async function searchAlpineForAgent(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient" | "room">,
    query: string,
): Promise<string> {
    const {data} = await request.apiClient.get(tracer, `/spaces/{id}/search`, {
        params: {
            path: {id: request.spaceId},
            query: {query, limit: agentSearchResultLimit},
        },
    });
    if (!data || data.results.length === 0) return "No results found";

    const results = data.results.filter(
        result => !isApiSearchResultInConversationState(request.room, result),
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
        let matchedFilterNumber = 1;

        for (const [filterText, results] of matchedFilterToResults.entries()) {
            const matchingListItems = await runAllPromises(
                results.map(result => getOrderedListItemForSearchEntityResult(transaction, result)),
            );

            sections.push(
                {
                    type: "heading",
                    depth: 1,
                    children: [
                        {
                            type: "text",
                            value: `Matching results${
                                matchedFilterToResults.size > 1 ? ` ${matchedFilterNumber}` : ""
                            }`,
                        },
                    ],
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

            matchedFilterNumber++;
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

        if (matchedFilterToResults.size > 0) {
            sections.push({
                type: "heading",
                depth: 1,
                children: [{type: "text", value: "Other results"}],
            });
        }

        sections.push(
            {
                type: "paragraph",
                children: [
                    {
                        type: "text",
                        value:
                            matchFilterSuperset !== null
                                ? // eslint-disable-next-line cyberworlds/string-quotes
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
    switch (result.type) {
        case "Account": {
            const accountLink = await createAgentLink(transaction, {
                type: "Account",
                account: {
                    id: result.id,
                    name: result.title,
                },
            });

            return createListItemWithSnippet(accountLink, result);
        }
        case "Channel": {
            const channelLink = await createAgentLink(transaction, {
                type: "Channel",
                channel: {
                    id: result.id,
                    name: result.title,
                },
            });

            return createListItemWithSnippet(channelLink, result);
        }
        case "Document": {
            const documentLink = await createAgentLink(transaction, {
                type: "Document",
                document: {
                    id: result.id,
                    title: result.title,
                },
            });

            return createListItemWithSnippet(documentLink, result);
        }
        case "Post": {
            const postLink = await createAgentLink(transaction, {
                type: "Post",
                post: {
                    id: result.id,
                    contentPreview: result.title,
                },
            });

            return createListItemWithSnippet(postLink, result);
        }
        case "Task": {
            const taskLink = await createAgentLink(transaction, {
                type: "Task",
                task: {
                    id: result.id,
                    title: result.title,
                    status: result.status,
                },
            });

            return createListItemWithSnippet(taskLink, result);
        }
        case "TaskCollection": {
            const taskCollectionLink = await createAgentLink(transaction, {
                type: "TaskCollection",
                taskCollection: {
                    id: result.id,
                    name: result.title,
                },
            });

            return createListItemWithSnippet(taskCollectionLink, result);
        }
        case "Chat": {
            const chatLink = await createAgentLink(transaction, {
                type: "Chat",
                chatId: result.id,
                name: result.title,
            });

            return createListItemWithSnippet(chatLink, result);
        }
        case "ChatMessage":
        case "DocumentMessage":
        case "PostMessage":
        case "TaskMessage": {
            return createListItemForMessage(transaction, result);
        }
        default:
            throw exhaustive(result);
    }
}

async function createListItemForMessage(
    transaction: DurableObjectTransaction,
    result: ApiSearchMessageResult,
): Promise<ListItem> {
    const {preview, newBodyMatch} = getSearchResultContentSnippetAndReturnBodyMatch(result);

    const plainTextPreview = preview.map(({text}) => text).join("");
    const link = await createLinkForSearchResultMessage(transaction, result, plainTextPreview);

    const linkToSearchResult: Link = {
        type: "link",
        url: printAgentLinkPath(link),
        // Preserve bold/highlight marks in the link label for the match.
        children: intoPhrasingContent(preview),
    };
    const bodyMatchContent = intoPhrasingContent(newBodyMatch);

    return {
        type: "listItem",
        children: [
            {
                type: "paragraph",
                children: [
                    linkToSearchResult,
                    ...(bodyMatchContent.length > 0 ? bodyMatchContent : []),
                ],
            },
        ],
    };
}

function createLinkForSearchResultMessage(
    transaction: DurableObjectTransaction,
    result: ApiSearchMessageResult,
    plainTextPreview: string,
): Promise<AgentLink> {
    switch (result.type) {
        case "ChatMessage": {
            return createAgentLink(transaction, {
                type: "ChatMessage",
                chatId: result.id,
                messageIndex: result.index,
                preview: plainTextPreview,
            });
        }
        case "DocumentMessage": {
            return createAgentLink(transaction, {
                type: "DocumentComment",
                documentId: result.id,
                commentThreadId: result.threadId,
                commentIndex: result.index,
                preview: plainTextPreview,
            });
        }
        case "TaskMessage": {
            return createAgentLink(transaction, {
                type: "TaskComment",
                taskId: result.id,
                commentIndex: result.index,
                preview: plainTextPreview,
            });
        }
        case "PostMessage": {
            return createAgentLink(transaction, {
                type: "PostComment",
                postId: result.id,
                commentIndex: result.index,
                preview: plainTextPreview,
            });
        }
        default:
            throw exhaustive(result);
    }
}

function createListItemWithSnippet(link: AgentLink, result: ApiSearchResult): ListItem {
    const linkToSearchResult: Link = {
        type: "link",
        url: printAgentLinkPath(link),
        children: [{type: "text", value: printAgentPlainTextLabel(link)}],
    };

    const bodyMatchContent: Array<PhrasingContent> = intoPhrasingContent(result.bodyMatch);

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

// TODO(ifitzsimmons, #ai): Right now, we load all of the messages into the agent conversation.
// Eventually, we will use pagination to load messages into the agent conversation (likely from
// the end of the conversation). When that happens, we will need to update this function such
// that it only returns `true` if the message is in the current room **and** the message is
// loaded in the conversation state.
//
// https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/w11jwcrp2asdf79nre611p48fr
function isApiSearchResultInConversationState(
    currentMessageRoom: ApiMessageRoomTarget,
    result: ApiSearchResult,
): boolean {
    const resultMessageRoomPath = intoApiMessageRoomPathFromPathIfPossible(result);

    if (resultMessageRoomPath === null) {
        return false;
    } else {
        return isDeepEqual(resultMessageRoomPath, currentMessageRoom);
    }
}

function intoPhrasingContent(bodyMatch: ApiSearchResultBodyMatch | null): Array<PhrasingContent> {
    if (!bodyMatch) return [];

    return bodyMatch.map(({text, isMatch}) => {
        const textContent: PhrasingContent = {type: "text", value: text};
        if (!isMatch) return textContent;
        return {type: "strong", children: [textContent]};
    });
}

function intoApiMessageRoomPathFromPathIfPossible(
    apiPath: ApiSearchResult,
): ApiMessageRoomTarget | null {
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
        case "PostMessage":
            return {type: "Post", id: apiPath.id};
        case "Chat":
        case "ChatMessage":
            return {type: "Chat", id: apiPath.id};
        case "DocumentMessage":
            return {
                type: "DocumentCommentThread",
                id: apiPath.id,
                threadId: apiPath.threadId,
            };
        case "TaskMessage":
            return {type: "Task", id: apiPath.id};
        default:
            throw exhaustive(apiPath);
    }
}
