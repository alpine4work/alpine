import {PutMessageApprovalDecisionsPayload} from "~/shared/messaging/put_message_approval_decisions_payload_schema.js";

/**
 * Record the current account's decisions on a message stream's approval requests.
 *
 * Each messaging room implements this with its realtime WebSocket's
 * `put*ApprovalDecisions` procedure. The room's realtime connection persists the
 * decisions and sends the updated approvals part to every connected client as a
 * `PutMessageStreamPart` event — including the calling connection, before the
 * returned promise resolves. So the approval card just shows a pending spinner
 * until the part updates, with no optimistic bookkeeping.
 */
export type OnPutMessageApprovalDecisionsFunction<RoomKey extends string> = (
    roomKey: RoomKey,
    input: {
        readonly messageIndex: number;
        readonly payload: PutMessageApprovalDecisionsPayload;
    },
) => Promise<void>;
