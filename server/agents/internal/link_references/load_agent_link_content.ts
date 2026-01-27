import {Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentConversationState} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {loadAgentAccountLinkContent} from "~/server/agents/internal/link_references/load_agent_account_link_content.js";
import {loadAgentChannelLinkContent} from "~/server/agents/internal/link_references/load_agent_channel_link_content.js";
import {loadAgentDocumentPageLinkContent} from "~/server/agents/internal/link_references/load_agent_document_page_link_content.js";
import {loadAgentMessagesListLinkContent} from "~/server/agents/internal/link_references/load_agent_messages_list_link_content.js";
import {loadAgentPostCommentsLinkContent} from "~/server/agents/internal/link_references/load_agent_post_comments_link_content.js";
import {loadAgentTaskCollectionLinkContent} from "~/server/agents/internal/link_references/load_agent_task_collection_link_content.js";
import {loadAgentTaskLinkContent} from "~/server/agents/internal/link_references/load_agent_task_link_content.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function loadAgentLinkContent(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: AgentWebhookRequest;
    link: AgentLink;
    conversationState: Pick<AgentConversationState, "timeZone" | "startTime">;
    tokenLimitFactor?: number;
}): Promise<Root> {
    const {link} = options;
    switch (link.type) {
        case "Account": {
            return loadAgentAccountLinkContent({
                ...options,
                link,
            });
        }
        case "Channel": {
            return loadAgentChannelLinkContent({
                ...options,
                link,
            });
        }
        case "DocumentPage": {
            return loadAgentDocumentPageLinkContent({
                ...options,
                link,
                tokenLimitFactor: options.tokenLimitFactor ?? 1,
            });
        }
        case "Task": {
            return loadAgentTaskLinkContent({
                ...options,
                link,
            });
        }
        case "TaskCollection": {
            return loadAgentTaskCollectionLinkContent({
                ...options,
                link,
            });
        }
        case "PostComments": {
            const {messagesContent} = await loadAgentPostCommentsLinkContent({
                ...options,
                link,
                tokenLimitFactor: options.tokenLimitFactor ?? 1,
            });
            return messagesContent;
        }
        case "ChatMessages":
        case "DocumentCommentThreadComments":
        case "TaskComments": {
            const {messagesContent} = await loadAgentMessagesListLinkContent({
                ...options,
                link,
                tokenLimitFactor: options.tokenLimitFactor ?? 1,
            });
            return messagesContent;
        }
        default:
            throw exhaustive(link);
    }
}
