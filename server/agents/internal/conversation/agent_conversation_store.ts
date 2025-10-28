export type AgentConversationState = {
    readonly lastMessageIndex: number | null;
};

export abstract class AgentConversationStore<
    State extends AgentConversationState = AgentConversationState,
> {
    public abstract getState(): State;

    public abstract setState(
        transaction: DurableObjectTransaction,
        stateUpdate: Partial<State>,
    ): Promise<void>;

    public abstract insertMessages(
        transaction: DurableObjectTransaction,
        newMessageIndex: number,
        messages: string,
    ): Promise<void>;
}
