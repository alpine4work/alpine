import {Link, Paragraph, PhrasingContent, Root, RootContent, Text} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {AgentConversationState} from "~/server/agents/bots/internal/conversation/agent_conversation_store.js";
import {AgentPostCommentsLink} from "~/server/agents/bots/internal/link_references/agent_link.js";
import {
    createAgentLink,
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
import {DurableObjectTransactionInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {
    ApiMessageRoomTarget,
    ApiPostResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type LoadAgentPostCommentsLinkRequest = Pick<AgentWebhookRequest, "apiClient" | "spaceId">;

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
 * [Post](/post/link-to-post)
 *
 * <-- Zeroth chunk of messages start -->
 *
 * <human name="Ian">message 1</human> <bot name="GPT">message 2</bot>
 * <human name="Josh">message 3</human> <human name="Rachel">message 4</human>
 *
 * <-- Zeroth chunk of messages end -->
 *
 * [Next Page](/post/ian-first-post-sentence?chunk=1)
 * ```
 */
export async function loadAgentPostCommentsLinkContent(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentPostCommentsLinkRequest;
    link: AgentPostCommentsLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    tokenLimitFactor: number;
}): Promise<{
    preamble: Array<RootContent>;
    messages: Array<AgentMessage>;
    messagesContent: Root;
}> {
    // We always fetch the post when loading a page of comments. We need the post in
    // order to create the preamble elements for the list of messages. If we're loading
    // the first page, we also need to fetch the post's content.
    //
    // TODO(ifitzsimmons, #ai): add post preview API endpoint so we can fetch the data
    // we need without needing to fetch the entire contents of the post. As is, it
    // kinda stinks that we load the contents of the post here and then throw it away.
    // If/when the Agent tries to read the post, we'll load the entire post again. We
    // can then just fetch the post content only when we need it.
    //
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/znbyh8f7sx5s0nb29zygvcasjw
    const post = await fetchPost(options.tracer, options.request, options.link.postId);

    const {messages, messagesContent, doesPageContainPost, doesPageContainPostComments} =
        await loadPageMessages({
            ...options,
            post,
        });

    const preambleElements = await getPreambleForPostComments({
        transaction: options.transaction,
        post,
        doesPageContainPost,
        doesPageContainPostComments,
        currentPageLink: options.link,
    });

    return {
        preamble: [preambleElements],
        messages,
        messagesContent: {
            type: "root",
            children: [preambleElements, ...messagesContent],
        },
    };
}

async function loadPageMessages(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentPostCommentsLinkRequest;
    link: AgentPostCommentsLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    post: ApiPostResponse;
    tokenLimitFactor: number;
}): Promise<{
    messages: Array<AgentMessage>;
    messagesContent: Array<RootContent>;
    doesPageContainPost: boolean;
    doesPageContainPostComments: boolean;
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

async function getMarkdownContentForPageFromStart({
    tracer,
    transaction,
    request,
    link,
    conversationState,
    cursorOptions,
    post,
    tokenLimitFactor,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentPostCommentsLinkRequest;
    link: AgentPostCommentsLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    cursorOptions: {
        from: "Start";
        cursor: number | null;
    };
    post: ApiPostResponse;
    tokenLimitFactor: number;
}): Promise<{
    messages: Array<AgentMessage>;
    messagesContent: Array<RootContent>;
    doesPageContainPost: boolean;
    doesPageContainPostComments: boolean;
}> {
    // If we are loading the first page of post comments, we should load the post as
    // well. Any time a post is referenced, it will be stored as the first page of
    // comments for that post.
    const isFirstPage = cursorOptions.cursor === null;

    const [{messages, nextCursor}, originalPostMessage] = await runAllPromises([
        getAgentMessagesFromStartUntilTokenLimitCount(
            tracer,
            transaction,
            request.apiClient,
            request.spaceId,
            getMessageRoom(link),
            {
                startingCursor: cursorOptions.cursor,
                limitTokenCount: Math.floor(link.tokenLimitForPage * tokenLimitFactor),
            },
        ),
        isFirstPage ? getPostAgentMessage(transaction, request, post) : null,
    ]);

    const nextPageLink =
        nextCursor !== null
            ? await putAgentNextMessagesPageLink(transaction, link, nextCursor)
            : null;

    const pageMessages = [...(originalPostMessage ? [originalPostMessage] : []), ...messages];

    const messagesContent = await printMessagesListContentToMarkdownRoot({
        previousPageLinkString: null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages,
        conversationState,
    });

    return {
        messages: pageMessages,
        messagesContent,
        doesPageContainPost: isFirstPage,
        doesPageContainPostComments: messages.length > 0,
    };
}

async function getMarkdownContentForPageFromEnd({
    tracer,
    transaction,
    request,
    link,
    conversationState,
    cursorOptions,
    post,
    tokenLimitFactor,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentPostCommentsLinkRequest;
    link: AgentPostCommentsLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    cursorOptions: {
        from: "End";
        cursor: number;
    };
    post: ApiPostResponse;
    tokenLimitFactor: number;
}): Promise<{
    messages: Array<AgentMessage>;
    messagesContent: Array<RootContent>;
    doesPageContainPost: boolean;
    doesPageContainPostComments: boolean;
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

    // If we loaded the first comment when loading this page, load the post content as
    // well.
    const isFirstPage = !previousPageLink;

    const originalPostMessage = isFirstPage
        ? [await getPostAgentMessage(transaction, request, post)]
        : [];

    const pageMessages = [...originalPostMessage, ...messages];

    const messagesContent = await printMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: null,
        paginationType: link.paginationType,
        pageMessages,
        conversationState,
    });

    return {
        messages: pageMessages,
        messagesContent,
        doesPageContainPost: isFirstPage,
        doesPageContainPostComments: messages.length > 0,
    };
}

async function getMarkdownContentForPageFromMiddle({
    tracer,
    transaction,
    request,
    link,
    conversationState,
    cursorOptions,
    post,
    tokenLimitFactor,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: LoadAgentPostCommentsLinkRequest;
    link: AgentPostCommentsLink;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    cursorOptions: {
        from: "Middle";
        index: number;
    };
    post: ApiPostResponse;
    tokenLimitFactor: number;
}): Promise<{
    messages: Array<AgentMessage>;
    messagesContent: Array<RootContent>;
    doesPageContainPost: boolean;
    doesPageContainPostComments: boolean;
}> {
    const [
        {messages: messagesBeforeCurrent, nextCursor: pageStartIndex},
        {messages: messagesAfterAndIncludingCurrent, nextCursor: pageEndIndex},
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

    // If we loaded the first comment when loading this page, load the post content as
    // well.
    const isFirstPage = !previousPageLink;

    const originalPostMessage = isFirstPage
        ? [await getPostAgentMessage(transaction, request, post)]
        : [];

    const pageMessages = [
        ...originalPostMessage,
        ...messagesBeforeCurrent,
        ...messagesAfterAndIncludingCurrent,
    ];

    const messagesContent = await printMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages,
        conversationState,
    });
    return {
        messages: pageMessages,
        messagesContent,
        doesPageContainPost: isFirstPage,
        doesPageContainPostComments:
            messagesBeforeCurrent.length > 0 || messagesAfterAndIncludingCurrent.length > 0,
    };
}

function getMessageRoom(link: AgentPostCommentsLink): ApiMessageRoomTarget {
    return {type: "Post", id: link.postId};
}

async function getPreambleForPostComments({
    transaction,
    post,
    currentPageLink,
    doesPageContainPost,
    doesPageContainPostComments,
}: {
    transaction: DurableObjectTransactionInterface;
    post: ApiPostResponse;
    currentPageLink: AgentPostCommentsLink;
    doesPageContainPost: boolean;
    doesPageContainPostComments: boolean;
}): Promise<Paragraph> {
    // If the page type is "page", we already showed the post content on the first
    // page. For chunks, we want to show a link to the post for the first chunk only.
    const shouldLinkPost =
        currentPageLink.paginationType === "chunk" && currentPageLink.pageNumber === 0;

    const [postLink, channelLink] = await runAllPromises([
        shouldLinkPost
            ? createAgentLink(transaction, {
                  type: "Post",
                  post: {
                      id: post.id,
                      contentPreview: post.contentPreview,
                  },
              })
            : null,
        post.channel
            ? createAgentLink(transaction, {type: "Channel", channel: post.channel})
            : null,
    ]);

    const postText: Text = {type: "text", value: "post"};
    const postElement: Text | Link = postLink
        ? {
              type: "link",
              url: printAgentLinkPath(postLink),
              children: [postText],
          }
        : postText;

    const channelElements: Array<PhrasingContent> = channelLink
        ? [
              {type: "text", value: " in "},
              {
                  type: "link",
                  url: printAgentLinkPath(channelLink),
                  children: [{type: "text", value: printAgentPlainTextLabel(channelLink)}],
              },
          ]
        : [];

    const content: Array<PhrasingContent> = [
        {type: "text", value: doesPageContainPost ? "This is a " : "These are comments on a "},
        postElement,
        ...channelElements,
        ...(doesPageContainPost && doesPageContainPostComments
            ? cast<Array<PhrasingContent>>([{type: "text", value: " and its comments"}])
            : []),
        {type: "text", value: "."},
    ];

    return {
        type: "paragraph",
        children: content,
    };
}

async function fetchPost(
    tracer: TracerBase,
    request: Pick<AgentWebhookRequest, "apiClient" | "spaceId">,
    postId: PostId,
): Promise<ApiPostResponse> {
    const {
        data: {post},
    } = await request.apiClient.get(tracer, "/posts/{id}", {
        params: {path: {id: postId}},
    });
    return post;
}

async function getPostAgentMessage(
    transaction: DurableObjectTransactionInterface,
    request: LoadAgentPostCommentsLinkRequest,
    post: ApiPostResponse,
): Promise<AgentMessage> {
    return await AgentMessage.new(transaction, {
        spaceId: request.spaceId,
        index: -1, // The post is not a message, so it has an index of -1.
        author: post.author,
        createdTime: post.createdTime,
        createdTimeZone: post.createdTimeZone,
        payload: {
            type: "Content",
            content: post.content,
            files: [],
        },
    });
}
