import OpenAi from "openai";
import {AgentConversationStore} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {DurableObjectStorageCollection} from "~/server/agents/internal/durable_object_storage_collection.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";

export type ChatGptAgentConversationState = {
    readonly lastOrderKey: OrderKey | null;
    readonly lastMessageIndex: number | null;
    readonly startTime: Date;
    readonly timeZone: TimeZone;
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
}
