import {
    DurableObjectStorageCollection,
    DurableObjectStorageInterface,
    DurableObjectTransactionInterface,
} from "~/server/cloudflare/durable_object_storage_collection.js";
import {
    ApiMessageExperimentalApprovalDecision,
    ApiMessageExperimentalApprovalDecisionApprovedForSessionOption,
    ApiMessageExperimentalApprovalDecisionOption,
    ApiMessageExperimentalApprovalDecisionSchema,
    ApiMessageExperimentalApprovalDecisionValue,
    ApiMessageRoomReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type ChatGptAgentApprovedForSessionApprovalDecisionOption = Omit<
    ApiMessageExperimentalApprovalDecisionApprovedForSessionOption,
    "scope" | "summary"
> & {
    readonly scope: {value: "Write"};
};

export type ChatGptAgentMessageApprovalDecisionOption =
    | Extract<ApiMessageExperimentalApprovalDecisionOption, {type: "Approved" | "Rejected"}>
    | ChatGptAgentApprovedForSessionApprovalDecisionOption;

type ChatGptAgentApprovalDecisionSchema = ApiMessageExperimentalApprovalDecisionSchema & {
    readonly options: ReadonlyArray<ChatGptAgentMessageApprovalDecisionOption>;
};

export type ChatGptAgentMessageApprovalDecision = ApiMessageExperimentalApprovalDecision & {
    readonly schema: ChatGptAgentApprovalDecisionSchema;
};

export type ChatGptAgentMessageApprovalItem = {
    readonly options: ReadonlyArray<ChatGptAgentMessageApprovalDecisionOption>;
    readonly response?: ApiMessageExperimentalApprovalDecisionValue;
};

/**
 * A tool call the agent has paused awaiting human approval.
 *
 * The provider call ID remains private to the agent. The public approval card is
 * addressed by the stream message index and approval index.
 */
export type ChatGptAgentMessageApproval = {
    /**
     * The account that prompted the agent to request this approval. Stored for
     * attribution (usage tracking, created content authorship). Authorization of who
     * may decide an approval is enforced by the Alpine API before the decision webhook
     * is dispatched, so this field is not an agent-side access check.
     */
    readonly requesterAccountId: AccountId;
    readonly room: ApiMessageRoomReference;
    /** The index of the agent message whose stream holds the approval card. */
    readonly messageIndex: number;
    readonly approvals: ReadonlyArray<ChatGptAgentMessageApprovalItem>;
    /**
     * This is guaranteed to be a valid access token. When the agent state is cleaned
     * up, we use this to make a best-effort attempt to reject the approval.
     *
     * This is a long-lived, room-scoped bot token persisted at rest for at most the
     * Durable Object's storage lifetime: the `ClearStorage` alarm wipes all storage
     * (including this token) after ~6 hours of inactivity, rejecting any approvals
     * that are still pending first.
     */
    readonly apiAccessToken: string;
};

const ChatGptAgentPendingMessageApprovalCollection = new DurableObjectStorageCollection<
    "PendingMessageApproval",
    ChatGptAgentMessageApproval
>("a7");

const ChatGptAgentFunctionCallIdToApprovalIndexCollection = new DurableObjectStorageCollection<
    string,
    {
        readonly messageIndex: number;
        readonly approvalIndex: number;
    }
>("a8");

const ChatGptAgentDecidedMessageApprovalCollection = new DurableObjectStorageCollection<
    `MessageIndex-${number}`, // `messageIndex`
    ChatGptAgentMessageApproval
>("a9");

export async function putChatGptAgentPendingMessageApproval(
    span: TracerSpan,
    transaction: DurableObjectTransactionInterface,
    {
        room,
        messageIndex,
        apiAccessToken,
        requesterAccountId,
        approvals,
    }: {
        room: ApiMessageRoomReference;
        messageIndex: number;
        apiAccessToken: string;
        requesterAccountId: AccountId;
        approvals: ReadonlyArray<{
            readonly functionCallId: string;
            readonly options: ReadonlyArray<ChatGptAgentMessageApprovalDecisionOption>;
            readonly response?: ApiMessageExperimentalApprovalDecisionValue;
        }>;
    },
): Promise<void> {
    await span.withSpan("Put message approvals", () =>
        runAllPromises([
            ChatGptAgentPendingMessageApprovalCollection.put(
                transaction,
                "PendingMessageApproval",
                {
                    requesterAccountId,
                    room,
                    messageIndex,
                    // Strip `functionCallId` so the provider call ID isn't persisted on the
                    // public-facing approval items. It's tracked separately in
                    // `ChatGptAgentFunctionCallIdToApprovalKeyCollection`.
                    approvals: approvals.map(approval => ({
                        options: approval.options.map(option => {
                            if (option.type !== "ApprovedForSession") return option;

                            // Omit summary from option type.
                            return {
                                type: option.type,
                                scope: option.scope,
                                durationMinutes: option.durationMinutes,
                            };
                        }),
                        response: approval.response,
                    })),
                    apiAccessToken,
                },
            ),
            ...approvals.map((approval, index) =>
                ChatGptAgentFunctionCallIdToApprovalIndexCollection.put(
                    transaction,
                    approval.functionCallId,
                    {messageIndex, approvalIndex: index},
                ),
            ),
        ]),
    );
}

export async function getChatGptAgentDecidedApprovalResponseByCallIdIfExists(
    storage: DurableObjectStorageInterface,
    providerCallId: string,
): Promise<ApiMessageExperimentalApprovalDecisionValue | undefined> {
    const approvalKey = await ChatGptAgentFunctionCallIdToApprovalIndexCollection.get(
        storage,
        providerCallId,
    );
    if (!approvalKey) return undefined;

    const decidedApproval = await ChatGptAgentDecidedMessageApprovalCollection.get(
        storage,
        `MessageIndex-${approvalKey.messageIndex}`,
    );
    if (!decidedApproval) return undefined;

    return assertExists(decidedApproval.approvals[approvalKey.approvalIndex]?.response);
}

/**
 * The stored approval record along with the indexes of its approvals that are
 * still awaiting a decision. Returns undefined when there is no record or when
 * every approval is decided — a fully decided record is inert history from the
 * batch whose turn already resumed, and it stays in the slot until the next batch
 * replaces it.
 */
export async function getChatGptAgentPendingMessageApprovalIfExistsWithPendingApprovalIndexes(
    storage: DurableObjectStorageInterface,
): Promise<
    | {
          approval: ChatGptAgentMessageApproval;
          indexes: Set<number>;
      }
    | undefined
> {
    const pendingMessageApproval = await ChatGptAgentPendingMessageApprovalCollection.get(
        storage,
        "PendingMessageApproval",
    );
    if (!pendingMessageApproval) return undefined;

    const pendingApprovalIndexes = new Set<number>();

    for (let index = 0; index < pendingMessageApproval.approvals.length; index++) {
        const approval = assertExists(pendingMessageApproval.approvals[index]);
        if (approval.response) continue;

        pendingApprovalIndexes.add(index);
    }

    if (pendingApprovalIndexes.size === 0) return undefined;

    return {
        approval: pendingMessageApproval,
        indexes: pendingApprovalIndexes,
    };
}

export async function decidePendingMessageApproval(
    span: TracerSpan,
    transaction: DurableObjectTransactionInterface,
    approval: ChatGptAgentMessageApproval,
): Promise<void> {
    await span.withSpan("Decide message approval", () =>
        runAllPromises([
            ChatGptAgentDecidedMessageApprovalCollection.put(
                transaction,
                `MessageIndex-${approval.messageIndex}`,
                approval,
            ),
            ChatGptAgentPendingMessageApprovalCollection.delete(
                transaction,
                "PendingMessageApproval",
            ),
        ]),
    );
}

export async function putChatGptAgentPendingMessageApprovalDecision(
    span: TracerSpan,
    transaction: DurableObjectTransactionInterface,
    approval: ChatGptAgentMessageApproval,
): Promise<void> {
    if (approval.approvals.every(approval => approval.response !== undefined)) {
        await decidePendingMessageApproval(span, transaction, approval);
        return;
    }

    await ChatGptAgentPendingMessageApprovalCollection.put(
        transaction,
        "PendingMessageApproval",
        approval,
    );
}

export async function getChatGptAgentDecidedMessageApprovalIfExists(
    storage: DurableObjectStorageInterface,
    messageIndex: number,
): Promise<ChatGptAgentMessageApproval | undefined> {
    return await ChatGptAgentDecidedMessageApprovalCollection.get(
        storage,
        `MessageIndex-${messageIndex}`,
    );
}
