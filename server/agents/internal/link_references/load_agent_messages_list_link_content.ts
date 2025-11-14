import {Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {agentMessagePageTokenLimitCount} from "~/server/agents/internal/agent_tool_page_sizing.js";
import {AgentConversationState} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {AgentPaginatedMessagesListLink} from "~/server/agents/internal/link_references/agent_link.js";
import {
    createAgentLink,
    findAgentLinkForApiPathIfExists,
    putAgentNextMessagesPageLink,
    putAgentPreviousMessagesPageLink,
} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {parseMessagesListContentToMarkdownRoot} from "~/server/agents/internal/link_references/parse_messages_list_content_to_markdown_root.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {getAgentMessagesFromEndUntilLimitTokenCount} from "~/server/agents/internal/messages/get_agent_messages_from_end_until_token_limit_count.js";
import {getAgentMessagesFromStartUntilTokenLimitCount} from "~/server/agents/internal/messages/get_agent_messages_from_start_until_token_limit_count.js";
import {parseApiMessageRoomPath} from "~/shared/api/parse_api_path.js";
import {ApiMessageRoomPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Loads content for a list of message/comments. When paginating through a list of messages,
 * we don't provide links to already-visited pages. This means that the agent can't go backward
 * to a previous page via a `[Previous Page]()` link.
 *
 * The *only* time we'll show links to next **and** previous pages is when we're loading
 * the first "chunk" of messages. So if the agent is trying to load the page for a message
 * at index 100, we'll give it links so that it can paginate in either direction from there.
 *
 * ```markdown
 * [Previous chunk](/chat/ian-first-post-sentence?chunk=-1)
 * <-- Zeroth chunk -->
 *
 * <human name="Ian">message 1</human>
 * <bot name="GPT">message 2</bot>
 * <human name="Josh">message 3</human>
 * <human name="Rachel">message 4</human>
 *
 * <-- Zeroth chunk -->
 *
 * [Next chunk](/chat/ian-first-post-sentence?chunk=1)
 * ```
 */
export async function loadAgentMessagesListLinkContent(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: AgentConversationState;
}): Promise<Root> {
    const messages = await loadPageMessages(options);

    const preambleElements = await getPagePreambleElements(options);

    return {
        type: "root",
        children: [...preambleElements, {type: "break"}, {type: "break"}, ...messages.children],
    };
}

async function loadPageMessages(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: AgentConversationState;
}): Promise<Root> {
    const {link} = options;
    switch (link.pageInfo.from) {
        case "Start": {
            return await getMarkdownContentForPageFromStart({
                ...options,
                cursorOptions: link.pageInfo,
            });
        }
        case "Middle": {
            return getMarkdownContentForPageFromMiddle({
                ...options,
                cursorOptions: link.pageInfo,
            });
        }
        case "End": {
            return getMarkdownContentForPageFromEnd({
                ...options,
                cursorOptions: link.pageInfo,
            });
        }
        default:
            throw exhaustive(link.pageInfo);
    }
}

// For a given page of messages, we add a preamble to provide more context
// about the snippet of the conversation on the page. For example, if the
// page is a list of document comments, the preamble would include
//
// ```markdown
// Comments on [My Document](/documents/123):
//
// ...page content (messages)
//
// ```
async function getPagePreambleElements(options: {
    tracer: TracerBase;
    request: AgentWebhookRequest;
    transaction: DurableObjectTransaction;
    link: AgentPaginatedMessagesListLink;
}): Promise<Array<Root["children"][number]>> {
    const {tracer, request, transaction, link} = options;
    switch (link.type) {
        case "ChatMessages":
            return getPreambleForChatMessages(tracer, request, transaction, link);
        case "DocumentCommentThreadComments":
            return getPreambleForDocumentComments(tracer, request, transaction, link);
            break;
        case "TaskComments":
            return getPreambleForTaskComments(tracer, request, transaction, link);
        default:
            throw exhaustive(link);
    }
}

async function getMarkdownContentForPageFromStart({
    tracer,
    transaction,
    request,
    link,
    conversationState,
    cursorOptions,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: AgentConversationState;
    cursorOptions: {
        from: "Start";
        index: number;
    };
}): Promise<Root> {
    const {messages, nextCursor} = await getAgentMessagesFromStartUntilTokenLimitCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        parseApiMessageRoomPath(getMessageRoomPath(link)),
        {
            startingIndex: cursorOptions.index,
            limitTokenCount: agentMessagePageTokenLimitCount,
        },
    );

    const nextPageLink =
        nextCursor !== null
            ? await putAgentNextMessagesPageLink(transaction, link, nextCursor)
            : null;

    return parseMessagesListContentToMarkdownRoot({
        previousPageLinkString: null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages: messages,
        conversationState,
    });
}

async function getMarkdownContentForPageFromEnd({
    tracer,
    transaction,
    request,
    link,
    cursorOptions,
    conversationState,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    link: AgentPaginatedMessagesListLink;
    cursorOptions: {from: "End"; index: number};
    conversationState: AgentConversationState;
}): Promise<Root> {
    const {messages, nextCursor} = await getAgentMessagesFromEndUntilLimitTokenCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        parseApiMessageRoomPath(getMessageRoomPath(link)),
        {
            startingIndex: cursorOptions.index,
            limitTokenCount: agentMessagePageTokenLimitCount,
        },
    );

    const previousPageLink =
        nextCursor !== null
            ? await putAgentPreviousMessagesPageLink(transaction, link, nextCursor)
            : null;

    return parseMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: null,
        paginationType: link.paginationType,
        pageMessages: messages,
        conversationState,
    });
}

async function getMarkdownContentForPageFromMiddle({
    tracer,
    transaction,
    request,
    link,
    cursorOptions,
    conversationState,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    link: AgentPaginatedMessagesListLink;
    cursorOptions: {from: "Middle"; index: number};
    conversationState: AgentConversationState;
}): Promise<Root> {
    const {messages: messagesBeforeCurrent, nextCursor: pageStartIndex} =
        await getAgentMessagesFromEndUntilLimitTokenCount(
            tracer,
            transaction,
            request.apiClient,
            request.spaceId,
            parseApiMessageRoomPath(getMessageRoomPath(link)),
            {
                startingIndex: cursorOptions.index - 1,
                limitTokenCount: agentMessagePageTokenLimitCount / 2,
            },
        );

    const previousPageLink =
        pageStartIndex !== null
            ? await putAgentPreviousMessagesPageLink(transaction, link, pageStartIndex)
            : null;

    const {messages: messagesAfterCurrent, nextCursor: pageEndIndex} =
        await getAgentMessagesFromStartUntilTokenLimitCount(
            tracer,
            transaction,
            request.apiClient,
            request.spaceId,
            parseApiMessageRoomPath(getMessageRoomPath(link)),
            {
                startingIndex: cursorOptions.index,
                limitTokenCount: agentMessagePageTokenLimitCount / 2,
            },
        );

    const nextPageLink =
        pageEndIndex !== null
            ? await putAgentNextMessagesPageLink(transaction, link, pageEndIndex)
            : null;

    return parseMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages: [...messagesBeforeCurrent, ...messagesAfterCurrent],
        conversationState,
    });
}

function getMessageRoomPath(link: AgentPaginatedMessagesListLink): ApiMessageRoomPath {
    switch (link.type) {
        case "ChatMessages":
            return `/chats/${link.chatId}`;
        case "DocumentCommentThreadComments":
            return `/documents/${link.documentId}/threads/${link.commentThreadId}`;
        case "TaskComments":
            return `/tasks/${link.taskId}`;
        default:
            throw exhaustive(link);
    }
}

async function getPreambleForChatMessages(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    transaction: DurableObjectTransaction,
    link: Extract<AgentPaginatedMessagesListLink, {type: "ChatMessages"}>,
): Promise<Array<Root["children"][number]>> {
    const {
        data: {chat},
    } = await request.apiClient.get(tracer, "/chats/{id}", {
        params: {path: {id: link.chatId}},
    });

    const accountLinks = await runAllPromises(
        chat.members.map(async ({account}) => {
            const accountLink = await findAgentLinkForApiPathIfExists(
                transaction,
                `/accounts/${account.id}`,
            );
            if (accountLink) return accountLink;

            return createAgentLink(transaction, {type: "Account", account});
        }),
    );

    // TODO(ifitzsimmons, #ai): Test thoroughly.
    const accountLinkElements = accountLinks.flatMap(
        (accountLink, currentIndex): Root["children"] => {
            const linkElement: Root["children"][number] = {
                type: "link",
                url: printAgentLinkPath(accountLink),
                children: [{type: "text", value: printAgentPlainTextLabel(accountLink)}],
            };

            // Determine the separator based on position
            let separator = "";
            if (accountLinks.length === 2) {
                // For two accounts: "Account1 and ", "Account2"
                if (currentIndex === 0) {
                    separator = " and ";
                }
            } else if (accountLinks.length > 2) {
                // For 3+ accounts: "Account1, ", "Account2, ", "Account3 and ", "Account4"
                if (currentIndex < accountLinks.length - 2) {
                    separator = ", ";
                } else if (currentIndex === accountLinks.length - 2) {
                    separator = " and ";
                }
            }

            // Return link + separator text node (if separator exists)
            if (separator) {
                return [linkElement, {type: "text", value: separator}];
            }
            return [linkElement];
        },
    );

    return [
        {type: "paragraph", children: [{type: "text", value: "Members in chat: "}]},
        ...accountLinkElements,
    ];
}

async function getPreambleForDocumentComments(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    transaction: DurableObjectTransaction,
    link: Extract<AgentPaginatedMessagesListLink, {type: "DocumentCommentThreadComments"}>,
): Promise<Array<Root["children"][number]>> {
    let documentLink = await findAgentLinkForApiPathIfExists(
        transaction,
        `/documents/${link.documentId}`,
    );

    if (!documentLink) {
        const document = await request.apiClient.get(tracer, "/documents/{id}", {
            params: {path: {id: link.documentId}},
        });
        documentLink = await createAgentLink(transaction, {
            type: "Document",
            document: {id: link.documentId, title: document.data.document.title},
        });
    }

    return [
        {type: "paragraph", children: [{type: "text", value: "Comments on "}]},
        {
            type: "link",
            url: printAgentLinkPath(documentLink),
            children: [{type: "text", value: printAgentPlainTextLabel(documentLink)}],
        },
    ];
}

async function getPreambleForTaskComments(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    transaction: DurableObjectTransaction,
    link: Extract<AgentPaginatedMessagesListLink, {type: "TaskComments"}>,
): Promise<Array<Root["children"][number]>> {
    let taskLink = await findAgentLinkForApiPathIfExists(transaction, `/tasks/${link.taskId}`);
    if (!taskLink) {
        const {
            data: {task},
        } = await request.apiClient.get(tracer, "/tasks/{id}", {
            params: {path: {id: link.taskId}},
        });
        taskLink = await createAgentLink(transaction, {type: "Task", task});
    }

    return [
        {type: "paragraph", children: [{type: "text", value: "Comments on Task: "}]},
        {
            type: "link",
            url: printAgentLinkPath(taskLink),
            children: [{type: "text", value: printAgentPlainTextLabel(taskLink)}],
        },
    ];
}
