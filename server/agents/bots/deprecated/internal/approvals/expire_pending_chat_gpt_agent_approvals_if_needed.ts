import {createApiClient} from "~/server/agents/api/api_client.open_source.js";
import {rejectPendingChatGptAgentMessageApproval} from "~/server/agents/bots/deprecated/internal/approvals/reject_pending_chat_gpt_agent_message_approval.js";
import {getChatGptAgentPendingMessageApprovalIfExistsWithPendingApprovalIndexes} from "~/server/agents/bots/deprecated/internal/conversation/chat_gpt_agent_approval_collection.js";
import {AgentServiceEnv} from "~/server/agents/bots/internal/agent_service_env.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * Best-effort rejects every pending approval before the Durable Object's storage
 * is cleared. Once storage is gone the agent has no way to recover an approved
 * function call, so a decision made after the clear could never be processed —
 * reject the outstanding requests up front so the approval UI isn't left
 * decidable.
 *
 * The pending approvals' local records aren't updated since the storage holding
 * them is deleted immediately after.
 */
export async function expirePendingChatGptAgentApprovalsIfNeeded(
    span: TracerSpan,
    storage: DurableObjectStorage,
    env: AgentServiceEnv,
): Promise<void> {
    const pendingApproval =
        await getChatGptAgentPendingMessageApprovalIfExistsWithPendingApprovalIndexes(storage);
    if (!pendingApproval) return;

    const {approval, indexes} = pendingApproval;

    await span.withSpan("Reject pending message approvals before clearing storage", async () => {
        const apiClient = createApiClient({
            baseUrl: assertExists(
                env.API_SERVICE_URL,
                "Missing `API_SERVICE_URL` environment variable",
            ),
            apiKey: assertExists(
                env.CHAT_GPT_API_SERVICE_KEY,
                "Missing `CHAT_GPT_API_SERVICE_KEY` environment variable",
            ),
            accessToken: approval.apiAccessToken,
        });

        const result = await captureResultPromise(
            rejectPendingChatGptAgentMessageApproval(span, {
                apiClient,
                room: approval.room,
                messageIndex: approval.messageIndex,
                patches: Array.from(
                    mapIterable(indexes, index => ({index, value: {type: "Rejected" as const}})),
                ),
            }),
        );

        if (!result.ok) {
            span.addException(result.error);
        }
    });
}
