import {
    ApiClient,
    getApiMessageApprovals,
    patchApiMessageApprovals,
} from "~/server/agents/api/api_client.open_source.js";
import {
    ApiMessageExperimentalApprovalRequest,
    ApiMessageRoomReferenceRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * This function attempts to reject all of the pending approvals for a given
 * message. There are a few cases that need special care:
 *
 * 1. A race condition where another actor updates the approval at the same time as
 *    the agent is trying to reject it.
 * 2. The agent's approval state has become out of sync with the server (e.g. a
 *    webhook was never sent) and the agent thinks there are pending approvals that
 *    have actually been decided.
 *
 * Both cases are problematic because the API request will fail if any of the
 * approval values in the patch are already decided. To handle this, we check to
 * see if the request fails due to an already-decided approval, and then we fetch
 * the current state of approvals and try to reject the pending approvals again.
 *
 * @returns The approvals as they exist on the server.
 */
export function rejectPendingChatGptAgentMessageApproval(
    span: TracerSpan,
    {
        apiClient,
        room,
        messageIndex,
        patches: initialPatches,
    }: {
        apiClient: ApiClient;
        room: ApiMessageRoomReferenceRequest;
        messageIndex: number;
        patches: ReadonlyArray<{index: number; value: {type: "Rejected"}}>;
    },
): Promise<ReadonlyArray<ApiMessageExperimentalApprovalRequest>> {
    let patches = initialPatches;

    return retryWithExponentialBackoff(
        async retry => {
            try {
                const {
                    data: {approvals: nextApprovals},
                } = await patchApiMessageApprovals(span, apiClient, room, messageIndex, patches);

                return nextApprovals;
            } catch (error) {
                if (!(error instanceof InvalidArgumentError)) throw error;

                // NOTE(ifitzsimmons, 2026-07-08): If the patch failed because the approval has
                // already been decided, it means one of two things
                //
                // 1. Somehow, the agent's approval status became out of sync with the source of
                //    truth (the server). Could happen if, for some reason, a webhook is never sent
                //    to the agent when an approval decision is made.
                // 2. There was a race condition in which another actor updated the approval
                //    decision while the agent was trying to reject it.
                //
                // In either case, the agent needs to converge to the source of truth. So we get
                // the most up-to-date approvals, reject any that are still pending, and then
                // update the `ChatGptAgentMessageApproval` `approvals` so that it matches the
                // source of truth (values returned by the server).
                const {
                    data: {approvals},
                } = await getApiMessageApprovals(span, apiClient, room, messageIndex);

                const pendingApprovalIndexes = filterMapArray(approvals, (approval, index) => {
                    if (approval.decision.value === undefined) return index;
                    return undefined;
                });

                // If all of the approvals are decided, then great! No need to retry. Return the
                // `ChatGptAgentMessageApproval` with all of the decided approvals.
                if (pendingApprovalIndexes.length === 0) {
                    return approvals;
                }

                patches = pendingApprovalIndexes.map(index => ({
                    index,
                    value: {type: "Rejected" as const},
                }));

                throw retry(error);
            }
        },
        {maxAttemptCount: 3},
    );
}
