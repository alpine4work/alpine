import {getApiMessageApprovals} from "~/server/agents/api/api_client.js";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {rejectPendingChatGptAgentMessageApproval} from "~/server/agents/internal/approvals/reject_pending_chat_gpt_agent_message_approval.js";
import {
    ChatGptAgentMessageApproval,
    ChatGptAgentMessageApprovalDecisionOption,
    getChatGptAgentPendingMessageApprovalIfExistsWithPendingApprovalIndexes,
    putChatGptAgentPendingMessageApprovalDecision,
} from "~/server/agents/internal/conversation/chat_gpt_agent_approval_collection.js";
import {
    ChatGptAgentConversationStore,
    ChatGptAgentMessageApprovalScope,
} from "~/server/agents/internal/conversation/chat_gpt_agent_conversation_store.js";
import {getTimezoneFromBotWebhookRequest} from "~/server/agents/internal/get_timezone_from_bot_webhook_request.js";
import {
    ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent,
    ApiMessageExperimentalApprovalDecisionValue,
    ApiMessageExperimentalApprovalDecisionValueResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Result} from "~/shared/helpers/control/result.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Applies an `UpdatedMessageStreamExperimentalApprovalsPart` webhook event to the
 * pending approval record it decides.
 */
// NOTE(ifitzsimmons, 2026-06-24): Approval decisions from the API have already
// been persisted by the server. The only decision we submit from this path is a
// defensive `NotFound` when the agent can no longer find a matching pending
// approval in DO state. See the decision log for more details (2026-06-23 entry)
// [1].
//
// [1]: https://alpine.inc/doc/j665gk6h1mhzb7qvnz6qfgagfg
export async function handleChatGptAgentApprovalDecisionWebhookEventIfPossible(
    span: TracerSpan,
    request: AgentWebhookRequest & {
        event: ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent;
    },
): Promise<
    | {ok: true; readonly approval: ChatGptAgentMessageApproval}
    | {ok: false; readonly error: Error}
    | null
> {
    // Apply the decisions in a transaction so the read-modify-write of the stored
    // approval record is atomic. Side effects (API calls, stream writes) happen
    // outside the transaction: its closure can re-run on conflict and roll back,
    // neither of which can un-send a network request.
    const decisionResult = await request.storage.transaction(
        async (
            transaction,
        ): Promise<
            | {readonly ok: true; readonly approval: ChatGptAgentMessageApproval}
            | {readonly ok: false; readonly error: Error; readonly shouldRejectApprovals?: boolean}
            | null
        > => {
            const pendingApproval =
                await getChatGptAgentPendingMessageApprovalIfExistsWithPendingApprovalIndexes(
                    request.storage,
                );
            if (!pendingApproval) {
                return {
                    ok: false,
                    error: new NotFoundError(
                        `Couldn\u2019t find approval item for the message with index ${request.event.messageIndex}`,
                    ),
                    // If the approvals actually did exist but for some reason the agent state is
                    // "corrupted", we can never recover. In this case, we should try to reject all
                    // approvals to avoid weird client behavior.
                    shouldRejectApprovals: true,
                };
            }

            // Unlike the missing-record case above, deliberately don't reject anything here
            // (no `shouldRejectApprovals`): the agent does have a live pending approval, just
            // for a different message. The mismatch means this event is stale or malformed
            // \u2014 not that the agent's state is corrupted \u2014 so the pending approval
            // must stay decidable and we shouldn't touch the approvals on whatever message the
            // event names.
            if (pendingApproval.approval.messageIndex !== request.event.messageIndex) {
                return {
                    ok: false,
                    error: new InvalidArgumentError(
                        `Couldn\u2019t find a pending approval for the message with index ${request.event.messageIndex}`,
                    ),
                };
            }

            // No-op if the approval is already decided. This might happen if the webhook event
            // is sent twice for some reason.
            if (pendingApproval.indexes.size === 0) return null;

            const nextApprovalsResult = applyApprovalDecisionUpdates(
                pendingApproval.approval,
                request.event.approvals,
            );

            // If the update was a no-op, return null. This could happen if the webhook event
            // is sent twice for some reason.
            if (nextApprovalsResult === null) return null;
            if (!nextApprovalsResult.ok) return nextApprovalsResult;

            const {nextApprovals, approvedScopes} = nextApprovalsResult.value;

            const nextChatGptAgentApproval = {
                ...pendingApproval.approval,
                approvals: nextApprovals,
            };

            await runAllPromises([
                putChatGptAgentPendingMessageApprovalDecision(
                    span,
                    transaction,
                    nextChatGptAgentApproval,
                ),
                (async () => {
                    if (approvedScopes.size === 0) return;

                    const conversation = await ChatGptAgentConversationStore.new(transaction, {
                        initialTimeZone: getTimezoneFromBotWebhookRequest(request),
                    });

                    for (const scope of approvedScopes) {
                        await conversation.grantApprovedMessageApprovalScope(transaction, scope);
                    }
                })(),
            ]);

            return {ok: true, approval: nextChatGptAgentApproval};
        },
    );

    if (!decisionResult) return null;
    if (decisionResult.ok) return decisionResult;

    if (!decisionResult.shouldRejectApprovals) {
        return {ok: false, error: decisionResult.error};
    }

    // Alpine is the source of truth for approval state. If the agent can't find an
    // approval, it's for 1 of 2 reasons:
    //
    // 1. The agent's state was "corrupted" in some form or another.
    // 2. The approval was never valid in the first place.
    //
    // In either case, we'll make a best effort to reject whatever is still pending on
    // the message so the approval UI isn't left decidable: fetch the current approvals
    // from the API and reject the ones that are still undecided.
    const approvalsResult = await captureResultPromise(
        getApiMessageApprovals(
            span,
            request.apiClient,
            request.event.room,
            request.event.messageIndex,
        ),
    );

    if (!approvalsResult.ok) {
        // It's possible that the message doesn't have approvals at all (e.g. the approval
        // was never valid in the first place). If we can't fetch them, just log it and
        // move on.
        span.addException(approvalsResult.error);
        return {ok: false, error: decisionResult.error};
    }

    const pendingApprovalIndexes = filterMapArray(
        approvalsResult.value.data.approvals,
        (approval, index) => (approval.decision.value === undefined ? index : undefined),
    );

    if (pendingApprovalIndexes.length > 0) {
        const rejectResult = await captureResultPromise(
            rejectPendingChatGptAgentMessageApproval(span, {
                apiClient: request.apiClient,
                room: request.event.room,
                messageIndex: request.event.messageIndex,
                patches: pendingApprovalIndexes.map(index => ({
                    index,
                    value: {type: "Rejected" as const},
                })),
            }),
        );

        if (!rejectResult.ok) span.addException(rejectResult.error);
    }

    return {ok: false, error: decisionResult.error};
}

/**
 * Computes the next state of a stored approval record after applying the decision
 * values from a webhook event. Pure: validation failures are returned as an error
 * `Result` for the caller to act on.
 */
function applyApprovalDecisionUpdates(
    originalApproval: ChatGptAgentMessageApproval,
    updatedApprovals: ReadonlyArray<{
        readonly decision: {
            readonly value?: ApiMessageExperimentalApprovalDecisionValueResponse;
        };
    }>,
): Result<
    {
        readonly nextApprovals: ReadonlyArray<{
            readonly options: ReadonlyArray<ChatGptAgentMessageApprovalDecisionOption>;
            readonly response?: ApiMessageExperimentalApprovalDecisionValue;
        }>;
        readonly approvedScopes: ReadonlySet<ChatGptAgentMessageApprovalScope>;
    },
    Error
> | null {
    const originalApprovals = originalApproval.approvals;
    // Decided approvals keyed by their index. We accumulate here and materialize both
    // the final approvals array and the list of changed decisions with a single pass
    // at the end.
    const approvalsWithNewDecisionValues = new Map<
        number,
        {
            readonly options: ReadonlyArray<ChatGptAgentMessageApprovalDecisionOption>;
            readonly response?: ApiMessageExperimentalApprovalDecisionValue;
        }
    >();
    const approvedScopes = new Set<ChatGptAgentMessageApprovalScope>();

    for (let approvalIndex = 0; approvalIndex < updatedApprovals.length; approvalIndex++) {
        const decisionValue = assertExists(updatedApprovals[approvalIndex]).decision.value;
        if (decisionValue === undefined) continue;

        const decisionValueWithoutDecider = omitObject(decisionValue, ["decider"]);

        const existingApproval = assertExists(originalApprovals[approvalIndex]);
        // Ignore approval decisions that the agent has already received.
        if (existingApproval.response !== undefined) continue;

        const isDecisionValid = existingApproval.options.some(option => {
            if (option.type !== decisionValueWithoutDecider.type) return false;

            if (option.type !== "ApprovedForSession") {
                assert(option.type === decisionValueWithoutDecider.type);
                assertEqualTypes<typeof option, typeof decisionValueWithoutDecider>();
                return isDeepEqual(option, decisionValueWithoutDecider);
            }

            assert(option.type === decisionValueWithoutDecider.type);

            if (option.scope.value !== decisionValueWithoutDecider.scope.value) return false;

            const optionWithoutScope = omitObject(option, ["scope"]);
            const decisionValueWithoutScope = omitObject(decisionValueWithoutDecider, ["scope"]);
            assertEqualTypes<typeof optionWithoutScope, typeof decisionValueWithoutScope>();
            return isDeepEqual(optionWithoutScope, decisionValueWithoutScope);
        });

        if (!isDecisionValid) {
            return {
                ok: false,
                error: new FailedPreconditionError(
                    quote`Approval decision ${decisionValue.type} at index ${approvalIndex} doesn\u2019t match any option offered by the agent`,
                ),
            };
        }

        approvalsWithNewDecisionValues.set(approvalIndex, {
            options: existingApproval.options,
            response: decisionValue,
        });

        if (decisionValue.type === "ApprovedForSession") {
            assert(decisionValue.scope.value === "Write");
            approvedScopes.add(decisionValue.scope.value);
        }
    }

    if (approvalsWithNewDecisionValues.size === 0) return null;

    return {
        ok: true,
        value: {
            nextApprovals: originalApprovals.map(
                (approval, index) => approvalsWithNewDecisionValues.get(index) ?? approval,
            ),
            approvedScopes,
        },
    };
}
