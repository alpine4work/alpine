import {
    ApiClient,
    completeApiMessageStream,
    createApiMessageStreamPart,
    pingApiMessageStream,
    putApiMessageStreamPart,
} from "~/server/agents/api/api_client.open_source.js";
import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.open_source.js";
import {messageStreamPingIntervalMs} from "~/shared/agents/message_stream_ping_interval_ms.js";
import {convertApiContentToProperQuotes} from "~/shared/api/content/convert_api_content_to_proper_quotes.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {printErrorDisplayMessageToApiContent} from "~/shared/api/content/print_error_display_message_to_api_content.js";
import {
    ApiContent,
    ApiMessageRoomReference,
    ApiMessageStreamExperimentalApprovalsPartPayload,
    ApiMessageStreamPartPayload,
    ApiMessageStreamToolCallPartPayloadCall,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {getErrorDisplayMessage} from "~/shared/error/default_error_display_message.open_source.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

const agentWebMessageStreamTerminalErrorDisplayMessage = errorDisplayMessage`An unexpected error occurred.`;

interface AgentWebMessageStreamSessionInterface {
    /**
     * When an `AgentWebMessageStreamSession` is created, we create an empty message in
     * the API with `isStream = true` which returns the index of the newly created
     * message. We use this index to update the message's stream parts as well as
     * update the agent conversation state.
     */
    readonly messageIndex: number;

    /**
     * Buffer incoming text deltas and coalesce them. We do NOT immediately mutate
     * `AgentWebMessageStream` here; instead we batch text for up to
     * `#updateThrottleMs` milliseconds. When the throttle fires we push the coalesced
     * text into the `AgentWebMessageStream` while holding the session mutex and
     * schedule an `#update`.
     *
     * Rationale / ordering guarantees:
     *
     * - Buffering avoids creating an API update for every token/event from OpenAI.
     * - When the timeout fires, the buffered text is pushed into AgentWebMessageStream
     *   under the mutex using `#pushTextIntoParser()`. Because _push_ and the later
     *   `#update()` calls are both enqueued on the same mutex, any previously queued
     *   updates (e.g. pending reasoning/tool updates) run before this text push. This
     *   prevents late-arriving text from appearing before already-queued non-content
     *   parts.
     *
     * Example: (OpenAI order: `reasoning(a)`, `reasoning(b)`, output_text.delta)
     *
     * - `reasoning(a)` → calls `#update(a)` and acquires mutex (`U_a`)
     * - `reasoning(b)` → queued `#update(b)` (`U_b`)
     * - `output_text.delta` → `pushText()` buffers text and schedules timeout
     * - timeout fires → pushes text under mutex (queued after `U_b`), schedules
     *   `#update()`
     * - mutex executes `U_a` → `U_b` → `pushText()` → `#update(text)` -> persisted
     *   order: `reasoning(a)`, `reasoning(b)`, `content(text)`
     */
    pushText(span: TracerSpan, text: string): void;

    /**
     * These are non-content (semantic) parts that must be persisted with correct
     * ordering relative to buffered text. Before creating their `#update(...)` request
     * we flush any buffered text we currently hold via `_flushUpdateTextState()`.
     *
     * Behavior:
     *
     * - `_flushUpdateTextState()` clears the throttle timeout, grabs the buffered
     *   text, and pushes it into the AgentWebMessageStream using
     *   `#pushTextIntoParser()`.
     * - Then we call `#update(span, newPartPayloads)` which is serialized by the
     *   mutex.
     *
     * Example: (OpenAI order: `output_text.delta`, `reasoning(b)`)
     *
     * - `output_text.delta` → `pushText()` buffers text
     * - `reasoning(b)` arrives → `pushReasoningSummary()` will call
     *   `_flushUpdateTextState()` (forcing the buffered text into the
     *   `AgentWebMessageStream`), then enqueue the reasoning update. When the next
     *   `#update()` runs, content will be persisted then reasoning, preserving the
     *   original ordering.
     */
    pushToolCall(span: TracerSpan, call: ApiMessageStreamToolCallPartPayloadCall): void;

    /**
     * Push an interactive approval-request card: the agent paused, awaiting human
     * approval for a proposed action. Like other non-content parts, this flushes
     * buffered text first to preserve ordering.
     *
     * This also completes the session. Writing an `ExperimentalApprovals` part sets
     * `completedTime` server-side, so the card is necessarily the last part of the
     * message — there's no "push the card, then keep streaming" to offer.
     */
    pushApprovalRequestAndComplete(
        span: TracerSpan,
        payload: ApiMessageStreamExperimentalApprovalsPartPayload,
    ): Promise<void>;

    /**
     * These are non-content (semantic) parts that must be persisted with correct
     * ordering relative to buffered text. Before creating their `#update(...)` request
     * we flush any buffered text we currently hold via `_flushUpdateTextState()`.
     *
     * Behavior:
     *
     * - `_flushUpdateTextState()` clears the throttle timeout, grabs the buffered
     *   text, and pushes it into the `AgentWebMessageStream` using
     *   `#pushTextIntoParser()`.
     * - Then we call `#update(span, newPartPayloads)` which is serialized by the
     *   mutex.
     *
     * Example: (OpenAI order: `output_text.delta`, `reasoning(b)`)
     *
     * - `output_text.delta` → `pushText()` buffers text
     * - `reasoning(b)` arrives → `pushReasoningSummary()` will call
     *   `_flushUpdateTextState()` (forcing the buffered text into the
     *   `AgentWebMessageStream`), then enqueue the reasoning update. When the next
     *   `#update()` runs, content will be persisted then reasoning, preserving the
     *   original ordering.
     */
    pushReasoningSummary(span: TracerSpan, summary: string): void;
}

/**
 * Coordinates streaming updates for a single agent response message.
 *
 * Responsibilities / invariants:
 *
 * - Provide a single logical ordering for all changes that mutate the
 *   AgentWebMessageStream and for all calls that persist stream parts to the API.
 * - Ensure that non-content parts (Reasoning, ToolCall, etc.) never end up
 *   visually interrupting content that logically arrived earlier (and vice versa).
 * - Throttle rapid text deltas into content parts (100ms) while ensuring that when
 *   a non-content part is processed we first persist any text that arrived before
 *   it.
 *
 * Key idea:
 *
 * - Text deltas are buffered in `#updateTextState()`. They are only pushed into
 *   `AgentWebMessageStream` while holding the session mutex. All calls that
 *   persist parts to the API (`#update(...)`) also run under the same mutex. This
 *   makes the mutex the single serialization point for both (a) text entering the
 *   message stream and (b) persisting parts to the API, preventing ordering races.
 *
 * Important assumptions:
 *
 * - `Mutex.withLock()` is FIFO (ordering of queued lock requests is preserved).
 * - `AgentWebMessageStream.update()` parses a snapshot of the text state and
 *   leaves any concurrent appends in the leftover `_textState` for the next
 *   update.
 */
export class AgentWebMessageStreamSession implements AgentWebMessageStreamSessionInterface {
    readonly messageIndex: number;

    #parentSpan: TracerSpan;
    #apiClient: ApiClient;
    #room: ApiMessageRoomReference;
    #parser: AgentWebMarkdownStreamParser<TracerSpan>;

    /**
     * Whether the stream is over. `complete()` sets it, and so does
     * `pushApprovalRequestAndComplete()` — writing an `ExperimentalApprovals` part
     * sets `completedTime` server-side, so nothing can follow it. Every `push*`
     * asserts on this rather than trusting callers to know the rule, and `complete()`
     * is a noop once it's set so callers don't have to know which path the turn took.
     */
    #isCompleted = false;
    #pingInterval: Interval | null = null;
    #mutex = new Mutex();
    #updateThrottleMs = 100;
    #streamError: {error: unknown} | null = null;

    #updateTextState: {
        text: string;
        updateTimeout: Timeout;
        span: TracerSpan;
    } | null = null;

    #shouldRestartIntervalAfterUpdate = true;

    constructor({
        parentSpan,
        apiClient,
        room,
        messageIndex,
        streamParser,
    }: {
        parentSpan: TracerSpan;
        apiClient: ApiClient;
        room: ApiMessageRoomReference;
        messageIndex: number;
        streamParser: AgentWebMarkdownStreamParser<TracerSpan>;
    }) {
        this.#parentSpan = parentSpan;
        this.#apiClient = apiClient;
        this.#room = room;
        this.messageIndex = messageIndex;
        this.#parser = streamParser;

        this.#startPingInterval();
    }

    /**
     * Whether the session hit a terminal error while streaming parts back to the API.
     * Once set, all further pushes throw and `complete()` closes the stream with a
     * user-facing error part instead of the agent's content.
     */
    get hasStreamError() {
        return this.#streamError !== null;
    }

    pushText(span: TracerSpan, text: string) {
        this.#assertCanPush();

        // We throttle updates to once every 100ms instead of once every token OpenAI sends
        // us.
        if (this.#updateTextState === null) {
            const updateTimeout = createTimeout(() => {
                assert(this.#updateTextState !== null);

                const {span, text} = this.#updateTextState;
                this.#updateTextState = null;

                this.#pushTextIntoParser(span, text);
                void this.#update(span);
            }, this.#updateThrottleMs);

            this.#updateTextState = {text: text, updateTimeout, span};
        } else {
            this.#updateTextState.span = span;
            this.#updateTextState.text += text;
        }
    }

    pushToolCall(span: TracerSpan, call: ApiMessageStreamToolCallPartPayloadCall) {
        this.#assertCanPush();
        this.#flushUpdateTextState();
        void this.#update(span, [{type: "ToolCall", call}]);
    }

    async pushApprovalRequestAndComplete(
        span: TracerSpan,
        payload: ApiMessageStreamExperimentalApprovalsPartPayload,
    ) {
        this.#assertCanPush();

        // Writing an `ExperimentalApprovals` part sets `completedTime` server-side, so the
        // stream is over the moment that update lands. Trying to send another part or ping
        // the stream will throw. So take the same shutdown path `complete()` does: refuse
        // later pushes and stop pinging a stream that's about to close.
        this.#isCompleted = true;
        this.#shouldRestartIntervalAfterUpdate = false;
        this.#clearPingInterval();

        this.#flushUpdateTextState();
        void this.#update(span, [payload]);

        await this.#finishStream();
    }

    pushReasoningSummary(span: TracerSpan, summary: string) {
        this.#assertCanPush();

        // If we have streamed text into the session, flush it to the API before pushing
        // the reasoning summary. Doing this here ensures proper ordering of events. For
        // exmaple
        //
        // 1. `pushReasoningSummary(response.reasoning_summary_part.done (a))`
        // 2. `pushReasoningSummary(response.reasoning_summary_part.done (b))`
        // 3. `pushText(response.output_text.delta (a))`
        //
        // Since we place a mutex on updating the API, we want to make sure that these
        // updates are sent to the API in the correct order. So let's say that
        // `response.reasoning_summary_part.done` (b) is waiting on part (a) to finish.
        // Well, since we flush the update text _before_ waiting for the mutex to unlock
        // there shouldn't be any unexpected text in between parts (a) and (b).
        //
        // In the past, we pushed all text to the `AgentWebMessageStream` as soon as we
        // received it. So in the above scenario, what actually happens is
        //
        // 1. `AgentWebMessageStreamSession` receives reaonsing summary (a) and submits the
        //    API request
        // 2. `AgentWebMessageStreamSession` receives reasoning summary (b) and waits for
        //    the mutex to unlock
        // 3. `AgentWebMessageStreamSession` receives text (a) and pushes it to the
        //    `AgentWebMessageStream`.
        // 4. The mutex unlocks, the API call for reasoning summary (b) is made, but now
        //    text (a) is already in the stream.
        //
        // So the general pattern here is that we "merge" adjacent text calls and send them
        // to the API once every 100ms. However, if a non-content part is sent while
        // "merging" adjacent text parts, we send whatever text parts we have buffered to
        // the API and then we send the non-content part.
        this.#flushUpdateTextState();

        void this.#update(span, [
            {
                type: "Reasoning",
                content: parseApiContentFromMarkdown(summary),
            },
        ]);
    }

    /**
     * If there is buffered text in `#updateTextState()`, cancel its timeout and push
     * it into the `AgentWebMessageStream`. This method does not itself await the
     * mutex; it uses `#pushTextIntoParser()` which schedules the push under the mutex.
     * After flushing, the buffered text is cleared.
     *
     * Important note:
     *
     * - We avoid pushing buffered text into AgentWebMessageStream directly without the
     *   mutex because that could allow asynchronous `#update()` calls (already queued)
     *   to observe the text at the wrong time and violate ordering.
     */
    #flushUpdateTextState() {
        if (this.#updateTextState === null) return;

        const {span, text, updateTimeout} = this.#updateTextState;
        updateTimeout.clear();
        this.#updateTextState = null;

        this.#pushTextIntoParser(span, text);
    }

    /**
     * Acquire the mutex and call `AgentWebMessageStream.update`. `update()` returns
     * parts that need to be PUT to the API. All actual PUTs are performed while still
     * within the mutex boundary (the API calls themselves are awaited, but they run
     * while the session still logically holds ordering via the mutex).
     *
     * Notes:
     *
     * - AgentWebMessageStream.update() expects that `_textState` has been populated by
     *   `#pushTextIntoParser()` when appropriate. The update call will parse a
     *   snapshot of the text state and build content parts (if any), then append any
     *   non-content `newPartPayloads` provided.
     */
    #update(
        updateSpan: TracerSpan,
        newPartPayloads?: Array<Exclude<ApiMessageStreamPartPayload, {type: "Content"}>>,
    ) {
        return this.#mutex.withLock(async () => {
            if (this.#streamError !== null) return;

            const putParts = await this.#parser.update(updateSpan, newPartPayloads);
            if (putParts.length === 0) return;

            // Calling `putApiMessageStreamPart()` also pings the message stream. So cancel our
            // current interval and re-schedule it after we've finished updating.
            this.#clearPingInterval();

            try {
                // TODO(calebmer): We should consider adding a batch `PUT` API. That would be more
                // efficient than making two separate `PUT` requests when `update()` returns
                // multiple parts.
                for (const {span, part: originalPart} of putParts) {
                    let part: {index: number; payload: ApiMessageStreamPartPayload} = originalPart;

                    if (part.payload.type === "Content" || part.payload.type === "Reasoning") {
                        let content = part.payload.content;

                        // Convert all straight quotes (`'` and `"`) into proper curly quotes. Since LLMs
                        // typically only output straight quotes. Curly quotes are proper typography and
                        // are consistent with text written in Alpine where we automatically convert quotes
                        // into curly quotes.
                        content = convertApiContentToProperQuotes(content);

                        if (content !== part.payload.content) {
                            part = {...part, payload: {...part.payload, content}};
                        }
                    }

                    try {
                        await putApiMessageStreamPart(
                            span,
                            this.#apiClient,
                            this.#room,
                            this.messageIndex,
                            part.index,
                            {payload: part.payload},
                        );
                    } catch (error) {
                        this.#streamError ??= {error};
                        return;
                    }
                }
            } finally {
                // Start the ping timeout schedule again since we cleared the timeout earlier.
                if (this.#shouldRestartIntervalAfterUpdate) {
                    this.#startPingInterval();
                }
            }
        });
    }

    async complete(span: TracerSpan) {
        // `pushApprovalRequestAndComplete()` already completed the stream, and its caller
        // still runs the ordinary completion path afterwards.
        if (this.#isCompleted) return;
        this.#isCompleted = true;

        // Let's say a stream part comes in a T0 and the stream is completed at T50 (ms)
        // the `update()` call won't run for another 50ms. When that update call runs we
        // don't want it to restart the interval after sending the last parts to the API
        this.#shouldRestartIntervalAfterUpdate = false;
        this.#clearPingInterval();

        // `createChatGptAgentResponse()` may call `messageState.pushText()` and set
        // `updateTimeout`.
        this.#flushUpdateTextState();
        void this.#update(span);

        await this.#finishStream();
    }

    /**
     * Waits for the queued updates to drain and closes the stream out. Shared by both
     * ways a session ends: `complete()` and `pushApprovalRequestAndComplete()`.
     *
     * The `PUT` to complete the stream is redundant on the approvals path — the
     * approvals part already set `completedTime` server-side — but it's a noop there,
     * and going through the same path means the terminal-error branch below still runs
     * when the approvals part is what failed to land.
     */
    async #finishStream() {
        this.#clearPingInterval();
        await this.#mutex.waitForUnlock();

        // If the stream encountered a terminal error while streaming content back to the
        // API, we append a user-facing error part to the stream before completing it.
        //
        // This is best effort. If the API is unavailable then this request fails too, we
        // never complete the stream, and the stream times out on its own.
        if (this.#streamError !== null) {
            const content: ApiContent = {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "I couldn\u2019t generate a response. "},
                            ...printErrorDisplayMessageToApiContent(
                                getErrorDisplayMessage(this.#streamError.error),
                            ),
                        ],
                    },
                ],
            };

            await createApiMessageStreamPart(
                this.#parentSpan,
                this.#apiClient,
                this.#room,
                this.messageIndex,
                {payload: {type: "Content", content}},
            );
        }

        await completeApiMessageStream(
            this.#parentSpan,
            this.#apiClient,
            this.#room,
            this.messageIndex,
        );
    }

    #startPingInterval() {
        assert(this.#pingInterval === null);

        this.#pingInterval = createInterval(() => {
            void this.#mutex.withLock(async () => {
                await pingApiMessageStream(
                    this.#parentSpan,
                    this.#apiClient,
                    this.#room,
                    this.messageIndex,
                );
            });
        }, messageStreamPingIntervalMs);
    }

    #clearPingInterval() {
        this.#pingInterval?.clear();
        this.#pingInterval = null;
    }

    #assertCanPush() {
        assert(!this.#isCompleted);

        if (this.#streamError === null) return;

        throw new FailedPreconditionError(
            "Can\u2019t continue after a terminal message stream error",
            {
                cause: this.#streamError.error,
                displayMessage: agentWebMessageStreamTerminalErrorDisplayMessage,
            },
        );
    }

    /**
     * Pushes text into the AgentWebMessageStream while holding the session mutex. This
     * ensures that all text pushes and all `#update` operations are serialized by the
     * same mutex, giving us a single ordering surface.
     *
     * This helper purposely uses `this.#mutex.withLock(...)` so the actual mutation of
     * `AgentWebMessageStream` occurs as a queued operation and cannot race with other
     * queued `#update(...)` calls.
     *
     * Example ordering (queued lock order matters):
     *
     * - queued: `#update(b)` (reasoning), queued: `#pushTextIntoParser(text)` Because
     *   the mutex is FIFO, `#update(b)` runs before the text push, which prevents the
     *   text from appearing before `reasoning(b)` when text logically arrived later.
     */
    #pushTextIntoParser(span: TracerSpan, text: string) {
        void this.#mutex.withLock(async () => {
            this.#parser.pushText(span, text);
        });
    }
}
