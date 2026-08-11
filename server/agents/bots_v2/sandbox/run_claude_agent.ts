import {SDKUserMessage, query} from "@anthropic-ai/claude-agent-sdk";
import fs from "fs/promises";
import {v4 as uuidv4} from "uuid";
import {ApiClient} from "~/server/agents/api/api_client.open_source.js";
import {AgentWebMessageStreamSession} from "~/server/agents/bots_v2/sandbox/agent_web_message_stream_session.js";
import {ClaudeAgentServiceEvent} from "~/server/agents/bots_v2/sandbox/claude_agent_service.js";
import {ClaudeAgentSessionStore} from "~/server/agents/bots_v2/sandbox/claude_agent_session_store.js";
import {
    ClaudeAgentRoomState,
    ClaudeAgentStateStore,
} from "~/server/agents/bots_v2/sandbox/claude_agent_state_store.js";
import {createAgentWebFileSystemSessionStorage} from "~/server/agents/bots_v2/sandbox/create_agent_web_file_system_session_storage.js";
import {createClaudeAgentMcpServer} from "~/server/agents/bots_v2/sandbox/create_claude_agent_tools.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.open_source.js";
import {
    AgentWebPageLinkKeyObject,
    printAgentWebPageLinkKey,
} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {independentlyCallAgentWebReadToolWithoutTruncation} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {ApiMessageRoomReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {
    FailedPreconditionError,
    InternalError,
    UnimplementedError,
} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {EventQueue} from "~/shared/helpers/control/event_queue.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export type RunClaudeAgentOptions = {
    spaceId: SpaceId;
    botAccount: {id: AccountId; bot: {id: BotId}};
    apiClient: ApiClient;
    room: ApiMessageRoomReference;
    eventQueue: EventQueue<ClaudeAgentServiceEvent>;
};

export async function runClaudeAgent(span: TracerSpan, options: RunClaudeAgentOptions) {
    await span.withSpan("Run Claude agent SDK", async span => {
        await actuallyRunClaudeAgent(span, options);
    });
}

async function actuallyRunClaudeAgent(
    span: TracerSpan,
    {spaceId, botAccount, apiClient, room, eventQueue}: RunClaudeAgentOptions,
) {
    const [
        ,
        ,
        stateStore,
        {
            data: {settings},
        },
    ] = await runAllPromises([
        fs.mkdir("/workspace/agent", {recursive: true}),
        fs.mkdir("/workspace/config", {recursive: true}),
        ClaudeAgentStateStore.new(),
        apiClient.get(span, "/spaces/{id}/bots/{botId}/settings", {
            params: {path: {id: spaceId, botId: botAccount.bot.id}},
        }),
    ]);

    const resumeSessionId = stateStore.get().sessionId;
    const sessionStore = new ClaudeAgentSessionStore();

    const storage = createAgentWebFileSystemSessionStorage(spaceId);

    let context: AgentWebContext | null = null;

    const getContext = (roomState: ClaudeAgentRoomState): AgentWebContext => {
        context ??= {
            spaceId,
            api: apiClient,
            storage,
            span,
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
    const promiseWaiter = new PromiseWaiter();
    const outstandingMessageIds = new Set<string>();

    try {
        let thinkingContentBlock: {
            index: number;
            text: string;
        } | null = null;

        const roomInformation = getClaudeAgentSystemPromptRoomInformation(room);

        const allowedTools = [
            "Skill",
            "mcp__alpine__read",
            "mcp__alpine__search",
            "mcp__alpine__scroll",
            "mcp__alpine__find",
        ];

        // We only enable web-fetch/web-search/write tools in development. In production we
        // need the user to approve the web-fetch/web-search/write to make sure an attacker
        // isn't exfiltrating information.
        //
        // TODO(#claude-bot): Implement approvals
        if (process.env.NODE_ENV !== "production") {
            allowedTools.push(
                "WebFetch",
                "WebSearch",
                "mcp__alpine__update",
                "mcp__alpine__create",
                "mcp__alpine__delete",
            );
        }

        const tools = [...allowedTools];

        for await (const message of query({
            prompt: generateClaudeAgentPrompt(span, {
                apiClient,
                eventQueue,
                stateStore,
                storage,
                getContext,
                messageRef,
                promiseWaiter,
                outstandingMessageIds,
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
You are a bot running in Alpine, an all-in-one productivity suite where humans and agents work together. Use the \`alpine\` skill to learn more about your environment. Anything in Alpine can be read with the \`read\` or \`search\` tool and anything in Alpine can be written with the \`update\`, \`create\`, or \`delete\` tool.

You\u2019ve been sent a message in a ${roomInformation.description}. The last \`<${roomInformation.messageNoun}>\` is the one you\u2019re responding to. Your response will create a new \`<${roomInformation.messageNoun}>\` so you don\u2019t need to use the \`update\` tool to respond in the ${roomInformation.description}.

You don\u2019t have direct file system access. You\u2019ll work entirely within the Alpine environment. You\u2019ll find that reading/writing Alpine content is a lot like reading/writing files in a file system so you should feel right at home.`,
                tools,
                allowedTools,
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
        })) {
            switch (message.type) {
                case "system": {
                    if (message.subtype === "init") {
                        if (resumeSessionId !== null) {
                            assert(resumeSessionId === message.session_id);
                        } else {
                            await stateStore.set({sessionId: message.session_id});
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
                        span,
                        `I couldn\u2019t generate a response.`,
                    );

                    let hasSeenContentBlock = false;

                    for (const contentBlock of message.message.content) {
                        if (contentBlock.type !== "text") continue;

                        const isFirstContentBlock = !hasSeenContentBlock;
                        hasSeenContentBlock = true;

                        assertExists(messageRef.current).pushText(
                            span,
                            `${isFirstContentBlock ? " " : "\n\n"}${contentBlock.text}`,
                        );
                    }
                    break;
                }

                case "stream_event": {
                    const {event} = message;

                    switch (event.type) {
                        case "content_block_start": {
                            if (event.content_block.type === "thinking") {
                                thinkingContentBlock = {index: event.index, text: ""};
                            }
                            break;
                        }
                        case "content_block_stop": {
                            if (thinkingContentBlock?.index === event.index) {
                                if (thinkingContentBlock.text.length > 0) {
                                    assertExists(messageRef.current).pushReasoningSummary(
                                        span,
                                        thinkingContentBlock.text,
                                    );
                                }

                                thinkingContentBlock = null;
                            }
                            break;
                        }
                        case "content_block_delta": {
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
        // **The nuclear option.**
        //
        // If an error was thrown, then remove ALL our stored data in the bucket so the
        // next attempt starts from a clean slate. The reason being it seems like Claude
        // won't use the session store to persist the session if an error is thrown. So we
        // get into a bad state if we have a `sessionId` in `ClaudeAgentSessionStore` but
        // that session doesn't exist in the R2 bucket because an error was thrown.
        await runAllPromises(
            (await fs.readdir("/workspace/bucket")).map(name =>
                fs.rm(`/workspace/bucket/${name}`, {recursive: true}),
            ),
        );

        throw error;
    } finally {
        const message = messageRef.current;
        messageRef.current = null;
        if (message) promiseWaiter.waitUntil(message.complete(span));

        await promiseWaiter.wait();
    }
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
        promiseWaiter,
        outstandingMessageIds,
    }: {
        apiClient: ApiClient;
        eventQueue: EventQueue<ClaudeAgentServiceEvent>;
        stateStore: ClaudeAgentStateStore;
        storage: AgentWebSessionStorage;
        getContext: (room: ClaudeAgentRoomState) => AgentWebContext;
        messageRef: {current: AgentWebMessageStreamSession | null};
        promiseWaiter: PromiseWaiter;
        outstandingMessageIds: Set<string>;
    },
): AsyncIterable<SDKUserMessage> {
    let hasSeenFirstEvent = false;

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

        const {request} = eventQueueEvent;
        const {event} = request;

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
                room: request.event.room,
                messageIndex: request.streamMessageIndex,
                streamParser: new AgentWebMarkdownStreamParser({
                    storage,
                    documentId: null,
                }),
            });

            // Complete the old message. All new updates are going into `messageRef.current`.
            // We don't need to wait for the message to complete before continuing.
            if (oldMessage) promiseWaiter.waitUntil(oldMessage.complete(span));
        };

        eventQueueEvent.span?.link("Steered Claude agent SDK", span);

        switch (event.type) {
            case "CreatedMessage": {
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

                    await stateStore.set({room});
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

                    await stateStore.set({room});
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

                    await stateStore.set({room});
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
            case "UpdatedMessageStreamExperimentalApprovalsPart": {
                // TODO(#claude-bot): Implement approvals
                throw new UnimplementedError("Approvals not implemented");
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
