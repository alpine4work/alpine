import {OrderKey} from "~/shared/helpers/sort/order_key.js";

export type AgentConversationState = {
    readonly lastOrderKey: OrderKey | null;
    readonly lastMessageIndex: number | null;
};

export interface AgentConversationStateStore {
    get(): AgentConversationState;
    set(
        transaction: DurableObjectTransaction,
        stateUpdate: Partial<AgentConversationState>,
    ): Promise<void>;
}
