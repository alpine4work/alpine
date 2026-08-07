import {rejectPendingChatGptAgentMessageApproval} from "~/server/agents/bots/deprecated/internal/approvals/reject_pending_chat_gpt_agent_message_approval.js";
import {
    decidePendingMessageApproval,
    getChatGptAgentPendingMessageApprovalIfExistsWithPendingApprovalIndexes,
} from "~/server/agents/bots/deprecated/internal/conversation/chat_gpt_agent_approval_collection.js";
import {AgentWebhookRequest} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * Rejects every approval that is still awaiting a decision. Called when the agent
 * receives a new message while approvals are pending: the new message supersedes
 * the paused turn, so the outstanding approval requests must not stay decidable.
 *
 * Only undecided approvals are rejected. Decisions already absorbed from earlier
 * webhook events keep their values, so tool calls the user approved mid-batch
 * still run as part of the new message's turn — the new message only cancels what
 * was never decided.
 */
export async function denyPendingChatGptAgentApprovalsIfNeeded(
    span: TracerSpan,
    request: AgentWebhookRequest,
): Promise<void> {
    const pendingMessageApproval =
        await getChatGptAgentPendingMessageApprovalIfExistsWithPendingApprovalIndexes(
            request.storage,
        );
    if (!pendingMessageApproval) return;

    const {approval: pendingApprovalItem, indexes: pendingApprovalIndexes} = pendingMessageApproval;

    await span.withSpan("Rejecting pending message approval", async () => {
        const nextApprovals = await rejectPendingChatGptAgentMessageApproval(span, {
            apiClient: request.apiClient,
            room: pendingApprovalItem.room,
            messageIndex: pendingApprovalItem.messageIndex,
            patches: Array.from(
                mapIterable(pendingApprovalIndexes, (index: number) => ({
                    index,
                    value: {type: "Rejected" as const},
                })),
            ),
        });

        assert(pendingApprovalItem.approvals.length === nextApprovals.length);

        await request.storage.transaction(async transaction => {
            await decidePendingMessageApproval(span, transaction, {
                ...pendingApprovalItem,
                approvals: pendingApprovalItem.approvals.map((approval, index) => ({
                    ...approval,
                    response: assertExists(nextApprovals[index]).decision.value,
                })),
            });
        });
    });
}
