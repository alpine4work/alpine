import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {agentInitializeMessagesTokenLimitCount} from "~/server/agents/internal/agent_tool_page_sizing.js";
import {AgentConversationStore} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {loadAgentMessagesListLinkContent} from "~/server/agents/internal/link_references/load_agent_messages_list_link_content.js";
import {loadAgentPostCommentsLinkContent} from "~/server/agents/internal/link_references/load_agent_post_comments_link_content.js";
import {printAgentContentMarkdownTree} from "~/server/agents/internal/print_api_content_to_agent_markdown.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function initializeMessagesInAgentConversation(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    conversation: AgentConversationStore;
}): Promise<void> {
    const {conversation, request} = options;
    assert(conversation.getState().lastMessageIndex === null);

    const content = await loadMessagesListLinkContent(options);

    await conversation.insertMessages(
        options.transaction,
        request.event.index,
        printAgentContentMarkdownTree(content),
    );
}

export async function loadMessagesListLinkContent(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    conversation: AgentConversationStore;
}) {
    const commonLinkOptions = {
        paginationType: "page",
        pageNumber: 1,
        pageInfo: {from: "End", cursor: options.request.event.index + 1},
        tokenLimitForPage: agentInitializeMessagesTokenLimitCount,
        rootMessage: null,
        isMessageRoomPage: true,
    } as const;

    const conversationState = options.conversation.getState();

    const {room} = options.request;

    switch (room.type) {
        case "Chat": {
            return loadAgentMessagesListLinkContent({
                ...options,
                conversationState,
                link: {
                    type: "ChatMessages",
                    chatId: room.id,
                    label: "",
                    ...commonLinkOptions,
                },
            });
        }
        case "DocumentCommentThread": {
            return loadAgentMessagesListLinkContent({
                ...options,
                conversationState,
                link: {
                    type: "DocumentCommentThreadComments",
                    documentId: room.id,
                    commentThreadId: room.threadId,
                    label: "",
                    ...commonLinkOptions,
                },
            });
        }
        case "Task": {
            return loadAgentMessagesListLinkContent({
                ...options,
                conversationState,
                link: {
                    type: "TaskComments",
                    taskId: room.id,
                    label: "",
                    ...commonLinkOptions,
                },
            });
        }
        case "Post": {
            return loadAgentPostCommentsLinkContent({
                ...options,
                conversationState,
                link: {
                    type: "PostComments",
                    postId: room.id,
                    label: "",
                    ...commonLinkOptions,
                },
            });
        }
        default: {
            throw exhaustive(room);
        }
    }
}
