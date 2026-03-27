import {Root, RootContent} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {agentInitializeMessagesTokenLimit} from "~/server/agents/bots/internal/agent_limits.js";
import {
    AgentConversationState,
    AgentConversationStore,
} from "~/server/agents/bots/internal/conversation/agent_conversation_store.js";
import {loadAgentMessagesListLinkContent} from "~/server/agents/bots/internal/link_references/load_agent_messages_list_link_content.js";
import {loadAgentPostCommentsLinkContent} from "~/server/agents/bots/internal/link_references/load_agent_post_comments_link_content.js";
import {AgentMessage} from "~/server/agents/bots/internal/messages/agent_message.js";
import {printAgentContentMarkdownTree} from "~/server/agents/bots/internal/print_api_content_to_agent_markdown.js";
import {DurableObjectTransactionInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function initializeMessagesInAgentConversation({
    tracer,
    transaction,
    request,
    conversation,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    conversation: AgentConversationStore;
}): Promise<void> {
    assert(conversation.getState().lastMessageIndex === null);

    const {messagesContent} = await loadInitialAgentMessagesContent({
        tracer,
        transaction,
        request,
        conversationState: conversation.getState(),
        tokenLimitForPage: agentInitializeMessagesTokenLimit,
    });

    const getConversationMessageIndex = () => {
        switch (request.event.type) {
            case "NewMessage": {
                return request.event.index;
            }
            case "NewPost": {
                // We don't want to store 0 for the piece of state that represents the last loaded
                // message index since it wasn't actually loaded yet.
                return -1;
            }
            default:
                throw exhaustive(request.event);
        }
    };

    await conversation.insertMessages(
        transaction,
        getConversationMessageIndex(),
        printAgentContentMarkdownTree(messagesContent),
    );
}

export async function loadInitialAgentMessagesContent({
    tokenLimitForPage,
    ...options
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: AgentWebhookRequest;
    conversationState: Pick<AgentConversationState, "startTime" | "timeZone">;
    tokenLimitForPage: number;
}): Promise<{
    preamble: Array<RootContent>;
    messages: Array<AgentMessage>;
    messagesContent: Root;
}> {
    const {event} = options.request;

    const getCursorForEvent = () => {
        switch (event.type) {
            case "NewMessage": {
                return event.index + 1;
            }
            case "NewPost": {
                // Has to be 1 for a valid api call to get messages from end since it's range
                // exclusive.
                return 1;
            }
            default: {
                throw exhaustive(event);
            }
        }
    };

    const commonLinkOptions = {
        paginationType: "page",
        pageNumber: 1,
        pageInfo: {from: "End", cursor: getCursorForEvent()},
        tokenLimitForPage,
        rootMessage: null,
        isMessageRoomPage: true,
    } as const;

    const {room} = options.request;

    switch (room.type) {
        case "Chat": {
            return loadAgentMessagesListLinkContent({
                ...options,
                link: {
                    type: "ChatMessages",
                    chatId: room.id,
                    label: "",
                    ...commonLinkOptions,
                },
                tokenLimitFactor: 1,
            });
        }
        case "DocumentCommentThread": {
            return loadAgentMessagesListLinkContent({
                ...options,
                link: {
                    type: "DocumentCommentThreadComments",
                    documentId: room.id,
                    commentThreadId: room.threadId,
                    label: "",
                    ...commonLinkOptions,
                },
                tokenLimitFactor: 1,
            });
        }
        case "Task": {
            return loadAgentMessagesListLinkContent({
                ...options,
                link: {
                    type: "TaskComments",
                    taskId: room.id,
                    label: "",
                    ...commonLinkOptions,
                },
                tokenLimitFactor: 1,
            });
        }
        case "Post": {
            return loadAgentPostCommentsLinkContent({
                ...options,
                link: {
                    type: "PostComments",
                    postId: room.id,
                    label: "",
                    ...commonLinkOptions,
                },
                tokenLimitFactor: 1,
            });
        }
        default: {
            throw exhaustive(room);
        }
    }
}
