import {ApiMentionReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

export type AgentConversationState = {
    readonly lastMessageIndex: number | null;
    /**
     * Marks the start time of the conversation _state_. In other words, it marks the
     * time that the Durable Object was created. Notably, this is not the same as the
     * conversation start time.
     *
     * Example:
     *
     * - Conversation started two years ago, 2023-11-13 12:00:00 UTC
     * - I ask ChatGPT a question on 2025-11-13 12:00:00 UTC
     * - `startTime` = 2025-11-13 12:00:00 UTC
     */
    readonly startTime: Date;
    /**
     * The timezone of the user whose message triggered the durable object creation.
     *
     * Example:
     *
     * - Alice in NYC created the conversation on 2023-11-13 12:00:00 EST
     * - Bob in Los Angeles mentioned GPT on 2025-11-13 12:00:00 PST
     * - `timeZone` = PST & `startTime` = 2025-11-13 12:00:00 PST
     */
    readonly timeZone: TimeZone;

    readonly currentlyViewingTarget: {
        readonly target: ApiMentionReference | null;
        readonly previousTarget: ApiMentionReference | null;
        readonly previousInjectTime: Date | null;
    } | null;
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
