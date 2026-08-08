import OpenAi from "openai";
import {AgentConversationStore} from "~/server/agents/bots/deprecated/internal/conversation/agent_conversation_store.js";
import {DurableObjectStorageCollection} from "~/server/cloudflare/durable_object_storage_collection.js";
import {ApiMentionReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {emptySet} from "~/shared/helpers/set/empty_set.open_source.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.open_source.js";

export type ChatGptAgentMessageApprovalScope = "Write";

export type ChatGptAgentConversationState = {
    readonly lastOrderKey: OrderKey | null;
    readonly lastMessageIndex: number | null;
    readonly startTime: Date;
    readonly timeZone: TimeZone;
    readonly allowedMessageApprovalScopes: ReadonlySet<ChatGptAgentMessageApprovalScope>;
    readonly currentlyViewingTarget: {
        readonly target: ApiMentionReferenceResponse | null;
        readonly previousTarget: ApiMentionReferenceResponse | null;
        readonly previousInjectTime: Date | null;
    } | null;
};

export const ChatGptAgentConversationStateCollection = new DurableObjectStorageCollection<
    "",
    ChatGptAgentConversationState
>("a1");

export type ChatGptAgentConversationItem = {
    readonly item:
        | OpenAi.Responses.ResponseInputItem.Message
        | OpenAi.Responses.ResponseInputItem.FunctionCallOutput
        | OpenAi.Responses.ResponseOutputItem;
};

export const ChatGptAgentConversationItemCollection = new DurableObjectStorageCollection<
    OrderKey,
    ChatGptAgentConversationItem
>("a2");

export class ChatGptAgentConversationStore extends AgentConversationStore<ChatGptAgentConversationState> {
    private _state: ChatGptAgentConversationState;

    private constructor(state: ChatGptAgentConversationState) {
        super();
        this._state = state;
    }

    public static async new(
        transaction: DurableObjectTransaction,
        {initialTimeZone}: {initialTimeZone: TimeZone},
    ) {
        const state = (await ChatGptAgentConversationStateCollection.get(transaction, "")) ?? {
            lastMessageIndex: null,
            lastOrderKey: null,
            timeZone: initialTimeZone,
            startTime: new Date(),
            currentlyViewingTarget: null,
            allowedMessageApprovalScopes: emptySet,
        };

        return new ChatGptAgentConversationStore(state);
    }

    public getState() {
        return this._state;
    }

    public async setState(
        transaction: DurableObjectTransaction,
        stateUpdate: Partial<ChatGptAgentConversationState>,
    ) {
        this._state = {
            ...this._state,
            ...stateUpdate,
        };

        await ChatGptAgentConversationStateCollection.put(transaction, "", this._state);
    }

    public async insertMessages(
        transaction: DurableObjectTransaction,
        newMessageIndex: number,
        messages: string,
    ) {
        const orderKey = generateOrderKeyBetween(this.getState().lastOrderKey, null);

        await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
            item: {
                type: "message",
                role: "user",
                content: [{type: "input_text", text: messages}],
            },
        });

        await this.setState(transaction, {
            lastOrderKey: orderKey,
            lastMessageIndex: newMessageIndex,
        });
    }

    public async grantApprovedMessageApprovalScope(
        transaction: DurableObjectTransaction,
        scope: ChatGptAgentMessageApprovalScope,
    ) {
        if (this._state.allowedMessageApprovalScopes.has(scope)) return;

        await this.setState(transaction, {
            allowedMessageApprovalScopes: new Set([
                ...this._state.allowedMessageApprovalScopes,
                scope,
            ]),
        });
    }
}
