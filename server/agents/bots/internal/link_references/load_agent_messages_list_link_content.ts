import {produce} from "immer";
import {PhrasingContent, Root, RootContent} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {AgentConversationState} from "~/server/agents/bots/internal/conversation/agent_conversation_store.js";
import {
    AgentChatMessagesPageLink,
    AgentDocumentCommentsCommentsPageLink,
    AgentPaginatedMessagesListLink,
    AgentTaskCommentsPageLink,
} from "~/server/agents/bots/internal/link_references/agent_link.js";
import {
    createAgentLink,
    findAgentLinkForApiPathIfExists,
    putAgentNextMessagesPageLink,
    putAgentPreviousMessagesPageLink,
} from "~/server/agents/bots/internal/link_references/agent_link_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/bots/internal/link_references/print_agent_link_path.js";
import {printMessagesListContentToMarkdownRoot} from "~/server/agents/bots/internal/link_references/print_messages_list_content_to_markdown_root.js";
import {AgentMessage} from "~/server/agents/bots/internal/messages/agent_message.js";
import {getAgentMessagesFromEndUntilLimitTokenCount} from "~/server/agents/bots/internal/messages/get_agent_messages_from_end_until_token_limit_count.js";
import {getAgentMessagesFromStartUntilTokenLimitCount} from "~/server/agents/bots/internal/messages/get_agent_messages_from_start_until_token_limit_count.js";
import {printApiContentToAgentMarkdownTree} from "~/server/agents/bots/internal/print_api_content_to_agent_markdown.js";
import {DurableObjectTransactionInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {visitDraftApiContent} from "~/shared/api/content/visit_and_produce_api_content.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiMessageRoomReference} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {doesStringEndWithPunctuation} from "~/shared/helpers/string/does_string_end_with_punctuation.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type LoadAgentMessagesListLinkRequest = Pick<AgentWebhookRequest, "apiClient" | "spaceId">;

/**
 * Loads content for a list of message/comments. When paginating through a list of
 * messages, we don't provide links to already-visited pages. This means that the
 * agent can't go backward to a previous page via a `[Previous Page]()` link.
 *
 * The _only_ time we'll show links to next **and** previous pages is when we're
 * loading the first "chunk" of messages. So if the agent is trying to load the
 * page for a message at index 100, we'll give it links so that it can paginate in
 * either direction from there.
 *
 * ```markdown
 * [Previous chunk](/chat/ian-first-post-sentence?chunk=-1) <-- Zeroth chunk -->
 *
 * <human name="Ian">message 1</human> <bot name="GPT">message 2</bot>
 * <human name="Josh">message 3</human> <human name="Rachel">message 4</human>
 *
 * <-- Zeroth chunk -->
 *
 * [Next chunk](/chat/ian-first-post-sentence?chunk=1)
 * ```
 */
export async function loadAgentMessagesListLinkContent(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    tokenLimitFactor: number;
}): Promise<{
    preamble: Array<RootContent>;
    messages: Array<AgentMessage>;
    messagesContent: Root;
}> {
    const {messages, messagesContent, isFirstPage} = await loadPageMessages(options);

    const preamble = await getPagePreambleElements({
        ...options,
        isFirstPage,
    });

    return {
        preamble,
        messages,
        messagesContent: {
            type: "root",
            children: [...preamble, ...messagesContent],
        },
    };
}

async function loadPageMessages(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    tokenLimitFactor: number;
}): Promise<{
    messages: Array<AgentMessage>;
    messagesContent: Array<RootContent>;
    isFirstPage: boolean;
}> {
    const {link} = options;
    switch (link.pageInfo.from) {
        case "Start": {
            return await getMarkdownContentForPageFromStart({
                ...options,
                cursorOptions: link.pageInfo,
            });
        }
        case "Middle": {
            return await getMarkdownContentForPageFromMiddle({
                ...options,
                cursorOptions: link.pageInfo,
            });
        }
        case "End": {
            return await getMarkdownContentForPageFromEnd({
                ...options,
                cursorOptions: link.pageInfo,
            });
        }
        default:
            throw exhaustive(link.pageInfo);
    }
}

// For a given page of messages, we add a preamble to provide more context about
// the snippet of the conversation on the page. For example, if the page is a list
// of document comments, the preamble would include
//
// ```markdown
// Comments on [My Document](/documents/123):
//
// ...page content (messages)
// ```
async function getPagePreambleElements(options: {
    tracer: TracerBase;
    request: LoadAgentMessagesListLinkRequest;
    transaction: DurableObjectTransactionInterface;
    link: AgentPaginatedMessagesListLink;
    isFirstPage: boolean;
}): Promise<Array<RootContent>> {
    switch (options.link.type) {
        case "ChatMessages":
            return await getPreambleForChatMessages({
                ...options,
                link: options.link,
            });
        case "DocumentCommentThreadComments":
            return await getPreambleForDocumentComments({
                ...options,
                link: options.link,
            });
        case "TaskComments":
            return await getPreambleForTaskComments({
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
    tokenLimitFactor,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    cursorOptions: {
        from: "Start";
        cursor: number | null;
    };
    tokenLimitFactor: number;
}): Promise<{
    messages: Array<AgentMessage>;
    messagesContent: Array<RootContent>;
    isFirstPage: boolean;
}> {
    const {messages, nextCursor} = await getAgentMessagesFromStartUntilTokenLimitCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        getMessageRoom(link),
        {
            startingCursor: cursorOptions.cursor,
            limitTokenCount: Math.floor(link.tokenLimitForPage * tokenLimitFactor),
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

    return {
        messages,
        messagesContent,
        isFirstPage: cursorOptions.cursor === null,
    };
}

async function getMarkdownContentForPageFromEnd({
    tracer,
    transaction,
    request,
    link,
    cursorOptions,
    conversationState,
    tokenLimitFactor,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    cursorOptions: {from: "End"; cursor: number | null};
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    tokenLimitFactor: number;
}): Promise<{
    messages: Array<AgentMessage>;
    messagesContent: Array<RootContent>;
    isFirstPage: boolean;
}> {
    const {messages, nextCursor} = await getAgentMessagesFromEndUntilLimitTokenCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        getMessageRoom(link),
        {
            startingCursor: cursorOptions.cursor,
            limitTokenCount: Math.floor(link.tokenLimitForPage * tokenLimitFactor),
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

    return {
        messages,
        messagesContent,
        isFirstPage: !previousPageLink,
    };
}

async function getMarkdownContentForPageFromMiddle({
    tracer,
    transaction,
    request,
    link,
    cursorOptions,
    conversationState,
    tokenLimitFactor,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentMessagesListLinkRequest;
    link: AgentPaginatedMessagesListLink;
    cursorOptions: {from: "Middle"; index: number};
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    tokenLimitFactor: number;
}): Promise<{
    messages: Array<AgentMessage>;
    messagesContent: Array<RootContent>;
    isFirstPage: boolean;
}> {
    const [
        {messages: messagesBeforeCurrent, nextCursor: pageStartIndex},
        {messages: messagesAfterCurrent, nextCursor: pageEndIndex},
    ] = await runAllPromises([
        getAgentMessagesFromEndUntilLimitTokenCount(
            tracer,
            transaction,
            request.apiClient,
            request.spaceId,
            getMessageRoom(link),
            {
                // get everything before current index
                startingCursor: cursorOptions.index,
                limitTokenCount: Math.floor((link.tokenLimitForPage / 2) * tokenLimitFactor),
            },
        ),
        getAgentMessagesFromStartUntilTokenLimitCount(
            tracer,
            transaction,
            request.apiClient,
            request.spaceId,
            getMessageRoom(link),
            {
                // get everything after and including current index
                startingCursor: cursorOptions.index - 1,
                limitTokenCount: Math.floor((link.tokenLimitForPage / 2) * tokenLimitFactor),
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

    const messages = [...messagesBeforeCurrent, ...messagesAfterCurrent];

    const messagesContent = await printMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages: messages,
        conversationState,
    });

    return {
        messages,
        messagesContent,
        isFirstPage: !previousPageLink,
    };
}

function getMessageRoom(link: AgentPaginatedMessagesListLink): ApiMessageRoomReference {
    switch (link.type) {
        case "ChatMessages":
            return {type: "Chat", id: link.chatId};
        case "DocumentCommentThreadComments":
            return {
                type: "DocumentThread",
                id: link.documentId,
                threadId: link.commentThreadId,
            };
        case "TaskComments":
            return {type: "Task", id: link.taskId};
        default:
            throw exhaustive(link);
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getPreambleForChatMessages(_options: {
    tracer: TracerBase;
    request: LoadAgentMessagesListLinkRequest;
    transaction: DurableObjectTransactionInterface;
    link: AgentChatMessagesPageLink;
}): Promise<Array<RootContent>> {
    return [];
}

function getDocumentContentSnippetForThreadExcludingOtherCommentMarks(
    content: ApiContentResponseWithoutKeys,
    commentThreadId: DocumentCommentThreadId,
) {
    return produce(content, content => {
        visitDraftApiContent(content, {
            visitInlineElement: element => {
                if (
                    element.type === "Text" &&
                    element.marks !== undefined &&
                    element.marks.some(
                        mark => mark.type === "Comment" && mark.thread.id !== commentThreadId,
                    )
                ) {
                    element.marks = element.marks.filter(
                        mark => mark.type !== "Comment" || mark.thread.id === commentThreadId,
                    );
                }
            },
        });
    });
}

async function getPreambleForDocumentComments({
    tracer,
    request,
    transaction,
    link,
    isFirstPage,
}: {
    tracer: TracerBase;
    request: LoadAgentMessagesListLinkRequest;
    transaction: DurableObjectTransactionInterface;
    link: AgentDocumentCommentsCommentsPageLink;
    isFirstPage: boolean;
}): Promise<Array<RootContent>> {
    const rootContent: Array<RootContent> = [];
    const paragraphContent: Array<PhrasingContent> = [
        {
            type: "text",
            value: "This is a comment thread on ",
        },
    ];

    const isFirstRenderForConversation =
        (link.paginationType === "page" && link.pageNumber === 1) ||
        (link.paginationType === "chunk" && link.pageNumber === 0);

    let documentContentSnippet: ApiContentResponseWithoutKeys | null = null;

    if (!isFirstRenderForConversation) {
        paragraphContent.push({
            type: "text",
            value: "a document.",
        });
    } else {
        // When showing the conversation for the first time, show the snippet of text that
        // the comment was created on and the link to the document.
        const [existingDocumentLink, commentThreadData] = await runAllPromises([
            findAgentLinkForApiPathIfExists(transaction, `/documents/${link.documentId}`),
            isFirstPage
                ? request.apiClient.get(tracer, "/documents/{id}/threads/{threadId}", {
                      params: {path: {id: link.documentId, threadId: link.commentThreadId}},
                  })
                : null,
        ]);

        let documentLink = existingDocumentLink;

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

        paragraphContent.push({type: "text", value: "the document \u201C"});

        const documentLinkLabel = printAgentPlainTextLabel(documentLink);

        paragraphContent.push({
            type: "link",
            url: printAgentLinkPath(documentLink),
            children: [{type: "text", value: documentLinkLabel}],
        });

        if (doesStringEndWithPunctuation(documentLinkLabel)) {
            paragraphContent.push({type: "text", value: "\u201D"});
        } else {
            paragraphContent.push({type: "text", value: ".\u201D"});
        }

        const contentSnippet = commentThreadData?.data.thread.marked.preview.contentSnippet;
        if (contentSnippet && contentSnippet.elements.length > 0) {
            documentContentSnippet = contentSnippet;
            paragraphContent.push({
                type: "text",
                value: " The following is a preview of the document near the comment. The specific text this comment was left on is wrapped in ",
            });
            paragraphContent.push({
                type: "inlineCode",
                value: "<comment></comment>",
            });
            paragraphContent.push({
                type: "text",
                value: ".",
            });
        }
    }

    rootContent.push({
        type: "paragraph",
        children: paragraphContent,
    });

    if (documentContentSnippet) {
        rootContent.push({type: "html", value: "<document_preview>"});

        const snippetContentMarkdownTree = await printApiContentToAgentMarkdownTree(
            transaction,
            getDocumentContentSnippetForThreadExcludingOtherCommentMarks(
                documentContentSnippet,
                link.commentThreadId,
            ),
        );

        for (const element of snippetContentMarkdownTree.children) {
            rootContent.push(element);
        }

        rootContent.push({type: "html", value: "</document_preview>"});
    }

    return rootContent;
}

async function getPreambleForTaskComments({
    tracer,
    request,
    transaction,
    link,
}: {
    tracer: TracerBase;
    request: LoadAgentMessagesListLinkRequest;
    transaction: DurableObjectTransactionInterface;
    link: AgentTaskCommentsPageLink;
}): Promise<Array<RootContent>> {
    const paragraphContent: Array<PhrasingContent> = [
        {
            type: "text",
            value: "These are comments on a ",
        },
    ];

    const shouldShowTaskLink =
        (link.paginationType === "page" && link.pageNumber === 1) ||
        (link.paginationType === "chunk" && link.pageNumber === 0);

    if (!shouldShowTaskLink) {
        paragraphContent.push({
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

        paragraphContent.push({
            type: "link",
            url: printAgentLinkPath(taskLink),
            children: [{type: "text", value: "task"}],
        });
    }

    paragraphContent.push({
        type: "text",
        value: ".",
    });

    return [
        {
            type: "paragraph",
            children: paragraphContent,
        },
    ];
}
