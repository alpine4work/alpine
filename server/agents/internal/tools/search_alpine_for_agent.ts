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
import {parseApiPath} from "~/shared/api/parse_api_path.js";
import {
    ApiAccount,
    ApiSearchResult,
    ApiSearchResultBodyMatch,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {missingSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function searchAlpineForAgent(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient">,
    query: string,
): Promise<string> {
    const {data} = await request.apiClient.get(tracer, `/spaces/{id}/search`, {
        params: {
            path: {id: request.spaceId},
            query: {query, limit: agentSearchAlpineResultLimitCount},
        },
    });
    if (!data || data.results.length === 0) return "No results found";

    const listItems = await runAllPromises(
        data.results.map(result => getOrderedListItemForSearchEntityResult(transaction, result)),
    );

    return printMarkdownTree({
        type: "root",
        children: [
            {
                type: "list",
                ordered: true,
                children: listItems,
            },
        ],
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

            return createListItemWithSnippet(accountLink, result.bodyMatch);
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

            return createListItemWithSnippet(channelLink, result.bodyMatch);
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

            return createListItemWithSnippet(documentLink, result.bodyMatch);
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

            return createListItemWithSnippet(postLink, result.bodyMatch);
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

            return createListItemWithSnippet(taskLink, result.bodyMatch);
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

            return createListItemWithSnippet(taskCollectionLink, result.bodyMatch);
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

            return createListItemWithSnippet(postCommentsLink, result.bodyMatch);
        }
        case "Chat": {
            assert(pathObject.type === "Chat");
            const chatLink = await createAgentLink(transaction, {
                type: "Chat",
                chatId: pathObject.chatId,
                name: result.title,
            });

            return createListItemWithSnippet(chatLink, result.bodyMatch);
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

            return createListItemWithSnippet(chatMessageLink, result.bodyMatch);
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

            return createListItemWithSnippet(documentCommentLink, result.bodyMatch);
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

            return createListItemWithSnippet(taskCommentLink, result.bodyMatch);
        }
        default:
            throw exhaustive(result);
    }
}

function createListItemWithSnippet(
    link: AgentLink,
    bodyMatch: ApiSearchResultBodyMatch | null,
): ListItem {
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

    const bodyMatchContent: Array<PhrasingContent> = bodyMatch
        ? bodyMatch.map(({text, isMatch}) => {
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
