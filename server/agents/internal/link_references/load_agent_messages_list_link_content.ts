import {Paragraph, PhrasingContent, Root, RootContent} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentConversationState} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {
    AgentChatMessagesPageLink,
    AgentDocumentCommentsCommentsPageLink,
    AgentPaginatedMessagesListLink,
    AgentTaskCommentsPageLink,
} from "~/server/agents/internal/link_references/agent_link.js";
import {
    createAgentLink,
    findAgentLinkForApiPathIfExists,
    putAgentNextMessagesPageLink,
    putAgentPreviousMessagesPageLink,
} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {printAgentLinkPath} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {printMessagesListContentToMarkdownRoot} from "~/server/agents/internal/link_references/print_messages_list_content_to_markdown_root.js";
import {getAgentMessagesFromEndUntilLimitTokenCount} from "~/server/agents/internal/messages/get_agent_messages_from_end_until_token_limit_count.js";
import {getAgentMessagesFromStartUntilTokenLimitCount} from "~/server/agents/internal/messages/get_agent_messages_from_start_until_token_limit_count.js";
import {parseApiMessageRoomPath} from "~/shared/api/parse_api_path.js";
import {ApiMessageRoomPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type LoadAgentMessagesListLinkRequest = Pick<AgentWebhookRequest, "apiClient" | "spaceId">;

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
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
}): Promise<Root> {
    const messagesContent = await loadPageMessages(options);

    const preamble = await getPagePreambleElements(options);

    return {
        type: "root",
        children: [preamble, ...messagesContent],
    };
}

async function loadPageMessages(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
}): Promise<Array<RootContent>> {
    const {link} = options;
    switch (link.pageInfo.from) {
        case "Start": {
            return getMarkdownContentForPageFromStart({
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
    request: LoadAgentMessagesListLinkRequest;
    transaction: DurableObjectTransaction;
    link: AgentPaginatedMessagesListLink;
}): Promise<Paragraph> {
    switch (options.link.type) {
        case "ChatMessages":
            return getPreambleForChatMessages({
                ...options,
                link: options.link,
            });
        case "DocumentCommentThreadComments":
            return getPreambleForDocumentComments({
                ...options,
                link: options.link,
            });
        case "TaskComments":
            return getPreambleForTaskComments({
                ...options,
                link: options.link,
            });
        default:
            throw exhaustive(options.link);
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
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    cursorOptions: {
        from: "Start";
        cursor: number | null;
    };
}): Promise<Array<RootContent>> {
    const {messages, nextCursor} = await getAgentMessagesFromStartUntilTokenLimitCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        parseApiMessageRoomPath(getMessageRoomPath(link)),
        {
            startingCursor: cursorOptions.cursor,
            limitTokenCount: link.tokenLimitForPage,
        },
    );

    const nextPageLink =
        nextCursor !== null
            ? await putAgentNextMessagesPageLink(transaction, link, nextCursor)
            : null;

    const messagesContent = await printMessagesListContentToMarkdownRoot({
        previousPageLinkString: null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages: messages,
        conversationState,
    });

    return messagesContent;
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
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    cursorOptions: {from: "End"; cursor: number};
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
}): Promise<Array<RootContent>> {
    const {messages, nextCursor} = await getAgentMessagesFromEndUntilLimitTokenCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        parseApiMessageRoomPath(getMessageRoomPath(link)),
        {
            startingCursor: cursorOptions.cursor,
            limitTokenCount: link.tokenLimitForPage,
        },
    );

    const previousPageLink =
        nextCursor !== null
            ? await putAgentPreviousMessagesPageLink(transaction, link, nextCursor)
            : null;

    const messagesContent = await printMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: null,
        paginationType: link.paginationType,
        pageMessages: messages,
        conversationState,
    });

    return messagesContent;
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
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    cursorOptions: {from: "Middle"; index: number};
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
}): Promise<Array<RootContent>> {
    const [
        {messages: messagesBeforeCurrent, nextCursor: pageStartIndex},
        {messages: messagesAfterCurrent, nextCursor: pageEndIndex},
    ] = await runAllPromises([
        getAgentMessagesFromEndUntilLimitTokenCount(
            tracer,
            transaction,
            request.apiClient,
            request.spaceId,
            parseApiMessageRoomPath(getMessageRoomPath(link)),
            {
                // get everything before current index
                startingCursor: cursorOptions.index,
                limitTokenCount: Math.floor(link.tokenLimitForPage / 2),
            },
        ),
        getAgentMessagesFromStartUntilTokenLimitCount(
            tracer,
            transaction,
            request.apiClient,
            request.spaceId,
            parseApiMessageRoomPath(getMessageRoomPath(link)),
            {
                // get everything after and including current index
                startingCursor: cursorOptions.index - 1,
                limitTokenCount: Math.floor(link.tokenLimitForPage / 2),
            },
        ),
    ]);

    const [previousPageLink, nextPageLink] = await runAllPromises([
        pageStartIndex !== null
            ? putAgentPreviousMessagesPageLink(transaction, link, pageStartIndex)
            : null,
        pageEndIndex !== null
            ? putAgentNextMessagesPageLink(transaction, link, pageEndIndex)
            : null,
    ]);

    const messagesContent = await printMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages: [...messagesBeforeCurrent, ...messagesAfterCurrent],
        conversationState,
    });

    return messagesContent;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getPreambleForChatMessages(_options: {
    tracer: TracerBase;
    request: LoadAgentMessagesListLinkRequest;
    transaction: DurableObjectTransaction;
    link: AgentChatMessagesPageLink;
}): Promise<Paragraph> {
    return {
        type: "paragraph",
        children: [
            {
                type: "text",
                value: "This is a chat conversation.",
            },
        ],
    };
}

// TODO(ifitzsimmons, #ai): This preamble should eventually include the snippet
// of text that the comment was created on.
async function getPreambleForDocumentComments({
    tracer,
    request,
    transaction,
    link,
}: {
    tracer: TracerBase;
    request: LoadAgentMessagesListLinkRequest;
    transaction: DurableObjectTransaction;
    link: AgentDocumentCommentsCommentsPageLink;
}): Promise<Paragraph> {
    const content: Array<PhrasingContent> = [
        {
            type: "text",
            value: "This is a conversation about a ",
        },
    ];

    const shouldShowDocumentLink =
        (link.paginationType === "page" && link.pageNumber === 1) ||
        (link.paginationType === "chunk" && link.pageNumber === 0);

    if (!shouldShowDocumentLink) {
        content.push({
            type: "text",
            value: "document",
        });
    } else {
        let documentLink = await findAgentLinkForApiPathIfExists(
            transaction,
            `/documents/${link.documentId}`,
        );

        if (!documentLink) {
            const {
                data: {document},
            } = await request.apiClient.get(tracer, "/documents/{id}", {
                params: {path: {id: link.documentId}},
            });
            documentLink = await createAgentLink(transaction, {
                type: "Document",
                document: {id: link.documentId, title: document.title},
            });
        }

        content.push({
            type: "link",
            url: printAgentLinkPath(documentLink),
            children: [{type: "text", value: "document"}],
        });
    }

    content.push({
        type: "text",
        value: ".",
    });

    return {
        type: "paragraph",
        children: content,
    };
}

async function getPreambleForTaskComments({
    tracer,
    request,
    transaction,
    link,
}: {
    tracer: TracerBase;
    request: LoadAgentMessagesListLinkRequest;
    transaction: DurableObjectTransaction;
    link: AgentTaskCommentsPageLink;
}): Promise<Paragraph> {
    const content: Array<PhrasingContent> = [
        {
            type: "text",
            value: "This is a conversation about a ",
        },
    ];

    const shouldShowTaskLink =
        (link.paginationType === "page" && link.pageNumber === 1) ||
        (link.paginationType === "chunk" && link.pageNumber === 0);

    if (!shouldShowTaskLink) {
        content.push({
            type: "text",
            value: "task",
        });
    } else {
        let taskLink = await findAgentLinkForApiPathIfExists(transaction, `/tasks/${link.taskId}`);
        if (!taskLink) {
            const {
                data: {task},
            } = await request.apiClient.get(tracer, "/tasks/{id}", {
                params: {path: {id: link.taskId}},
            });
            taskLink = await createAgentLink(transaction, {type: "Task", task});
        }

        content.push({
            type: "link",
            url: printAgentLinkPath(taskLink),
            children: [{type: "text", value: "task"}],
        });
    }

    content.push({
        type: "text",
        value: ".",
    });

    return {
        type: "paragraph",
        children: content,
    };
}
