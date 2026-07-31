import {Root} from "mdast";
import {AgentConversationState} from "~/server/agents/bots/deprecated/internal/conversation/agent_conversation_store.js";
import {AgentLink} from "~/server/agents/bots/deprecated/internal/link_references/agent_link.js";
import {loadAgentAccountLinkContent} from "~/server/agents/bots/deprecated/internal/link_references/load_agent_account_link_content.js";
import {loadAgentChannelLinkContent} from "~/server/agents/bots/deprecated/internal/link_references/load_agent_channel_link_content.js";
import {loadAgentDocumentPageLinkContent} from "~/server/agents/bots/deprecated/internal/link_references/load_agent_document_page_link_content.js";
import {loadAgentMessagesListLinkContent} from "~/server/agents/bots/deprecated/internal/link_references/load_agent_messages_list_link_content.js";
import {loadAgentPostCommentsLinkContent} from "~/server/agents/bots/deprecated/internal/link_references/load_agent_post_comments_link_content.js";
import {loadAgentTaskCollectionLinkContent} from "~/server/agents/bots/deprecated/internal/link_references/load_agent_task_collection_link_content.js";
import {loadAgentTaskLinkContent} from "~/server/agents/bots/deprecated/internal/link_references/load_agent_task_link_content.js";
import {AgentWebhookRequest} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {DurableObjectTransactionInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
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
            return await loadAgentAccountLinkContent({
                ...options,
                link,
            });
        }
        case "Channel": {
            return await loadAgentChannelLinkContent({
                ...options,
                link,
            });
        }
        case "DocumentPage": {
            return await loadAgentDocumentPageLinkContent({
                ...options,
                link,
                tokenLimitFactor: options.tokenLimitFactor ?? 1,
            });
        }
        case "Task": {
            return await loadAgentTaskLinkContent({
                ...options,
                link,
            });
        }
        case "TaskCollection": {
            return await loadAgentTaskCollectionLinkContent({
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
        case "Site": {
            // TODO(#site-api): Implement site API.
            throw new UnimplementedError("Site API is not implemented", {
                displayMessage: errorDisplayMessage`The Site API is not implemented yet. You can still see Site mentions, but you won\u2019t be able to request more data about the site right now.`,
            });
        }
        default:
            throw exhaustive(link);
    }
}
