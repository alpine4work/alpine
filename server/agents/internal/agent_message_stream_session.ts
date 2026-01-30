import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {
    completeApiMessageStream,
    createApiMessage,
    pingApiMessageStream,
    putApiMessageStreamPart,
} from "~/server/agents/api/api_client.js";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {convertApiContentToProperQuotes} from "~/server/agents/internal/convert_api_content_to_proper_quotes.js";
import {AgentMessageStream} from "~/server/api/markdown/agent_message_stream.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {agentMessageStreamPingIntervalMs} from "~/shared/agents/default_agent_message_ping_interval_ms.js";
import {
    ApiMessageResponse,
    ApiMessageStreamPartPayload,
    ApiMessageStreamToolCallPartPayloadCall,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

interface AgentMessageStreamSessionInterface {
    /**
     * Pushes text into the message stream. The `AgentMessageStream` class is
     * responsible for "chunking" incoming text into API Content parts.
     *
     * API updates are throttled to once every 100ms via a timeout. When text is
     * pushed, we set the 100ms timeout if it doesn't already exist. When the new or
     * existing timeout expires, we call the `AgentMessageStream`'s `update()` method
     * which processes all text since the last update.
     */
    pushText(span: TracerSpan, text: string): void;

    /**
     * Pushes a tool call into the message stream. When a tool call is pushed into the
     * message stream, we clear whatever update timeout exists and send the tool call
     * to the API along with any text that's been pushed into the session since the last
     * update ran.
     */
    pushToolCall(span: TracerSpan, call: ApiMessageStreamToolCallPartPayloadCall): void;

    /**
     * Pushes a reasoning call into the message stream. When a reasoning call is pushed
     * into the message stream, we clear whatever update timeout exists and send the
     * reasoning call to the API along with any text that's been pushed into the session
     * since the last update ran.
     */
    pushReasoningSummary(span: TracerSpan, summary: string): void;

    /**
     * As the agent responds to the request, it may make many tool calls. We track the
     * estimated token count of all tool calls made during a single request to the
     * agent by calling this method with the string output of the tool call.
     */
    updateFunctionCallOutputTokenCount(functionCallOutput: string): void;

    /**
     * When an `AgentMessageStreamSession` is created, we create an empty message in
     * the API with `isStream = true` which returns the index of the newly created
     * message. We use this index to update the message's stream parts as well as
     * update the agent conversation state.
     */
    newMessageIndex: number;

    /**
     * The estimated token count of all tool calls made during a single request to
     * the agent by calling this method with the string output of the tool call.
     * We use this in our agent logic when deciding whether we should make a tool
     * call or not. If we have surpassed the limit, we raise an error to the LLM.
     *
     * **This is handled outside of the `AgentMessageStreamSession` class.**
     */
    functionCallOutputTokenCount: number;
}

export class AgentMessageStreamSession implements AgentMessageStreamSessionInterface {
    private _pingInterval: Interval | null = null;

    private _mutex = new Mutex();

    private _request: AgentWebhookRequest;

    private _parentSpan: TracerSpan;

    private _newMessageIndex: number;

    private _agentMessageStream: AgentMessageStream;

    private _updateThrottleMs = 100;
    private _updateTimeout: Timeout | null = null;

    private _functionCallOutputTokenCount = 0;

    private _shouldRestartIntervalAfterUpdate = true;

    get newMessageIndex(): number {
        return this._newMessageIndex;
    }

    get functionCallOutputTokenCount(): number {
        return this._functionCallOutputTokenCount;
    }

    private constructor(
        span: TracerSpan,
        request: AgentWebhookRequest,
        newMessageIndex: number,
        agentMessageStream: AgentMessageStream,
    ) {
        this._agentMessageStream = agentMessageStream;
        this._request = request;
        this._newMessageIndex = newMessageIndex;
        this._parentSpan = span;

        this._startPingInterval();
    }

    static async with<T>(
        span: TracerSpan,
        request: AgentWebhookRequest,
        conversationTimeZone: TimeZone,
        agentMessageStream: AgentMessageStream,
        action: (session: AgentMessageStreamSession) => Promise<T>,
    ): Promise<T> {
        const {index: newMessageIndex} = await createAgentEmptyStreamMessage(
            span,
            request,
            conversationTimeZone,
        );
        const session = new AgentMessageStreamSession(
            span,
            request,
            newMessageIndex,
            agentMessageStream,
        );

        try {
            return await action(session);
        } finally {
            await session._completeStream(span);
        }
    }

    pushText(span: TracerSpan, text: string) {
        this._agentMessageStream.pushText(span, text);

        // We throttle updates to once every 100ms instead of once every token
        // OpenAI sends us.
        if (this._updateTimeout === null) {
            this._updateTimeout = createTimeout(() => {
                this._updateTimeout = null;
                void this._update(span);
            }, this._updateThrottleMs);
        }
    }

    pushToolCall(span: TracerSpan, call: ApiMessageStreamToolCallPartPayloadCall) {
        this._clearUpdateTimeout();
        void this._update(span, [{type: "ToolCall", call}]);
    }

    pushReasoningSummary(span: TracerSpan, summary: string) {
        this._clearUpdateTimeout();
        void this._update(span, [
            {
                type: "Reasoning",
                content: parseApiContentFromMarkdown(summary, {spaceId: this._request.spaceId}),
            },
        ]);
    }

    updateFunctionCallOutputTokenCount(functionCallOutput: string) {
        this._functionCallOutputTokenCount += countO200kBaseTokens(functionCallOutput);
    }

    private _update(
        updateSpan: TracerSpan,
        newPartPayloads?: Array<Exclude<ApiMessageStreamPartPayload, {type: "Content"}>>,
    ) {
        return this._mutex.withLock(async () => {
            const putParts = await this._agentMessageStream.update(updateSpan, newPartPayloads);
            if (putParts.length === 0) return;

            // Calling `putApiMessageStreamPart()` also pings the message stream. So cancel
            // our current interval and re-schedule it after we've finished updating.
            this._clearPingInterval();

            try {
                // TODO(calebmer): We should consider adding a batch `PUT` API. That would be
                // more efficient than making two separate `PUT` requests when `update()`
                // returns multiple parts.
                for (const {span, part: originalPart} of putParts) {
                    let part = originalPart;

                    if (part.payload.type === "Content" || part.payload.type === "Reasoning") {
                        let content = part.payload.content;

                        // Convert all straight quotes (`'` and `"`) into proper curly quotes
                        // (`"`, `"`, `'`, `'`). Since LLMs typically only output straight quotes.
                        // Curly quotes are proper typography and are consistent with text written in
                        // Alpine where we automatically convert quotes into curly quotes.
                        content = convertApiContentToProperQuotes(part.payload.content);

                        if (content !== part.payload.content) {
                            part = {...part, payload: {...part.payload, content}};
                        }
                    }

                    await putApiMessageStreamPart(
                        span,
                        this._request.apiClient,
                        this._request.room,
                        this._newMessageIndex,
                        part.index,
                        {payload: part.payload},
                    );
                }
            } finally {
                // Start the ping timeout schedule again since we cleared the timeout earlier.
                if (this._shouldRestartIntervalAfterUpdate) {
                    this._startPingInterval();
                }
            }
        });
    }

    private async _completeStream(span: TracerSpan) {
        // Let's say a stream part comes in a T0 and the stream is completed at T50 (ms)
        // the `update()` call won't run for another 50ms. When that update call runs
        // we don't want it to restart the interval after sending the last parts to the
        // API
        this._shouldRestartIntervalAfterUpdate = false;
        this._clearPingInterval();

        // `createChatGptAgentResponse()` may call `messageState.pushText()` and set
        // `updateTimeout`.
        this._clearUpdateTimeout();
        void this._update(span);

        this._clearPingInterval();
        await this._mutex.waitForUnlock();

        await completeApiMessageStream(
            this._parentSpan,
            this._request.apiClient,
            this._request.room,
            this._newMessageIndex,
        );
    }

    private _startPingInterval() {
        assert(this._pingInterval === null);

        this._pingInterval = createInterval(() => {
            void this._mutex.withLock(async () => {
                await pingApiMessageStream(
                    this._parentSpan,
                    this._request.apiClient,
                    this._request.room,
                    this._newMessageIndex,
                );
            });
        }, agentMessageStreamPingIntervalMs);
    }

    private _clearUpdateTimeout() {
        this._updateTimeout?.clear();
        this._updateTimeout = null;
    }

    private _clearPingInterval() {
        this._pingInterval?.clear();
        this._pingInterval = null;
    }
}

async function createAgentEmptyStreamMessage(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    conversationTimeZone: TimeZone,
): Promise<ApiMessageResponse> {
    // TODO(calebmer, #ai): When you're talking to AI in a messaging room we
    // probably shouldn't update an inbox entry if you're viewing the AI's
    // response. What's the right heuristic here?
    //
    // This is also kind of a problem when you're chatting with someone in general.
    // The entry keeps getting added/removed from the inbox as you interact.
    // Ideally we should "suppress" notification events for some amount of time
    // right after you respond.
    const {
        data: {message},
    } = await createApiMessage(tracer, request.apiClient, request.room, {
        isStream: true,
        content: {elements: []},
        createdTimeZone: conversationTimeZone,
    });

    return message;
}
