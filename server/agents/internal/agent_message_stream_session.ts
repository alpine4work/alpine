import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {
    completeApiMessageStream,
    createApiMessage,
    pingApiMessageStream,
    putApiMessageStreamPart,
} from "~/server/agents/api/api_client.js";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {convertApiContentToProperQuotes} from "~/server/agents/internal/convert_api_content_to_proper_quotes.js";
import {agentMessageStreamPingIntervalMs} from "~/shared/agents/default_agent_message_ping_interval_ms.js";
import {AgentMessageStream} from "~/shared/api/markdown/agent_message_stream.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    ApiMessageResponse,
    ApiMessageStreamApprovalsPartPayload,
    ApiMessageStreamPartPayload,
    ApiMessageStreamToolCallPartPayloadCall,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

interface AgentMessageStreamSessionInterface {
    /**
     * Buffer incoming text deltas and coalesce them. We do NOT immediately mutate
     * AgentMessageStream here; instead we batch text for up to `_updateThrottleMs`
     * milliseconds. When the throttle fires we push the coalesced text into the
     * AgentMessageStream while holding the session mutex and schedule an `_update`.
     *
     * Rationale / ordering guarantees:
     *
     * - Buffering avoids creating an API update for every token/event from OpenAI.
     * - When the timeout fires, the buffered text is pushed into AgentMessageStream
     *   under the mutex using `_pushTextIntoAgentMessageStream`. Because _push_ and
     *   the later `_update()` calls are both enqueued on the same mutex, any
     *   previously queued updates (e.g. pending reasoning/tool updates) run before
     *   this text push. This prevents late-arriving text from appearing before
     *   already-queued non-content parts.
     *
     * Example: (OpenAI order: reasoning(a), reasoning(b), output_text.delta)
     *
     * - reasoning(a) → calls \_update(a) and acquires mutex (U_a)
     * - reasoning(b) → queued \_update(b) (U_b)
     * - output_text.delta → pushText buffers text and schedules timeout
     * - timeout fires → pushes text under mutex (queued after U_b), schedules \_update
     * - mutex executes U_a → U_b → pushText → \_update(text) -> persisted order:
     *   reasoning(a), reasoning(b), content(text)
     */
    pushText(span: TracerSpan, text: string): void;

    /**
     * These are non-content (semantic) parts that must be persisted with correct
     * ordering relative to buffered text. Before creating their `_update(...)` request
     * we flush any buffered text we currently hold via `_flushUpdateTextState`.
     *
     * Behavior:
     *
     * - \_flushUpdateTextState clears the throttle timeout, grabs the buffered text,
     *   and pushes it into the AgentMessageStream using
     *   `_pushTextIntoAgentMessageStream`.
     * - Then we call `_update(span, newPartPayloads)` which is serialized by the
     *   mutex.
     *
     * Example: (OpenAI order: output_text.delta, reasoning(b))
     *
     * - output_text.delta → pushText buffers text
     * - reasoning(b) arrives → pushReasoningSummary will call \_flushUpdateTextState()
     *   (forcing the buffered text into the AgentMessageStream), then enqueue the
     *   reasoning update. When the next `_update()` runs, content will be persisted
     *   then reasoning, preserving the original ordering.
     */
    pushToolCall(span: TracerSpan, call: ApiMessageStreamToolCallPartPayloadCall): void;

    /**
     * Push an interactive approval-request card: the agent paused, awaiting human
     * approval for a proposed action. Like other non-content parts, this flushes
     * buffered text first to preserve ordering.
     */
    pushApprovalRequest(span: TracerSpan, payload: ApiMessageStreamApprovalsPartPayload): void;

    /**
     * These are non-content (semantic) parts that must be persisted with correct
     * ordering relative to buffered text. Before creating their `_update(...)` request
     * we flush any buffered text we currently hold via `_flushUpdateTextState`.
     *
     * Behavior:
     *
     * - \_flushUpdateTextState clears the throttle timeout, grabs the buffered text,
     *   and pushes it into the AgentMessageStream using
     *   `_pushTextIntoAgentMessageStream`.
     * - Then we call `_update(span, newPartPayloads)` which is serialized by the
     *   mutex.
     *
     * Example: (OpenAI order: output_text.delta, reasoning(b))
     *
     * - output_text.delta → pushText buffers text
     * - reasoning(b) arrives → pushReasoningSummary will call \_flushUpdateTextState()
     *   (forcing the buffered text into the AgentMessageStream), then enqueue the
     *   reasoning update. When the next `_update()` runs, content will be persisted
     *   then reasoning, preserving the original ordering.
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
     * The estimated token count of all tool calls made during a single request to the
     * agent by calling this method with the string output of the tool call. We use
     * this in our agent logic when deciding whether we should make a tool call or not.
     * If we have surpassed the limit, we raise an error to the LLM.
     *
     * **This is handled outside of the `AgentMessageStreamSession` class.**
     */
    functionCallOutputTokenCount: number;
}

/**
 * Coordinates streaming updates for a single agent response message.
 *
 * Responsibilities / invariants:
 *
 * - Provide a single logical ordering for all changes that mutate the
 *   AgentMessageStream and for all calls that persist stream parts to the API.
 * - Ensure that non-content parts (Reasoning, ToolCall, etc.) never end up
 *   visually interrupting content that logically arrived earlier (and vice versa).
 * - Throttle rapid text deltas into content parts (100ms) while ensuring that when
 *   a non-content part is processed we first persist any text that arrived before
 *   it.
 *
 * Key idea:
 *
 * - Text deltas are buffered in `_updateTextState`. They are only pushed into
 *   `AgentMessageStream` while holding the session mutex. All calls that persist
 *   parts to the API (`_update(...)`) also run under the same mutex. This makes
 *   the mutex the single serialization point for both (a) text entering the
 *   message stream and (b) persisting parts to the API, preventing ordering races.
 *
 * Important assumptions:
 *
 * - Mutex.withLock is FIFO (ordering of queued lock requests is preserved).
 * - AgentMessageStream.update() parses a snapshot of the text state and leaves any
 *   concurrent appends in the leftover `_textState` for the next update.
 */
export class AgentMessageStreamSession implements AgentMessageStreamSessionInterface {
    private _isCompleted = false;

    private _pingInterval: Interval | null = null;

    private _mutex = new Mutex();

    private _request: AgentWebhookRequest;

    private _parentSpan: TracerSpan;

    private _newMessageIndex: number;

    private _agentMessageStream: AgentMessageStream;

    private _updateThrottleMs = 100;
    private _updateTextState: {
        text: string;
        updateTimeout: Timeout;
        span: TracerSpan;
    } | null = null;

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
        assert(!this._isCompleted);

        // We throttle updates to once every 100ms instead of once every token OpenAI sends
        // us.
        if (this._updateTextState === null) {
            const updateTimeout = createTimeout(() => {
                assert(this._updateTextState !== null);

                const {span, text} = this._updateTextState;
                this._updateTextState = null;

                this._pushTextIntoAgentMessageStream(span, text);
                void this._update(span);
            }, this._updateThrottleMs);

            this._updateTextState = {text: text, updateTimeout, span};
        } else {
            this._updateTextState.span = span;
            this._updateTextState.text += text;
        }
    }

    pushToolCall(span: TracerSpan, call: ApiMessageStreamToolCallPartPayloadCall) {
        assert(!this._isCompleted);
        this._flushUpdateTextState();
        void this._update(span, [{type: "ToolCall", call}]);
    }

    pushApprovalRequest(span: TracerSpan, payload: ApiMessageStreamApprovalsPartPayload) {
        assert(!this._isCompleted);
        this._flushUpdateTextState();
        void this._update(span, [payload]);
    }

    pushReasoningSummary(span: TracerSpan, summary: string) {
        assert(!this._isCompleted);

        // If we have streamed text into the session, flush it to the API before pushing
        // the reasoning summary. Doing this here ensures proper ordering of events. For
        // exmaple
        //
        // 1. pushReasoningSummary(response.reasoning_summary_part.done (a))
        // 2. pushReasoningSummary(response.reasoning_summary_part.done (b))
        // 3. pushText(response.output_text.delta (a))
        //
        // Since we place a mutex on updating the API, we want to make sure that these
        // updates are sent to the API in the correct order. So let's say that
        // `response.reasoning_summary_part.done` (b) is waiting on part (a) to finish.
        // Well, since we flush the update text _before_ waiting for the mutex to unlock
        // there shouldn't be any unexpected text in between parts (a) and (b).
        //
        // In the past, we pushed all text to the `AgentMessageStream` as soon as we
        // received it. So in the above scenario, what actually happens is
        //
        // 1. `AgentMessageStreamSession` receives reaonsing summary (a) and submits the
        //    API request
        // 2. `AgentMessageStreamSession` receives reasoning summary (b) and waits for the
        //    mutex to unlock
        // 3. `AgentMessageStreamSession` receives text (a) and pushes it to the
        //    `AgentMessageStream`.
        // 4. The mutex unlocks, the API call for reasoning summary (b) is made, but now
        //    text (a) is already in the stream.
        //
        // So the general pattern here is that we "merge" adjacent text calls and send them
        // to the API once every 100ms. However, if a non-content part is sent while
        // "merging" adjacent text parts, we send whatever text parts we have buffered to
        // the API and then we send the non-content part.
        this._flushUpdateTextState();
        void this._update(span, [
            {
                type: "Reasoning",
                content: parseApiContentFromMarkdown(summary),
            },
        ]);
    }

    updateFunctionCallOutputTokenCount(functionCallOutput: string) {
        assert(!this._isCompleted);
        this._functionCallOutputTokenCount += countO200kBaseTokens(functionCallOutput);
    }

    /**
     * If there is buffered text in `_updateTextState`, cancel its timeout and push it
     * into the `AgentMessageStream`. This method does not itself await the mutex; it
     * uses `_pushTextIntoAgentMessageStream` which schedules the push under the mutex.
     * After flushing, the buffered text is cleared.
     *
     * Important note:
     *
     * - We avoid pushing buffered text into AgentMessageStream directly without the
     *   mutex because that could allow asynchronous `_update` calls (already queued)
     *   to observe the text at the wrong time and violate ordering.
     */
    private _flushUpdateTextState() {
        if (this._updateTextState === null) return;

        const {span, text, updateTimeout} = this._updateTextState;
        updateTimeout.clear();
        this._updateTextState = null;

        this._pushTextIntoAgentMessageStream(span, text);
    }

    /**
     * Acquire the mutex and call `AgentMessageStream.update`. `update()` returns parts
     * that need to be PUT to the API. All actual PUTs are performed while still within
     * the mutex boundary (the API calls themselves are awaited, but they run while the
     * session still logically holds ordering via the mutex).
     *
     * Notes:
     *
     * - AgentMessageStream.update() expects that `_textState` has been populated by
     *   `_pushTextIntoAgentMessageStream()` when appropriate. The update call will
     *   parse a snapshot of the text state and build content parts (if any), then
     *   append any non-content `newPartPayloads` provided.
     */
    private _update(
        updateSpan: TracerSpan,
        newPartPayloads?: Array<Exclude<ApiMessageStreamPartPayload, {type: "Content"}>>,
    ) {
        return this._mutex.withLock(async () => {
            const putParts = await this._agentMessageStream.update(updateSpan, newPartPayloads);
            if (putParts.length === 0) return;

            // Calling `putApiMessageStreamPart()` also pings the message stream. So cancel our
            // current interval and re-schedule it after we've finished updating.
            this._clearPingInterval();

            try {
                // TODO(calebmer): We should consider adding a batch `PUT` API. That would be more
                // efficient than making two separate `PUT` requests when `update()` returns
                // multiple parts.
                for (const {span, part: originalPart} of putParts) {
                    let part = originalPart;

                    if (part.payload.type === "Content" || part.payload.type === "Reasoning") {
                        let content = part.payload.content;

                        // Convert all straight quotes (`'` and `"`) into proper curly quotes (`"`, `"`,
                        // `'`, `'`). Since LLMs typically only output straight quotes. Curly quotes are
                        // proper typography and are consistent with text written in Alpine where we
                        // automatically convert quotes into curly quotes.
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
        assert(!this._isCompleted);
        this._isCompleted = true;

        // Let's say a stream part comes in a T0 and the stream is completed at T50 (ms)
        // the `update()` call won't run for another 50ms. When that update call runs we
        // don't want it to restart the interval after sending the last parts to the API
        this._shouldRestartIntervalAfterUpdate = false;
        this._clearPingInterval();

        // `createChatGptAgentResponse()` may call `messageState.pushText()` and set
        // `updateTimeout`.
        this._flushUpdateTextState();
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

    private _clearPingInterval() {
        this._pingInterval?.clear();
        this._pingInterval = null;
    }

    /**
     * Pushes text into the AgentMessageStream while holding the session mutex. This
     * ensures that all text pushes and all `_update` operations are serialized by the
     * same mutex, giving us a single ordering surface.
     *
     * This helper purposely uses `this._mutex.withLock(...)` so the actual mutation of
     * `AgentMessageStream` occurs as a queued operation and cannot race with other
     * queued `_update(...)` calls.
     *
     * Example ordering (queued lock order matters):
     *
     * - queued: \_update(b) (reasoning), queued:
     *   \_pushTextIntoAgentMessageStream(text) Because the mutex is FIFO, \_update(b)
     *   runs before the text push, which prevents the text from appearing before
     *   reasoning(b) when text logically arrived later.
     */
    private _pushTextIntoAgentMessageStream(span: TracerSpan, text: string) {
        void this._mutex.withLock(async () => {
            this._agentMessageStream.pushText(span, text);
        });
    }
}

async function createAgentEmptyStreamMessage(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    conversationTimeZone: TimeZone,
): Promise<ApiMessageResponse> {
    // TODO(calebmer, #ai): When you're talking to AI in a messaging room we probably
    // shouldn't update an inbox entry if you're viewing the AI's response. What's the
    // right heuristic here?
    //
    // This is also kind of a problem when you're chatting with someone in general. The
    // entry keeps getting added/removed from the inbox as you interact. Ideally we
    // should "suppress" notification events for some amount of time right after you
    // respond.
    const {
        data: {message},
    } = await createApiMessage(tracer, request.apiClient, request.room, {
        isStream: true,
        content: {elements: []},
        createdTimeZone: conversationTimeZone,
    });

    return message;
}
