import {getBot} from "~/server/bots/get_bot.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {getSpaceAccountBotIdIfExists} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {ApiMessageRoomReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {BotWebhookEventId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {applyMessageApprovalDecisionUpdates} from "~/shared/messaging/apply_message_approval_decision_updates.js";
import {
    createMessageApprovalNotFoundError,
    createMessageApprovalRequiresMessageStreamError,
} from "~/shared/messaging/message_approval_error_messages.js";
import {
    MessageExperimentalApproval,
    MessageStreamExperimentalApprovalsPartPayload,
} from "~/shared/messaging/message_schema.js";
import {PutMessageApprovalDecisionsPayload} from "~/shared/messaging/put_message_approval_decisions_payload_schema.js";
import {validateMessageStreamApprovalStatusUpdate} from "~/shared/messaging/validate_message_stream_approval_status_update.js";

/**
 * The result of reading (and authorizing) the approval stream part for a single
 * messaging surface, plus a `commit` callback that writes the updated payload back
 * to that surface's table.
 *
 * Each messaging surface (chat, documents, forum, tasks) supplies a
 * `readApprovalStreamPart` adapter that returns this. The shared
 * `putMessageApprovalDecisions` engine owns the rest of the logic.
 */
export type MessageApprovalStreamPartRead = {
    readonly spaceId: SpaceId;
    readonly message: MessageItem;
    /**
     * Persist `nextPayload` as the new value of the approval stream part and return
     * the part's new version. Called within the same DynamoDB transaction as the read,
     * only when the decisions actually change the payload.
     *
     * This intentionally does NOT broadcast a realtime event. Emitting the updated
     * part is the responsibility of the entry point that knows how the writer is
     * connected: the messaging realtime connection sends `PutMessageStreamPart` events
     * over the caller's WebSocket, while HTTP API callers broadcast to the room's
     * realtime durable object.
     */
    readonly putMessageApprovalPartPayloadWithDecisionValues: (options: {
        partIndex: number;
        createdTime: Date;
        version: number;
        nextPayload: MessageStreamExperimentalApprovalsPartPayload;
    }) => Promise<{version: number}>;
};

/**
 * Apply approval decisions to a message stream's approval part.
 *
 * This is the shared engine behind
 * `put{Chat,DocumentComment,PostComment,TaskComment}MessageApprovalDecisions`. It
 * owns unwrapping the `PutMessageApprovalDecisionsPayload` union, the transaction
 * orchestration, decision application, validation, no-op short-circuit, and the
 * bot-webhook dispatch. The only per-surface logic lives in the
 * `readApprovalStreamPart` adapter, which authorizes the request, reads the
 * surface's stream part, and returns a `commit` callback for the surface's table
 * write. Realtime emission is owned by the caller (see
 * `MessageApprovalStreamPartRead`).
 *
 * Because this engine is the single place that unwraps the payload union, adding a
 * payload variant when the approval flow graduates from experimental doesn't
 * require realtime protocol, realtime connection, or RPC changes.
 */
export async function putMessageApprovalDecisions(
    context: ServerActionContext,
    {
        room,
        messageIndex,
        payload,
        consistency,
        readApprovalStreamPart,
    }: {
        room: ApiMessageRoomReference;
        messageIndex: number;
        payload: PutMessageApprovalDecisionsPayload;
        consistency?: DynamoCacheReadConsistency;
        readApprovalStreamPart: (
            context: ServerActionContext,
            options: {consistency?: DynamoCacheReadConsistency},
        ) => Promise<MessageApprovalStreamPartRead>;
    },
): Promise<{
    spaceId: SpaceId;
    approvals: ReadonlyArray<MessageExperimentalApproval>;
    partIndex: number;
    version: number;
    createdTime: Date;
    completedTime: Date | null;
}> {
    // The decider is always the authenticated actor (a human session through the
    // realtime procedures or a bot through the API). Deriving it here makes it
    // impossible for a decision to be attributed to an account that didn't make it.
    const deciderAccountId = assertExists(context.actor.getPossiblyBotAccountIdIfExists());

    const response = await context.dynamo.retryTransaction(async context => {
        const {spaceId, message, putMessageApprovalPartPayloadWithDecisionValues} =
            await readApprovalStreamPart(context, {consistency});

        if (!message.stream) throw createMessageApprovalRequiresMessageStreamError();

        const requestedByBotAccountId = message.authorId;
        const botId = assertExists(
            await getSpaceAccountBotIdIfExists(context, spaceId, requestedByBotAccountId),
        );

        const {hasWebhookUrl} = await getBot(context, botId, {consistency});

        // If the bot doesn't have a webhook URL, then we can't send the approval decision
        // back to the bot. Instead, we throw an error with a display message so that the
        // user can configure the bot and try to approve/reject the approval again.
        if (!hasWebhookUrl) {
            throw new FailedPreconditionError(
                "Can\u2019t approve a message stream approval if the bot doesn\u2019t have a webhook URL",
                {
                    // TODO(#approvals): Add link to bot settings page after bot settings workstream
                    // completes.
                    displayMessage: errorDisplayMessage`Can\u2019t approve a message stream approval if the \
                    bot doesn\u2019t have a webhook URL. Go to the bots setting page and make sure the webook URL is set.`,
                },
            );
        }

        const lastPartIndex = message.stream.parts.length - 1;
        const lastStreamPart = assertExists(message.stream.parts[lastPartIndex]);

        // Approvals are always the stream's final part. If the last part is something else
        // the message simply has no decidable approvals — a caller-facing not-found, not
        // an internal invariant.
        const currentStreamPartPayload = lastStreamPart.payload;
        if (currentStreamPartPayload.type !== "ExperimentalApprovals") {
            throw createMessageApprovalNotFoundError();
        }

        const decisions = payload.decisions.map(({index, value}) => ({
            index,
            value: {...value, decider: {account: {id: deciderAccountId}}},
        }));

        const result = applyMessageApprovalDecisionUpdates(currentStreamPartPayload, {
            decisions,
            shouldExpandScopeKeys: true,
        });

        if (result.decisionUpdates.length === 0) {
            return {
                spaceId,
                requestedByBotAccountId,
                requestedByBotId: botId,
                result,
                partIndex: lastPartIndex,
                version: lastStreamPart.version,
                createdTime: lastStreamPart.createdTime,
                completedTime: message.stream.completedTime,
            };
        }

        validateMessageStreamApprovalStatusUpdate(currentStreamPartPayload, result.approvalPayload);

        const {version} = await putMessageApprovalPartPayloadWithDecisionValues({
            ...lastStreamPart,
            partIndex: lastPartIndex,
            nextPayload: result.approvalPayload,
        });

        return {
            spaceId,
            requestedByBotAccountId,
            requestedByBotId: botId,
            result,
            partIndex: lastPartIndex,
            version,
            createdTime: lastStreamPart.createdTime,
            completedTime: message.stream.completedTime,
        };
    });

    const {spaceId, result, partIndex, version, createdTime, completedTime} = response;
    const approvals = result.approvalPayload.approvals;
    if (result.decisionUpdates.length === 0) {
        return {spaceId, approvals, partIndex, version, createdTime, completedTime};
    }

    // NOTE(ifitzsimmons, 2026-06-26): We can end up in a weird state if the webhook
    // request never makes it to the agent. Our database will show that the decision
    // was made, but the bot will never see it, and won't know what to do with its
    // pending requests.
    //
    // The next time the bot sees a message, it will try canceling its pending
    // requests, which will fail (though it should at least consider them all pending
    // approvals as declined). The end-user impact here is that nothing will happen
    // when they select the approval option and they'll have to prompt the agent again.
    await context.tracer.withSpan(
        "Send updated message stream part approvals job",
        async (context, span) => {
            span.addPropagatedData({
                context: {
                    botId: response.requestedByBotId,
                    botAccountId: response.requestedByBotAccountId,
                },
            });

            // NOTE(ifitzsimmons, 2026-06-30): One thing that's sort of burried here is the
            // fact that approval decisions do not go through the notifications framework,
            // which would typically be the mechanism for sending the "CallBotWebhook" job.
            //
            // If we think that there's a strong use case for sending notifications for
            // approval actions, we should add a new notification processor and queue the
            // "CallBotWebhook" job from there.
            await context.jobs.sendAndWait({
                type: "CallBotWebhook",
                spaceId,
                eventId: generateChronologicalId<BotWebhookEventId>(),
                botId: response.requestedByBotId,
                botAccountId: response.requestedByBotAccountId,
                event: {
                    type: "UpdatedMessageStreamExperimentalApprovalsPart",
                    room,
                    messageIndex,
                    approvals,
                },
            });
        },
    );

    return {spaceId, approvals, partIndex, version, createdTime, completedTime};
}
