import {Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {agentMessagePageTokenLimitCount} from "~/server/agents/internal/agent_tool_page_sizing.js";
import {AgentConversationState} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {AgentPostCommentsLink} from "~/server/agents/internal/link_references/agent_link.js";
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
import {printAgentContentToMarkdownTree} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {parseApiMessageRoomPath} from "~/shared/api/parse_api_path.js";
import {ApiMessageRoomPath} from "~/shared/api/types/api_specification_convenience_types.js";
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
 * [Post](/post/link-to-post)
 *
 * <-- Zeroth chunk of messages start -->
 *
 * <human name="Ian">message 1</human>
 * <bot name="GPT">message 2</bot>
 * <human name="Josh">message 3</human>
 * <human name="Rachel">message 4</human>
 *
 * <-- Zeroth chunk of messages end -->
 *
 * [Next Page](/post/ian-first-post-sentence?chunk=1)
 * ```
 */
export async function loadAgentPostCommentsLinkContent(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    link: AgentPostCommentsLink;
    conversationState: AgentConversationState;
}): Promise<Root> {
    const {content, shouldShowPreamble} = await loadPageMessages(options);

    if (!shouldShowPreamble) return content;

    const preambleElements = await getPreambleForPostComments(options);

    return {
        type: "root",
        children: [...preambleElements, {type: "break"}, {type: "break"}, ...content.children],
    };
}

async function loadPageMessages(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    link: AgentPostCommentsLink;
    conversationState: AgentConversationState;
}): Promise<{content: Root; shouldShowPreamble: boolean}> {
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
            return getMarkdownContentForPageFromEnd({
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
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    link: AgentPostCommentsLink;
    conversationState: AgentConversationState;
    cursorOptions: {
        from: "Start";
        index: number;
    };
}): Promise<{content: Root; shouldShowPreamble: boolean}> {
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

    const messagesContent = await parseMessagesListContentToMarkdownRoot({
        previousPageLinkString: null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages: messages,
        conversationState,
    });

    // If we are loading the first page of post comments, we should load the post as
    // well. Any time a post is referenced, it will be stored as the first page of
    // comments for that post.
    const shouldShowPostContent = cursorOptions.index === 0;
    const postContentElements =
        cursorOptions.index === 0
            ? await getPostContentElements(tracer, transaction, request, link)
            : [];

    return {
        content: {
            type: "root",
            children: [...postContentElements, ...messagesContent.children],
        },
        // Only show post comments preamble if we are not already showing the post content.
        shouldShowPreamble: !shouldShowPostContent,
    };
}

async function getMarkdownContentForPageFromEnd({
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
    link: AgentPostCommentsLink;
    conversationState: AgentConversationState;
    cursorOptions: {
        from: "End";
        index: number;
    };
}): Promise<{content: Root; shouldShowPreamble: boolean}> {
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

    const messagesContent = await parseMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: null,
        paginationType: link.paginationType,
        pageMessages: messages,
        conversationState,
    });

    // If we loaded the first comment when loading this page, load the post content as well.
    const shouldShowPostContent = !previousPageLink;
    const postContentElements = shouldShowPostContent
        ? await getPostContentElements(tracer, transaction, request, link)
        : [];

    return {
        content: {
            type: "root",
            children: [...postContentElements, ...messagesContent.children],
        },
        // Only show post comments preamble if we are not already showing the post content.
        shouldShowPreamble: !shouldShowPostContent,
    };
}

async function getMarkdownContentForPageFromMiddle({
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
    link: AgentPostCommentsLink;
    conversationState: AgentConversationState;
    cursorOptions: {
        from: "Middle";
        index: number;
    };
}): Promise<{content: Root; shouldShowPreamble: boolean}> {
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

    const messagesContent = await parseMessagesListContentToMarkdownRoot({
        previousPageLinkString: previousPageLink ? printAgentLinkPath(previousPageLink) : null,
        nextPageLinkString: nextPageLink ? printAgentLinkPath(nextPageLink) : null,
        paginationType: link.paginationType,
        pageMessages: [...messagesBeforeCurrent, ...messagesAfterCurrent],
        conversationState,
    });

    // If we loaded the first comment when loading this page, load the post content as well.
    const shouldShowPostContent = !previousPageLink;
    const postContentElements = shouldShowPostContent
        ? await getPostContentElements(tracer, transaction, request, link)
        : [];

    return {
        content: {
            type: "root",
            children: [...postContentElements, ...messagesContent.children],
        },
        // Only show post comments preamble if we are not already showing the post content.
        shouldShowPreamble: !shouldShowPostContent,
    };
}

function getMessageRoomPath(link: AgentPostCommentsLink): ApiMessageRoomPath {
    return `/posts/${link.postId}`;
}

async function getPreambleForPostComments({
    tracer,
    request,
    transaction,
    link,
}: {
    tracer: TracerBase;
    request: AgentWebhookRequest;
    transaction: DurableObjectTransaction;
    link: Extract<AgentPostCommentsLink, {type: "PostComments"}>;
}): Promise<Array<Root["children"][number]>> {
    let postLink = await findAgentLinkForApiPathIfExists(transaction, `/posts/${link.postId}`);
    if (!postLink) {
        // TODO(ifitzsimmons, #ai): add post preview API endpoint so we can fetch the
        // data we need without needing to fetch the entire contents of the post.
        // As is, it kinda stinks that we load the contents of the post here and then
        // throw it away. If/when the Agent tries to read the post, we'll load the entire
        // post again.
        //
        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/znbyh8f7sx5s0nb29zygvcasjw
        const {
            data: {post},
        } = await request.apiClient.get(tracer, "/posts/{id}", {
            params: {path: {id: link.postId}},
        });

        // TODO(ifitzsimmons, #ai): This is actually a strong reason to NOT show comments
        // when loading a post. I think a better idea is to show a link with
        // `[See comments](link/to/first/page)`. That way, when the agent sees comments
        // first, it can load the post and decide whether it wants to paginate from there
        // or not. We should also consider adding a flag to post links that indicates
        // whether or not we should show a link to more comments when loading the post
        // content. When loading the post from here, we've already loaded some amount of
        // post comments, so we I don't think we should show a "See comments" link if/when
        // the agent tries to read the post.
        postLink = await createAgentLink(transaction, {
            type: "Post",
            post,
        });
    }

    return [
        {type: "paragraph", children: [{type: "text", value: "Comments on Post: "}]},
        {
            type: "link",
            url: printAgentLinkPath(postLink),
            children: [{type: "text", value: printAgentPlainTextLabel(postLink)}],
        },
    ];
}

async function getPostContentElements(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    link: AgentPostCommentsLink,
): Promise<Root["children"]> {
    const {
        data: {post},
    } = await request.apiClient.get(tracer, "/posts/{id}", {
        params: {path: {id: link.postId}},
    });
    const postContent = await printAgentContentToMarkdownTree(transaction, post.content, {
        spaceId: request.spaceId,
    });

    return postContent.children;
}
