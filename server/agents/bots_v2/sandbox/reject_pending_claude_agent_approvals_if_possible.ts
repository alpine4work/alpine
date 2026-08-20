import {
    ApiClient,
    getApiMessageApprovals,
    patchApiMessageApprovals,
} from "~/server/agents/api/api_client.open_source.js";
import {ApiMessageRoomReferenceRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * Rejects every still-pending approval on a message's approvals card. Used when a
 * pending batch is abandoned: a new message superseded it, sandbox state is about
 * to be wiped after an error, or a decision event arrived for a batch we no longer
 * know about.
 *
 * Decisions the user already made are left untouched. Reads the authoritative
 * approval state from the API first, so racing user decisions just shrink the set
 * we reject; if a user decision lands between our read and our patch, the patch
 * fails and we retry against the fresh state.
 *
 * Best-effort by design, so every caller doesn't need its own try/catch. Retiring
 * the card is housekeeping — the state write that makes the batch un-actionable is
 * what actually matters, and it has already happened by the time we're called.
 * Failures are recorded on the span and swallowed.
 */
export async function rejectPendingClaudeAgentApprovalsIfPossible(
    span: TracerSpan,
    {
        apiClient,
        room,
        messageIndex,
    }: {
        apiClient: ApiClient;
        room: ApiMessageRoomReferenceRequest;
        messageIndex: number;
    },
): Promise<void> {
    try {
        await actuallyRejectPendingClaudeAgentApprovals(span, {apiClient, room, messageIndex});
    } catch (error) {
        span.addException(error);
    }
}

async function actuallyRejectPendingClaudeAgentApprovals(
    span: TracerSpan,
    {
        apiClient,
        room,
        messageIndex,
    }: {
        apiClient: ApiClient;
        room: ApiMessageRoomReferenceRequest;
        messageIndex: number;
    },
): Promise<void> {
    await retryWithExponentialBackoff(
        async retry => {
            try {
                const {
                    data: {approvals},
                } = await getApiMessageApprovals(span, apiClient, room, messageIndex);

                const pendingIndexes = filterMapArray(approvals, (approval, index) =>
                    approval.decision.value === undefined ? index : undefined,
                );

                if (pendingIndexes.length === 0) return;

                await patchApiMessageApprovals(
                    span,
                    apiClient,
                    room,
                    messageIndex,
                    pendingIndexes.map(index => ({index, value: {type: "Rejected" as const}})),
                );
            } catch (error) {
                // Most likely a user decided one of the approvals between our read and our patch.
                // Retry against the fresh state.
                throw retry(error);
            }
        },
        {maxAttemptCount: 3},
    );
}
