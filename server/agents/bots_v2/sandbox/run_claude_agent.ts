import {SDKUserMessage, query} from "@anthropic-ai/claude-agent-sdk";
import fs from "fs/promises";
import {open} from "lmdb";
import {v4 as uuidv4} from "uuid";
import {ApiClient, createApiMessage} from "~/server/agents/api/api_client.open_source.js";
import {AgentWebMessageStreamSession} from "~/server/agents/bots_v2/sandbox/agent_web_message_stream_session.js";
import {isClaudeAgentApprovalScope} from "~/server/agents/bots_v2/sandbox/claude_agent_approval_scope.js";
import {ClaudeAgentDecidedApprovalBatch} from "~/server/agents/bots_v2/sandbox/claude_agent_approvals_state.js";
import {
    ClaudeAgentServiceApprovalDecisionEvent,
    ClaudeAgentServiceEvent,
} from "~/server/agents/bots_v2/sandbox/claude_agent_service.js";
import {ClaudeAgentSessionStore} from "~/server/agents/bots_v2/sandbox/claude_agent_session_store.js";
import {
    ClaudeAgentRoomState,
    ClaudeAgentStateStore,
} from "~/server/agents/bots_v2/sandbox/claude_agent_state_store.js";
import {
    claudeAgentToolNames,
    claudeAgentUngatedToolNames,
} from "~/server/agents/bots_v2/sandbox/claude_agent_tool_names.js";
import {
    ClaudeAgentApprovalsRuntime,
    createClaudeAgentCanUseTool,
} from "~/server/agents/bots_v2/sandbox/create_claude_agent_can_use_tool.js";
import {createClaudeAgentMcpServer} from "~/server/agents/bots_v2/sandbox/create_claude_agent_tools.js";
import {mergeClaudeAgentApprovalDecisions} from "~/server/agents/bots_v2/sandbox/merge_claude_agent_approval_decisions.js";
import {rejectPendingClaudeAgentApprovalsIfPossible} from "~/server/agents/bots_v2/sandbox/reject_pending_claude_agent_approvals_if_possible.js";
import {runApprovedToolCallsAndUpdateClaudeSessionTranscript} from "~/server/agents/bots_v2/sandbox/run_approved_tool_calls_and_update_claude_session_transcript.js";
import {
    AgentWebSessionLmdbStorageKey,
    createAgentWebSessionLmdbStorage,
} from "~/server/agents/lmdb/create_agent_web_session_lmdb_storage.open_source.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.open_source.js";
import {
    AgentWebPageLinkKeyObject,
    printAgentWebPageLinkKey,
} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {independentlyCallAgentWebReadToolWithoutTruncation} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {ApiMessageRoomReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {EventQueue} from "~/shared/helpers/control/event_queue.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * How long we wait after the last parked tool call before interrupting the turn to
 * post the approvals card. See the debounce in `actuallyRunClaudeAgent`.
 */
const claudeAgentParkInterruptDebounceMs = 300;

/**
 * How many decided approval batches we keep in `state.json`.
 *
 * The agent never reads them — they exist so the debugger can interleave decisions
 * into the transcript timeline. Unbounded they'd make every unrelated
 * `stateStore.set()` (a new message, a new post, a session id) rewrite a bigger
 * object, so total write volume over a room's life would grow with the square of
 * the number of approvals.
 */
const maxClaudeAgentDecidedApprovalBatches = 20;

export type RunClaudeAgentOptions = {
    spaceId: SpaceId;
    botAccount: {id: AccountId; bot: {id: BotId}};
    apiClient: ApiClient;
    room: ApiMessageRoomReference;
    eventQueue: EventQueue<ClaudeAgentServiceEvent>;
};

export async function runClaudeAgent(parentSpan: TracerSpan, options: RunClaudeAgentOptions) {
    const {spaceId, botAccount, apiClient} = options;

    await parentSpan.withSpan("Run Claude agent SDK", async parentSpan => {
        const [
            ,
            ,
            ,
            stateStore,
            {
                data: {settings},
            },
        ] = await runAllPromises([
            fs.mkdir("/workspace/agent", {recursive: true}),
            fs.mkdir("/workspace/config", {recursive: true}),
            parentSpan.withSpan("Read Claude agent web store", async span => {
                await fs
                    .copyFile("/workspace/bucket/agents-web.db", "/workspace/agents-web.db")
                    .then(
                        () => {},
                        error => {
                            if (isObject(error) && error.code === "ENOENT") {
                                span.addData({common: {didNothing: true}});
                                return;
                            }
                            throw error;
                        },
                    );
            }),
            ClaudeAgentStateStore.new(parentSpan),
            apiClient.get(parentSpan, "/spaces/{id}/bots/{botId}/settings", {
                params: {path: {id: spaceId, botId: botAccount.bot.id}},
            }),
        ]);

        const sessionStore = new ClaudeAgentSessionStore(parentSpan);

        const database = open<string, AgentWebSessionLmdbStorageKey>({
            path: "/workspace/agents-web.db",
            noSubdir: true,
        });

        const promiseWaiter = new PromiseWaiter();

        try {
            try {
                await database.transaction(async () => {
                    const webStorage = createAgentWebSessionLmdbStorage(database, spaceId);

                    await actuallyRunClaudeAgent(parentSpan, options, {
                        settings,
                        stateStore,
                        sessionStore,
                        webStorage,
                        waitUntil: promiseWaiter.waitUntil,
                    });
                });

                await database.close();

                // Copy the agent web storage back to the R2 bucket. We need to do this copy dance
                // because lmdb doesn't work when backed by a remote file system like s3fs which is
                // used by Cloudflare R2.
                //
                // If there was an error then we don't run this copy because we will take the
                // nuclear option and delete everything from `/workspace/bucket`.
                promiseWaiter.waitUntil(
                    parentSpan.withSpan("Write Claude agent web store", () =>
                        fs.copyFile("/workspace/agents-web.db", "/workspace/bucket/agents-web.db"),
                    ),
                );
            } finally {
                await promiseWaiter.wait();
            }
        } catch (error) {
            // **The nuclear option.**
            //
            // If an error was thrown, then remove ALL our stored data in the bucket so the
            // next attempt starts from a clean slate. The reason being it seems like Claude
            // won't use the session store to persist the session if an error is thrown. So we
            // get into a bad state if we have a `sessionId` in `ClaudeAgentSessionStore` but
            // that session doesn't exist in the R2 bucket because an error was thrown.
            await parentSpan.withSpan("Delete all Claude agent storage after error", async span => {
                await fs
                    .copyFile(
                        "/workspace/bucket/state.json",
                        "/workspace/bucket/last-known-state.json",
                    )
                    .then(
                        () => {},
                        // Archiving is best-effort. Recording the exception on the span must never block
                        // the reset below.
                        copyError => {
                            // No `state.json` means there's nothing new to archive. Keep the previous archive,
                            // if any.
                            if (isObject(copyError) && copyError.code === "ENOENT") return;
                            span.addException(copyError);
                        },
                    );

                await sessionStore.deleteSessionsExcept(stateStore.get().sessionId);

                await runAllPromises(
                    (await fs.readdir("/workspace/bucket"))
                        // We do keep two things for debugging. Neither is visible to the next attempt,
                        // which only reads `state.json`:
                        //
                        // - `state.json` is archived as `last-known-state.json` (overwriting any previous
                        //   archive) so the conversation state debugger can show what happened right
                        //   before the error (see `read_claude_agent_conversation_state_from_bucket.ts`).
                        // - The one `sessions/` transcript the archived `sessionId` points at. Older
                        //   abandoned sessions were deleted above, and the next run starts fresh because
                        //   `state.json` itself is removed here.
                        .filter(name => name !== "last-known-state.json" && name !== "sessions")
                        .map(name => fs.rm(`/workspace/bucket/${name}`, {recursive: true})),
                );
            });

            throw error;
        }
    });
}

async function actuallyRunClaudeAgent(
    parentSpan: TracerSpan,
    {spaceId, botAccount, apiClient, room, eventQueue}: RunClaudeAgentOptions,
    {
        settings,
        stateStore,
        sessionStore,
        webStorage,
        waitUntil,
    }: {
        settings: {values: {[key: string]: unknown}};
        stateStore: ClaudeAgentStateStore;
        sessionStore: ClaudeAgentSessionStore;
        webStorage: AgentWebSessionStorage;
        waitUntil: PromiseWaiter["waitUntil"];
    },
) {
    const resumeSessionId = stateStore.get().sessionId;

    let context: AgentWebContext | null = null;

    const getContext = (roomState: ClaudeAgentRoomState): AgentWebContext => {
        context ??= {
            spaceId,
            api: apiClient,
            storage: webStorage,
            span: parentSpan,
            timeZone: roomState.timeZone,
            botAccount,
        };

        return context;
    };

    if (
        !settings.values.apiKey ||
        typeof settings.values.apiKey !== "string" ||
        settings.values.apiKey.length === 0
    ) {
        throw new FailedPreconditionError("Missing Anthropic API key", {
            displayMessage: errorDisplayMessage`Please add an Anthropic API key in ${errorDisplayMessage.link("settings", `${assertExists(process.env.ALPINE_URL)}/settings/${spaceId}/bots/${botAccount.bot.id}`)}.`,
        });
    }

    assert(typeof settings.values.model === "string");
    assert(typeof settings.values.effort === "string");

    // When a message is acknowledged, we create a stream session and add it to this
    // ref. After a message is acknowledged, it's our responsibility to ping the
    // message stream and eventually complete it. If we're being steered then we'll
    // complete the last message because a new one is starting.
    const messageRef: {current: AgentWebMessageStreamSession | null} = {current: null};
    const outstandingMessageIds = new Set<string>();

    const contentBlockSpanByIndex = new Map<number, {span: TracerSpan; finishSpan: () => void}>();
    const approvalsRuntime: ClaudeAgentApprovalsRuntime = {
        webDecisions: [],
        rejectedRequests: [],
        newRequests: [],
    };

    let parkInterrupt: {clear: () => void} | null = null;

    // Disarm a pending park interrupt. Declared out here so the `finally` below can
    // call it: without that, a straggler parking just as the turn ends leaves a timer
    // armed, and a steering message that starts a new turn inside the debounce window
    // gets interrupted in place of the turn the approval actually belonged to.
    const clearParkInterrupt = () => {
        parkInterrupt?.clear();
        parkInterrupt = null;
    };

    let hasThrownError = false;

    try {
        let thinkingContentBlock: {
            index: number;
            text: string;
        } | null = null;

        const roomInformation = getClaudeAgentSystemPromptRoomInformation(room);

        // Both lists come from `claude_agent_tool_names.ts`, which is where a tool gets
        // classified as needing approval or not. Registering a tool means adding it there,
        // so there's no second list here to fall out of sync with the gate.
        const tools = [...claudeAgentToolNames];

        // The gate explicitly allows, denies, or parks every gated tool call so it doesn't
        // matter whether gated tools are auto-allowed. We keep them out of `allowedTools`
        // anyway as defense in depth.
        const allowedTools = [...claudeAgentUngatedToolNames];

        // `query()` reads the session transcript eagerly when it's called, so an approval
        // decision — which resolves by editing that transcript — has to be handled BEFORE
        // the query starts, not from inside the prompt generator. Peek the waking event:
        // if it's an approval decision, resolve it now; otherwise hand it back to the
        // generator. (At wake time the queue holds exactly this one event; later steering
        // events arrive via the socket during the run.)
        let initialNudge: string | null = null;
        const wakingEvent = eventQueue.dequeue();

        if (wakingEvent !== undefined && wakingEvent.type === "ApprovalDecisionEvent") {
            const outcome = await resumeClaudeAgentAfterApprovalDecision(parentSpan, {
                eventQueueEvent: wakingEvent,
                stateStore,
                sessionStore,
                apiClient,
                storage: webStorage,
                getContext,
                messageRef,
                approvalsRuntime,
                resumeSessionId,
            });

            // Nothing to resume (unknown/partial/corrupt batch) — the response message was
            // already completed with an error. Skip the query entirely.
            if (outcome.type === "Exit") return;

            initialNudge = outcome.nudge;
        } else if (wakingEvent !== undefined) {
            // A `CreatedMessage`/`CreatedPost` waking event: hand it back to the generator. If
            // there's a pending approval batch, the generator's `CreatedMessage` case rejects
            // and clears it (a new message supersedes stale approvals) — so we don't need to
            // clear it here.
            eventQueue.enqueue(wakingEvent);
        }

        // Handle to the running query so the approval gate can interrupt the turn to park
        // it (see `create_claude_agent_can_use_tool.ts`). Set right after `query()`
        // returns — before iteration starts, so it's populated by the time any tool runs.
        const agentQueryRef: {current: ReturnType<typeof query> | null} = {current: null};

        const canUseTool = createClaudeAgentCanUseTool({
            stateStore,
            approvalsRuntime,
            storage: webStorage,
            interruptTurn: () => {
                // NOTE(ifitzsimmons, 2026-08-13): Coalesces a wave of parked tool calls into a
                // single interrupt. The SDK invokes `canUseTool` concurrently for every call in a
                // parallel batch (hanging one doesn't block the others), so the gate asks us to
                // interrupt once per parked call. Debouncing means a parallel wave produces one
                // approval card instead of several. A straggler that lands after the window is
                // simply left with an aborted result and re-requested when the agent resumes.
                clearParkInterrupt();

                parkInterrupt = createTimeout(() => {
                    parkInterrupt = null;

                    // If the interrupt never lands the parked call never resolves — it only settles on
                    // the abort signal — so the turn hangs, the card is never pushed, and the stream
                    // stays open. Record it rather than swallowing it; the run then fails visibly
                    // instead of wedging the container.
                    agentQueryRef.current
                        ?.interrupt()
                        .catch(error => parentSpan.addException(error));
                }, claudeAgentParkInterruptDebounceMs);
            },
        });

        const agentQuery = query({
            prompt: generateClaudeAgentPrompt(parentSpan, {
                apiClient,
                eventQueue,
                stateStore,
                storage: webStorage,
                getContext,
                messageRef,
                waitUntil,
                outstandingMessageIds,
                approvalsRuntime,
                initialNudge,
            }),
            options: {
                cwd: "/workspace/agent",
                model: settings.values.model,
                // The effort setting is a `Select` which we control. So it'll be a valid value.
                effort: settings.values.effort as any,
                thinking: {type: "adaptive", display: "summarized"},
                sessionStore,
                persistSession: true,
                forkSession: false,
                resume: resumeSessionId ?? undefined,
                includePartialMessages: true,
                env: {
                    ...process.env,
                    ANTHROPIC_API_KEY: settings.values.apiKey,
                    // Directory to write Claude config (including transcripts).
                    CLAUDE_CONFIG_DIR: "/workspace/config",
                    // Anthropic recommends we set this:
                    // https://code.claude.com/docs/en/agent-sdk/hosting
                    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
                    // If there's an issue, fail early. Don't retry for minutes at a time. A user can
                    // always manually retry.
                    CLAUDE_CODE_MAX_RETRIES: "3",
                    // Disable tool search. Alpine tools should always be immediately available without
                    // needing to search.
                    ENABLE_TOOL_SEARCH: "false",
                },
                systemPrompt: `\
You are a bot running in Alpine, an all-in-one productivity suite where humans and agents work together. Use the \`alpine\` skill to learn more about your environment. Anything in Alpine can be read with the \`read\` or \`search\` tools and anything in Alpine can be written with the \`update\`, \`create\`, or \`delete\` tools.

You\u2019ve been sent a message in a ${roomInformation.description}. The last \`<${roomInformation.messageNoun}>\` is the one you\u2019re responding to. Your response will create a new \`<${roomInformation.messageNoun}>\`. Do not use the \`update\` tool to send a response to the ${roomInformation.description} or you\u2019ll end up sending two redundant \`<${roomInformation.messageNoun}>\`s.

You don\u2019t have direct file system access. You\u2019ll work entirely within the Alpine environment. You\u2019ll find that reading/writing Alpine content is a lot like reading/writing files in a file system so you should feel right at home. If you see a path that starts with \`/\` (e.g. \`/document/hello-world\`) that\u2019s an Alpine path (not a file system path) and you should read it using the \`read\` tool.`,
                tools,
                allowedTools,
                // The approval gate. Runs before every gated tool call and allows, denies, or
                // PARKS the turn — hangs the call and interrupts, so the model never sees a result
                // to narrate — when the call needs fresh approval. See
                // `create_claude_agent_can_use_tool.ts`.
                canUseTool,
                strictMcpConfig: true,
                mcpServers: {
                    alpine: createClaudeAgentMcpServer(() => assertExists(context), messageRef),
                },
                settings: {
                    // The bundled skills aren't useful. They are mostly coding project related skills.
                    // Claude doesn't have access to the user's codebase!
                    disableBundledSkills: true,
                },
            },
        });
        agentQueryRef.current = agentQuery;

        for await (const message of agentQuery) {
            // Stop consuming model output after a terminal stream error. Returning aborts the
            // Claude Agent SDK query and runs the `finally` block below, which completes the
            // stream with an error part.
            //
            // Breaking also returns from `runClaudeAgent()`, which closes the socket server
            // and exits the process. Any event still sitting in the queue is never
            // acknowledged, so the webhook rejects and Alpine redelivers the event to a fresh
            // process.
            if (messageRef.current?.hasStreamError) return;

            switch (message.type) {
                case "system": {
                    if (message.subtype === "init") {
                        if (resumeSessionId !== null) {
                            assert(resumeSessionId === message.session_id);
                        } else {
                            await stateStore.set(parentSpan, {sessionId: message.session_id});
                        }
                    }
                    break;
                }

                // If there's an error (e.g. invalid API key) then we'll get an `assistant` message
                // with the error and no `stream_event`s. Handle the error case `assistant`
                // message.
                case "assistant": {
                    if (typeof message.error !== "string") break;

                    assertExists(messageRef.current).pushText(
                        parentSpan,
                        `I couldn\u2019t generate a response.`,
                    );

                    let hasSeenContentBlock = false;

                    for (const contentBlock of message.message.content) {
                        if (contentBlock.type !== "text") continue;

                        const isFirstContentBlock = !hasSeenContentBlock;
                        hasSeenContentBlock = true;

                        assertExists(messageRef.current).pushText(
                            parentSpan,
                            `${isFirstContentBlock ? " " : "\n\n"}${contentBlock.text}`,
                        );
                    }
                    break;
                }

                case "stream_event": {
                    const {event} = message;

                    switch (event.type) {
                        case "content_block_start": {
                            assert(!contentBlockSpanByIndex.has(event.index));

                            const span = parentSpan.startSpan(
                                `Claude content block ${event.content_block.type}`,
                            );

                            contentBlockSpanByIndex.set(event.index, span);

                            if (event.content_block.type === "thinking") {
                                thinkingContentBlock = {index: event.index, text: ""};
                            }
                            break;
                        }
                        case "content_block_stop": {
                            const {span, finishSpan} = assertExists(
                                contentBlockSpanByIndex.get(event.index),
                            );

                            if (thinkingContentBlock?.index === event.index) {
                                if (thinkingContentBlock.text.length > 0) {
                                    assertExists(messageRef.current).pushReasoningSummary(
                                        span,
                                        thinkingContentBlock.text,
                                    );
                                }

                                thinkingContentBlock = null;
                            }

                            contentBlockSpanByIndex.delete(event.index);
                            finishSpan();
                            break;
                        }
                        case "content_block_delta": {
                            const {span} = assertExists(contentBlockSpanByIndex.get(event.index));

                            switch (event.delta.type) {
                                case "text_delta": {
                                    // If we receive `text_delta` when there's some unfinished thinking content then
                                    // immediately push a reasoning summary before pushing our text. So the thinking
                                    // summary always comes before the text.
                                    if (
                                        thinkingContentBlock?.index === event.index &&
                                        thinkingContentBlock.text.length > 0
                                    ) {
                                        assertExists(messageRef.current).pushReasoningSummary(
                                            span,
                                            thinkingContentBlock.text,
                                        );

                                        thinkingContentBlock.text = "";
                                    }

                                    assertExists(messageRef.current).pushText(
                                        span,
                                        event.delta.text,
                                    );
                                    break;
                                }
                                case "thinking_delta": {
                                    assert(thinkingContentBlock);

                                    let thinkingTextDelta = event.delta.thinking;
                                    let lastNewlineIndex = thinkingTextDelta.indexOf("\n\n");

                                    while (lastNewlineIndex !== -1) {
                                        const thinkingText =
                                            thinkingContentBlock.text +
                                            thinkingTextDelta.slice(0, lastNewlineIndex);

                                        thinkingContentBlock.text = "";
                                        thinkingTextDelta = thinkingTextDelta.slice(
                                            lastNewlineIndex + 2,
                                        );
                                        lastNewlineIndex = thinkingTextDelta.indexOf("\n");

                                        assertExists(messageRef.current).pushReasoningSummary(
                                            span,
                                            thinkingText,
                                        );
                                    }

                                    thinkingContentBlock.text += thinkingTextDelta;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                    break;
                }

                default: {
                    // @ts-expect-error: `command_lifecycle` has been added, we see the events, but
                    // it hasn't been added to the TypeScript types. We should get a TypeScript
                    // error if we upgrade the agent SDK and the type is added.
                    //
                    // See:
                    //
                    // - https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/CHANGELOG.md
                    // - https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.206
                    if (message.type === "command_lifecycle") {
                        let isOutstanding: boolean;

                        // @ts-expect-error
                        const state: string = message.state;
                        // @ts-expect-error
                        const messageId: string = message.command_uuid;

                        switch (state) {
                            case "queued":
                            case "started": {
                                isOutstanding = true;
                                break;
                            }
                            case "completed":
                            case "cancelled":
                            case "discarded": {
                                isOutstanding = false;
                                break;
                            }
                            default: {
                                throw new InternalError(
                                    quote`Unrecognized command lifecycle state: ${state}`,
                                );
                            }
                        }

                        assert(outstandingMessageIds.has(messageId));

                        if (!isOutstanding) outstandingMessageIds.delete(messageId);

                        // Once all outstanding messages have been completed, we're done! We can exit the
                        // loop, stop listening for new messages, and ultimately exit the program.
                        if (outstandingMessageIds.size === 0) return;
                    }

                    break;
                }
            }
        }
    } catch (error) {
        hasThrownError = true;

        // We're about to wipe the pending approval batch below. Reject the approvals still
        // awaiting decisions first so their cards don't stay actionable forever — any
        // future decision webhook would find no matching batch. Best-effort: the wipe
        // matters more than the reject.
        const pendingBatch = stateStore.get().approvals.pendingBatch;

        if (pendingBatch !== null) {
            await rejectPendingClaudeAgentApprovalsIfPossible(parentSpan, {
                apiClient,
                room,
                messageIndex: pendingBatch.messageIndex,
            });
        }

        throw error;
    } finally {
        clearParkInterrupt();

        for (const contentBlockSpan of contentBlockSpanByIndex.values()) {
            contentBlockSpan.span.addException(
                new InternalError("Claude response completed before content block could finish"),
            );
            contentBlockSpan.finishSpan();
        }

        contentBlockSpanByIndex.clear();

        // When the gate parked tool calls pending approval during this turn, show the user
        // the approvals card. This runs here in the `finally` because the Claude loop
        // above has several exit points (`return`s and natural completion) and the card
        // must be the last thing added to the response message: writing an
        // `ExperimentalApprovals` part completes the stream server-side, no parts can
        // follow it. On an error exit we skip the card entirely — the catch block above
        // rejects the pending card, and `runClaudeAgent`'s outer handler wipes the state
        // the card would refer to.
        //
        // Important: the pending batch is written to `state.json` _before_ the card is
        // pushed. A user could decide within milliseconds of the card appearing and the
        // decision webhook must find the batch.
        //
        // Why push the card at the end of the turn rather than the instant the gate parks
        // the first tool call? Two reasons, both stemming from the fact that writing an
        // `ExperimentalApprovals` part COMPLETES the stream server-side (nothing can
        // follow it): (1) any text the model streamed BEFORE the gated calls (e.g. "Let me
        // update that doc…") has to land first — the park interrupts the turn right after
        // the tool calls, so there's no approval narration of our own, just the card; and
        // (2) a turn can park several approvals (a parallel wave of tool calls) that we
        // want batched into ONE card — so we accumulate `newRequests` across the turn and
        // push a single card once the turn ends.
        if (
            !hasThrownError &&
            approvalsRuntime.newRequests.length > 0 &&
            messageRef.current &&
            !messageRef.current.hasStreamError
        ) {
            // Take this turn's requests out of the runtime: once the card is posted they're
            // owned by the pending batch in `state.json`.
            const pendingApprovals = approvalsRuntime.newRequests;
            approvalsRuntime.newRequests = [];

            const persistedApprovals = pendingApprovals.map(approval => ({
                toolUseIds: approval.toolUseIds,
                toolName: approval.toolName,
                scope: approval.scope,
                summaryContent: approval.summaryContent,
                decisionOptions: approval.decisionOptions,
            }));

            await stateStore.set(parentSpan, {
                approvals: {
                    ...stateStore.get().approvals,
                    pendingBatch: {
                        messageIndex: messageRef.current.messageIndex,
                        approvals: persistedApprovals,
                    },
                },
            });

            // There's a chance this fails, and that the `approvals` state is left with a
            // pending batch that doesn't actually exist. That's okay – the next time the agent
            // runs, it'll try to reject the pending batch, but that rejection is best effort
            // and a failure won't block the agent from responding.
            messageRef.current.pushApprovalRequest(parentSpan, {
                type: "ExperimentalApprovals",
                approvals: persistedApprovals.map(approval => ({
                    summary: approval.summaryContent,
                    decision: {schema: {options: approval.decisionOptions}},
                })),
            });
        }

        const message = messageRef.current;
        messageRef.current = null;
        if (message) waitUntil(message.complete(parentSpan));
    }
}

/**
 * Resolves an approval-decision waking event before the resumed `query()` starts.
 * `query()` reads the transcript eagerly, so we execute approved Alpine tools and
 * edit the transcript here (see `resolve_claude_agent_approval_decisions.ts`),
 * then let the caller resume with a nudge.
 *
 * Returns `Exit` for the no-op cases (unknown / partially decided / corrupt
 * batch): no response message is created at all and the caller should skip the
 * query. Returns `Resume` with the nudge on success.
 */
async function resumeClaudeAgentAfterApprovalDecision(
    span: TracerSpan,
    {
        eventQueueEvent,
        stateStore,
        sessionStore,
        apiClient,
        storage,
        getContext,
        messageRef,
        approvalsRuntime,
        resumeSessionId,
    }: {
        eventQueueEvent: ClaudeAgentServiceApprovalDecisionEvent;
        stateStore: ClaudeAgentStateStore;
        sessionStore: ClaudeAgentSessionStore;
        apiClient: ApiClient;
        storage: AgentWebSessionStorage;
        getContext: (room: ClaudeAgentRoomState) => AgentWebContext;
        messageRef: {current: AgentWebMessageStreamSession | null};
        approvalsRuntime: ClaudeAgentApprovalsRuntime;
        resumeSessionId: string | null;
    },
): Promise<{type: "Exit"} | {type: "Resume"; nudge: string}> {
    const {request} = eventQueueEvent;
    const {event} = request.body;

    // Commit to responding: create the response message and take ownership of it, so
    // the resumed turn streams into it. The webhook starts us for every decision
    // delivery without knowing whether it's actionable, so we're the ones who create
    // the message — and only from here, once we know a response is actually coming.
    const acknowledgeAndOwnMessage = async () => {
        eventQueueEvent.acknowledge();

        const {
            data: {message},
        } = await createApiMessage(span, apiClient, event.room, {
            isStream: true,
            content: {elements: []},
        });

        messageRef.current = new AgentWebMessageStreamSession({
            parentSpan: span,
            apiClient,
            room: event.room,
            messageIndex: message.index,
            streamParser: new AgentWebMarkdownStreamParser({storage, documentId: null}),
        });
    };

    // This decision isn't ours to act on: the batch is only partly decided, belongs to
    // a different message, or was already consumed (a redelivery, or our state was
    // wiped after an error). The webhook can't filter these — only we hold the pending
    // batch — so declining here is the normal, expected outcome, not a failure.
    //
    // Exit without creating a message. Nothing is shown to the user, which is the
    // whole point of leaving message creation to us: a delivery we don't act on leaves
    // no trace. `ignore()` tells the webhook we made a decision so it doesn't read our
    // exit as a crash.
    const ignoreDecision = async (
        branch: string,
        {shouldRejectCard}: {shouldRejectCard: boolean},
    ): Promise<{type: "Exit"}> => {
        span.addData({common: {branch, didNothing: true}});

        if (shouldRejectCard) {
            await rejectPendingClaudeAgentApprovalsIfPossible(span, {
                apiClient,
                room: event.room,
                messageIndex: event.messageIndex,
            });
        }

        eventQueueEvent.ignore();

        return {type: "Exit"};
    };

    const state = stateStore.get();
    const pendingBatch = state.approvals.pendingBatch;

    if (pendingBatch === null || pendingBatch.messageIndex !== event.messageIndex) {
        return await ignoreDecision("UnknownApprovalBatch", {shouldRejectCard: true});
    }

    const mergeResult = mergeClaudeAgentApprovalDecisions(pendingBatch, event.approvals);

    if (mergeResult.type === "StillPending") {
        return await ignoreDecision("ApprovalBatchStillPending", {shouldRejectCard: false});
    }

    if (mergeResult.type === "Mismatch") {
        await stateStore.set(span, {
            approvals: {...state.approvals, pendingBatch: null},
        });

        return await ignoreDecision(
            "Approval decisions don\u2019t line up with the pending batch",
            {
                shouldRejectCard: true,
            },
        );
    }

    // Every approval is decided, so from here we're committing to a response. Take the
    // message before the bookkeeping below rather than after: `acknowledge()` is what
    // ends the webhook's wait, and the webhook kills every process in the sandbox if
    // it hasn't heard from us within ten seconds — which we'd otherwise spend writing
    // `state.json` to the R2-backed bucket mount. Nothing below can send us back to
    // `ignoreDecision()`, and if it throws the message we just created is what reports
    // the error.
    await acknowledgeAndOwnMessage();

    const responseMessageIndex = assertExists(messageRef.current).messageIndex;

    // Grant each `ApprovedForSession` scope independently. A rejection applies only to
    // that specific tool request; it does not revoke or suppress a scope granted by a
    // separate decision in the same batch.
    const allowedScopes = {...state.approvals.allowedScopes};

    for (const {value} of mergeResult.decisions) {
        if (value.type !== "ApprovedForSession") continue;

        // The API carries `scope.value` as a free-form string. Only grant scopes we
        // recognize, so `state.json` can't end up holding a key the gate never reads.
        if (!isClaudeAgentApprovalScope(value.scope.value)) {
            span.addException(
                new InternalError(quote`Unrecognized approval scope: ${value.scope.value}`),
            );
            continue;
        }

        allowedScopes[value.scope.value] = {
            expiresTime:
                value.durationMinutes === null
                    ? null
                    : new Date(Date.now() + value.durationMinutes * 60_000).toISOString(),
        };
    }

    // Record the fully-decided batch so the agent debugger can interleave the user's
    // decisions into the transcript timeline. The agent itself never reads it.
    const decidedBatch: ClaudeAgentDecidedApprovalBatch = {
        messageIndex: pendingBatch.messageIndex,
        decidedTime: serializeDateString(new Date()),
        approvals: mergeResult.decisions.map(({approval, value}) => ({
            toolUseIds: approval.toolUseIds,
            toolName: approval.toolName,
            scope: approval.scope,
            decision: value.type,
        })),
    };

    const roomState = assertExists(state.room);

    // Move the room's read cursor past the response we're about to write, same
    // bookkeeping as `CreatedMessage`.
    //
    // `lastMessageIndex` is where the next turn starts loading from — the generator
    // turns it into `?after=` on the read that feeds Claude the new messages. Our
    // response is going to land in the room like anyone else's, so if the cursor stays
    // behind it, the next turn hands Claude its own reply back as if it were new
    // input. It already has that text in its transcript, so at best it's wasted
    // context and at worst it re-reasons about a message it wrote.
    //
    // Only safe to skip when our response is _exactly_ the next message. If someone
    // else posted between the card appearing and this resume, ours isn't contiguous,
    // and moving the cursor to it would step over their message and Claude would never
    // see it. In that case we leave the cursor alone and accept re-reading our own
    // response — cheap, versus silently dropping someone's message.
    //
    // `"post"` means the room is a post whose body is the anchor rather than an
    // indexed message, so there's no index to advance and nothing to compare.
    const shouldAdvanceRoom =
        roomState.lastMessageIndex !== "post" &&
        responseMessageIndex === roomState.lastMessageIndex + 1;

    // One write, not two: nothing between these patches reads the state back, and each
    // `set()` re-serializes and flushes the whole state object.
    await stateStore.set(span, {
        approvals: {
            allowedScopes,
            pendingBatch: null,
            decidedBatches: [...(state.approvals.decidedBatches ?? []), decidedBatch].slice(
                -maxClaudeAgentDecidedApprovalBatches,
            ),
        },
        ...(shouldAdvanceRoom
            ? {room: {...roomState, lastMessageIndex: responseMessageIndex}}
            : {}),
    });

    // Execute the approved Alpine tools, inject their results, and leave approved web
    // tools dangling — all in the transcript, before the query resumes it.
    const {approvedWebDecisions, rejectedRequests} =
        await runApprovedToolCallsAndUpdateClaudeSessionTranscript(span, {
            decisions: mergeResult.decisions,
            context: getContext(roomState),
            sessionStore,
            sessionId: assertExists(resumeSessionId, "resume session ID for approval decision"),
            messageRef,
        });

    // Seed the approved web decisions so the resume gate allows the re-driven calls,
    // and the rejected requests so it denies (rather than re-parks) an exact re-issue
    // of them.
    approvalsRuntime.webDecisions.push(...approvedWebDecisions);
    approvalsRuntime.rejectedRequests.push(...rejectedRequests);

    // The resume nudge steers the model past two failure modes we've watched it hit
    // after an approval decision \u2014 one on every resume, one only after a
    // rejection:
    //
    // 1. Treating a write tool as its reply channel (EVERY resume). On resume the
    //    model reaches for `update`/`create` to deliver its answer instead of just
    //    writing it, even though its response already posts as a message. This
    //    misfires badly in a post: to `update` a post it needs the post's path, so it
    //    re-reads the channel to find it, gets lost among look-alike posts, and can't
    //    tell which one it's responding to (compounded because, on resume, the only
    //    comments on the post are its OWN \u2014 the human's ask is the post body
    //    \u2014 so "reply to the last comment" doesn't anchor it). Reminding it that
    //    its reply is posted for it short-circuits all of that, so this part is in the
    //    base nudge, approve or reject.
    // 2. Routing around a rejection (ONLY after a decline). After a declined write it
    //    re-attempts the same goal another way (e.g. `update` the thread to post what
    //    a rejected `create` would have), which re-parks and double-posts.
    const baseNudge =
        "You\u2019ve received responses to your approval requests. Continue. Reply to the user directly with what you have; your response is posted to the conversation for you, so you don\u2019t need to use the `update` or `create` tool to post your reply.";

    const nudge =
        rejectedRequests.length > 0
            ? `${baseNudge} If a request was declined, don\u2019t try to accomplish it another way.`
            : baseNudge;

    return {type: "Resume", nudge};
}

async function* generateClaudeAgentPrompt(
    span: TracerSpan,
    {
        apiClient,
        eventQueue,
        stateStore,
        storage,
        getContext,
        messageRef,
        waitUntil,
        outstandingMessageIds,
        approvalsRuntime,
        initialNudge,
    }: {
        apiClient: ApiClient;
        eventQueue: EventQueue<ClaudeAgentServiceEvent>;
        stateStore: ClaudeAgentStateStore;
        storage: AgentWebSessionStorage;
        getContext: (room: ClaudeAgentRoomState) => AgentWebContext;
        messageRef: {current: AgentWebMessageStreamSession | null};
        waitUntil: PromiseWaiter["waitUntil"];
        outstandingMessageIds: Set<string>;
        approvalsRuntime: ClaudeAgentApprovalsRuntime;
        /**
         * When resuming after an approval decision, the nudge that starts the resumed
         * turn. The decision event was already consumed and its transcript resolved before
         * the query started (see `resumeClaudeAgentAfterApprovalDecision`); the response
         * message (`messageRef.current`) is already owned. Yielding this kicks the model
         * to continue from the resolved transcript.
         */
        initialNudge: string | null;
    },
): AsyncIterable<SDKUserMessage> {
    let hasSeenFirstEvent = false;

    if (initialNudge !== null) {
        hasSeenFirstEvent = true;

        const messageId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
        outstandingMessageIds.add(messageId);

        yield {
            type: "user",
            uuid: messageId,
            priority: "now",
            parent_tool_use_id: null,
            message: {role: "user", content: [{type: "text", text: initialNudge}]},
        };
    }

    for await (const eventQueueEvent of eventQueue) {
        // We'll close the server after an error in the `finally` block below.
        if (eventQueueEvent.type === "Error") {
            throw eventQueueEvent.error;
        }

        // We'll process the first event and then we'll only process other new events when
        // there's at least one outstanding message. If there's not at least one
        // outstanding message then we'll start a new Claude Agent SDK query loop.
        if (hasSeenFirstEvent && outstandingMessageIds.size === 0) return;
        hasSeenFirstEvent = true;

        if (eventQueueEvent.type === "ApprovalDecisionEvent") {
            // Approval decision events should never make it here. They are always dequeued
            // before the loop, where we use them to manipulate the transcript before resuming
            // the agent.
            span.addException(new InternalError("Unexpected mid-turn approval decision event"));

            eventQueueEvent.acknowledge();

            if (outstandingMessageIds.size === 0) return;
            continue;
        }

        const {request} = eventQueueEvent;
        const {event} = request.body;

        let hasAcknowledged = false;

        const acknowledge = () => {
            if (hasAcknowledged) return;
            hasAcknowledged = true;

            // When we acknowledge the event, ownership of the message stream is transferred to
            // us. So we need to create a `AgentWebMessageStreamSession` which starts a new
            // ping interval to keep the message stream alive.
            eventQueueEvent.acknowledge();

            const oldMessage = messageRef.current;

            messageRef.current = new AgentWebMessageStreamSession({
                parentSpan: span,
                apiClient,
                room: event.room,
                messageIndex: request.streamMessageIndex,
                streamParser: new AgentWebMarkdownStreamParser({
                    storage,
                    documentId: null,
                }),
            });

            // Complete the old message. All new updates are going into `messageRef.current`.
            // We don't need to wait for the message to complete before continuing.
            if (oldMessage) waitUntil(oldMessage.complete(span));
        };

        eventQueueEvent.span?.link("Steered Claude agent SDK", span);

        switch (event.type) {
            case "CreatedMessage": {
                // NOTE(ifitzsimmons, 2026-08-13): Resolve stale approvals first, before anything
                // else can fail or skip past it. A new message means the conversation has moved
                // on, so approvals still awaiting a decision must never be acted on — if the user
                // meant to grant one they can say so and Claude will ask again. We're the only
                // thing that supersedes a batch, so leaving a card actionable here leaves it
                // actionable forever.
                const approvalsState = stateStore.get().approvals;

                if (approvalsState?.pendingBatch) {
                    const {messageIndex} = approvalsState.pendingBatch;

                    // Clear our state BEFORE rejecting, never after. Rejecting patches the card
                    // through the API, which fires a decision webhook straight back at us — and that
                    // can arrive before a later write lands. Clearing first means any run that picks
                    // the event up reads state that already says this batch is done.
                    await stateStore.set(span, {
                        approvals: {...approvalsState, pendingBatch: null},
                    });

                    // Don't await it. The state write above already made the batch un-actionable for
                    // us; the API patch only settles how the card renders, and nothing below reads its
                    // result.
                    waitUntil(
                        rejectPendingClaudeAgentApprovalsIfPossible(span, {
                            apiClient,
                            room: event.room,
                            messageIndex,
                        }),
                    );
                }

                const searchParams = new URLSearchParams();

                searchParams.set("from", "end");
                searchParams.set("before", `${event.index + 1}`);

                const pageLink: AgentWebPageLinkKeyObject = event.room;

                const pageLinkKey = printAgentWebPageLinkKey(pageLink);

                let {room} = stateStore.get();

                if (room === null) {
                    room = {
                        timeZone: event.createdTimeZone,
                        pageLinkKey,
                        lastMessageIndex: event.index,
                    };

                    await stateStore.set(span, {room});
                } else {
                    assert(room.pageLinkKey === pageLinkKey);

                    // If we've already covered this event then skip it. This may happen if a webhook
                    // was delivered twice.
                    if (room.lastMessageIndex !== "post" && room.lastMessageIndex >= event.index) {
                        continue;
                    }

                    searchParams.set("after", `${room.lastMessageIndex}`);

                    room = {
                        ...room,
                        // If the stream message is exactly after the event message then the next Claude
                        // load should start after the stream message. So Claude doesn't both send a new
                        // message (which goes into its transcript) and then see it again when it loads the
                        // next batch of messages.
                        lastMessageIndex:
                            request.streamMessageIndex === event.index + 1
                                ? request.streamMessageIndex
                                : event.index,
                    };

                    await stateStore.set(span, {room});
                }

                const response = await independentlyCallAgentWebReadToolWithoutTruncation(
                    getContext(room),
                    {pageLink, searchParams},
                );

                // Acknowledge the event before we yield. Claude may delay progressing the iterator
                // so we want to acknowledge right before yielding to Claude.
                acknowledge();

                // If this message is steering a running turn, discard that turn's unposted
                // approval requests: they were never shown to the user, and the steered turn will
                // re-request approval for anything it still wants to do. Also drop any sticky
                // rejections from a resumed batch — the conversation has moved on, and the user's
                // new message may itself be asking for the thing they previously declined.
                approvalsRuntime.newRequests = [];
                approvalsRuntime.rejectedRequests = [];

                const messageId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
                outstandingMessageIds.add(messageId);

                yield {
                    type: "user",
                    uuid: messageId,
                    // Important: this is what causes subsequent `yield`s to interrupt and steer the
                    // model.
                    priority: "now",
                    parent_tool_use_id: null,
                    message: {role: "user", content: [{type: "text", text: response}]},
                };
                break;
            }
            case "CreatedPost": {
                const searchParams = new URLSearchParams();

                searchParams.set("from", "end");
                searchParams.set("before", "0");

                const pageLink: AgentWebPageLinkKeyObject = {
                    type: "Post",
                    id: event.room.id,
                };

                const pageLinkKey = printAgentWebPageLinkKey(pageLink);

                let {room} = stateStore.get();

                if (room !== null) {
                    assert(room.pageLinkKey === pageLinkKey);

                    // If we've already covered this event then skip it. This may happen if a webhook
                    // was delivered twice.
                    //
                    // `CreatedPost` should always be the first event we see for a room. So if the room
                    // is already initialized that means we've seen some event in the post before.
                    continue;
                } else {
                    room = {
                        timeZone: event.createdTimeZone,
                        pageLinkKey,
                        // If the stream message is exactly after the event message (or in this case, the
                        // post) then the next Claude load should start after the stream message. So Claude
                        // doesn't both send a new message (which goes into its transcript) and then see it
                        // again when it loads the next batch of messages.
                        lastMessageIndex:
                            request.streamMessageIndex === 0 ? request.streamMessageIndex : "post",
                    };

                    await stateStore.set(span, {room});
                }

                const response = await independentlyCallAgentWebReadToolWithoutTruncation(
                    getContext(room),
                    {pageLink, searchParams},
                );

                // Acknowledge the event before we yield. Claude may delay progressing the iterator
                // so we want to acknowledge right before yielding to Claude.
                acknowledge();

                const messageId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
                outstandingMessageIds.add(messageId);

                yield {
                    type: "user",
                    uuid: messageId,
                    // Important: this is what causes subsequent `yield`s to interrupt and steer the
                    // model.
                    priority: "now",
                    parent_tool_use_id: null,
                    message: {role: "user", content: [{type: "text", text: response}]},
                };
                break;
            }
            default:
                throw exhaustive(event);
        }
    }
}

function getClaudeAgentSystemPromptRoomInformation(room: ApiMessageRoomReference) {
    switch (room.type) {
        case "Chat":
            return {description: "chat room", messageNoun: "message"};
        case "DocumentThread":
            return {description: "document comment thread", messageNoun: "comment"};
        case "Post":
            return {description: "post\u2019s comment section", messageNoun: "comment"};
        case "Task":
            return {description: "task\u2019s comment section", messageNoun: "comment"};
        default:
            throw exhaustive(room);
    }
}
