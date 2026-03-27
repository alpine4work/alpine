import escapeHtml from "escape-html";
import {Root, RootContent} from "mdast";
import {
    ApiClient,
    completeApiMessageStream,
    createApiClient,
    createApiMessage,
    createApiMessageStreamPart,
    getApiMessagesFromStart,
    pingApiMessageStream,
} from "~/server/agents/api/api_client.js";
import {
    AgentContext,
    AgentDurableObjectBase,
    AgentDurableObjectStorageInterface,
    AgentWebhookRequest,
} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {agentInstructionsMarkdown as markdown} from "~/server/agents/bots/internal/agent_instructions_markdown.js";
import {
    agentInitializeMessagesTokenLimit,
    agentPaginationTokenLimitGrowthFactor,
    cursorAgentInitializeMessagesTokenLimit,
} from "~/server/agents/bots/internal/agent_limits.js";
import {AgentServiceEnv} from "~/server/agents/bots/internal/agent_service_env.js";
import {AgentConversationState} from "~/server/agents/bots/internal/conversation/agent_conversation_store.js";
import {convertApiContentToProperQuotes} from "~/server/agents/bots/internal/convert_api_content_to_proper_quotes.js";
import {collectLinksFromMarkdownTreeForCursorAgent} from "~/server/agents/bots/internal/cursor/collect_links_from_markdown_tree_for_cursor_agent.js";
import {CursorClient} from "~/server/agents/bots/internal/cursor/cursor_client.js";
import {CursorCloudAgentsApiSpecification} from "~/server/agents/bots/internal/cursor/cursor_cloud_agents_api_specification_types.js";
import {stripLinksFromMarkdownTreeForCursorAgent} from "~/server/agents/bots/internal/cursor/strip_links_from_markdown_tree_for_cursor_agent.js";
import {getAgentLink} from "~/server/agents/bots/internal/link_references/agent_link_collection.js";
import {loadAgentLinkContent} from "~/server/agents/bots/internal/link_references/load_agent_link_content.js";
import {AgentMessage} from "~/server/agents/bots/internal/messages/agent_message.js";
import {getAgentMessagesBetweenIndexes} from "~/server/agents/bots/internal/messages/get_agent_messages_between_indexes.js";
import {loadInitialAgentMessagesContent} from "~/server/agents/bots/internal/messages/initialize_messages_in_agent_conversation.js";
import {printAgentMessagesIntoMarkdownTree} from "~/server/agents/bots/internal/messages/print_agent_messages_log.js";
import {printAgentContentMarkdownTree} from "~/server/agents/bots/internal/print_api_content_to_agent_markdown.js";
import {
    isOneOnOneChat,
    shouldAgentRespondToRequest,
} from "~/server/agents/bots/internal/should_agent_respond_to_request.js";
import {
    DurableObjectStorageCollection,
    DurableObjectTransactionInterface,
} from "~/server/cloudflare/durable_object_storage_collection.js";
import {TemporaryDurableObjectStorage} from "~/server/cloudflare/temporary_durable_object_storage.js";
import {agentMessageStreamPingIntervalMs} from "~/shared/agents/default_agent_message_ping_interval_ms.js";
import {AgentMessageStream} from "~/shared/api/markdown/agent_message_stream.js";
import {
    ApiMessageRoomPath,
    printApiMessageRoomPath,
} from "~/shared/api/specification/parse_api_path.js";
import {
    ApiContentBlockElement,
    ApiContentTextInlineElement,
    ApiMessageRoomTarget,
    ApiMessageStreamPartPayload,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {
    ErrorBase,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {addToIterable} from "~/shared/helpers/iterable/add_to_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {doesStringEndWithPunctuation} from "~/shared/helpers/string/does_string_end_with_punctuation.js";
import {generateId, isId} from "~/shared/id/id.js";
import {AccountId, BotId, CursorCloudAgentId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// The `/webhook` route is shared across all agents and parsed/handled in
// `AgentDurableObjectBase`.
type CursorAgentRoute =
    | {type: "CloudAgentsWebhook"; agentId: CursorCloudAgentId}
    | {type: "NotFound"};

const CursorCloudAgentCollection = new DurableObjectStorageCollection<
    CursorCloudAgentId,
    CursorCloudAgent
>("b00");

type CursorCloudAgentStatus =
    CursorCloudAgentsApiSpecification.operations["getAgent"]["responses"][200]["content"]["application/json"]["status"];

type CursorCloudAgent = {
    readonly actualId: string;
    readonly name: string;
    readonly targetUrl: string;
    readonly targetBranchName: string | null;
    readonly targetPrUrl: string | null;
    readonly webhookSecret: string;
    readonly apiAccessToken: string;
    readonly spaceId: SpaceId;
    readonly botId: BotId;
    readonly botAccountId: AccountId;
    readonly room: ApiMessageRoomTarget;
    readonly startTime: Date;
    readonly timeZone: TimeZone;
    readonly launchMessageIndex: number;
    readonly followUpMessageIndexes: ReadonlySet<number>;
    readonly statusChangeMessageIndexes: ReadonlySet<number>;
    readonly status: CursorCloudAgentStatus;
};

const CursorCloudAgentReferenceByMessageIndexCollection = new DurableObjectStorageCollection<
    `${ApiMessageRoomPath}:${number}`,
    CursorCloudAgentReference
>("b01");

type CursorCloudAgentReference = {
    readonly agentId: CursorCloudAgentId;
    readonly kind: "Launch" | "FollowUp" | "StatusChange";
};

const cursorAgentInstructions = markdown`
The following is the conversation history that led to the launch of this agent. Each message is
Markdown wrapped in a \`<human>\` or \`<bot>\` XML tag. The last message is the one that launched
this agent. Follow the instructions in the last message.

Markdown links have been removed (e.g. \`[link label](link-url)\` is now \`link label\`). Except for
a few important links such as the links in the message which launched this agent. Linked content
will be included in \`<attachment>\` XML tags after the last message.
`;

export class CursorAgentDurableObject extends AgentDurableObjectBase<CursorAgentRoute, never> {
    constructor(state: DurableObjectState, env: AgentServiceEnv) {
        super("CursorAgentService", state, env);
    }

    protected override _getApiKey() {
        return assertExists(
            this._env.CURSOR_API_SERVICE_KEY,
            "Missing `CURSOR_API_SERVICE_KEY` environment variable",
        );
    }

    protected override _parseRoute(url: URL): [string, CursorAgentRoute] {
        if (url.pathname.startsWith("/cloud-agents-webhook/")) {
            const pathnameParts = url.pathname.slice("/cloud-agents-webhook/".length).split("/");

            if (pathnameParts.length === 1 && isId<CursorCloudAgentId>(pathnameParts[0]!)) {
                return [
                    "/cloud-agents-webhook/:agentId",
                    {type: "CloudAgentsWebhook", agentId: pathnameParts[0]},
                ];
            }
        }

        return ["/*", {type: "NotFound"}];
    }

    protected override async _fetch(
        context: AgentContext,
        request: Request,
        route: CursorAgentRoute,
        span: TracerSpan,
    ): Promise<Response> {
        switch (route.type) {
            case "CloudAgentsWebhook": {
                try {
                    await handleCursorCloudAgentsThirdPartyWebhook({
                        env: this._env,
                        apiKey: this._getApiKey(),
                        storage: this._state.storage,
                        request,
                        agentId: route.agentId,
                        span,
                    });

                    return new Response("200 OK", {
                        status: 200,
                        headers: {"content-type": "text/plain"},
                    });
                } catch (error) {
                    // Log errors in development since webhook errors aren't shown to the developer in
                    // the UI. So we need to show webhook errors in our logs.
                    if (process.env.NODE_ENV !== "production") {
                        // eslint-disable-next-line no-console
                        console.error("Cursor Cloud Agents webhook failed:", error);
                    }

                    throw error;
                }
            }
            case "NotFound": {
                return new Response("404 Not Found", {
                    status: 404,
                    headers: {"content-type": "text/plain"},
                });
            }
            default:
                throw exhaustive(route);
        }
    }

    protected override async _event(tracer: TracerBase, event: never): Promise<void> {
        cast<never>(event);

        throw new UnimplementedError("Cursor agent has no scheduled events");
    }

    public override async webhook(span: TracerSpan, request: AgentWebhookRequest) {
        // Check if the agent should respond before continuing.
        if (!(await shouldAgentRespondToRequest(span, request))) return;

        if (
            request.event.type === "NewMessage" &&
            request.event.parent?.type === "Message" &&
            request.event.parent?.author.id === request.botAccountId
        ) {
            const agentReference = await CursorCloudAgentReferenceByMessageIndexCollection.get(
                request.storage,
                `${printApiMessageRoomPath(request.room)}:${request.event.parent.index}`,
            );

            if (agentReference) {
                const agent = assertExists(
                    await CursorCloudAgentCollection.get(request.storage, agentReference.agentId),
                    "If `agentReference` exists then `agent` must also exist",
                );

                await handleCursorAgentAddFollowUpFirstPartyWebhook({
                    env: this._env,
                    storage: this._state.storage,
                    span,
                    // We narrow the type in the `if` above so this cast is safe.
                    request: request as AgentWebhookRequest & {event: {type: "NewMessage"}},
                    agentId: agentReference.agentId,
                    agent,
                });
                return;
            }
        }

        await handleCursorAgentLaunchFirstPartyWebhook({
            env: this._env,
            storage: this._state.storage,
            durableObjectId: this._state.id,
            span,
            request,
        });
    }
}

async function getCursorBotSettings({
    env,
    span,
    apiClient,
    spaceId,
    botId,
    accountId,
}: {
    env: AgentServiceEnv;
    span: TracerSpan;
    apiClient: ApiClient;
    spaceId: SpaceId;
    botId: BotId;
    accountId: AccountId;
}) {
    const response = await apiClient.get(
        span,
        "/spaces/{id}/accounts/{accountId}/bots/{botId}/settings",
        {params: {path: {id: spaceId, accountId, botId}}},
    );

    const {settings} = response.data;

    const accountCloudAgentApiKey =
        hasOwnProperty(settings.values, "accountCloudAgentApiKey") &&
        typeof settings.values.accountCloudAgentApiKey === "string" &&
        settings.values.accountCloudAgentApiKey.length > 0
            ? settings.values.accountCloudAgentApiKey
            : null;

    const spaceCloudAgentApiKey =
        hasOwnProperty(settings.space.values, "cloudAgentApiKey") &&
        typeof settings.space.values.cloudAgentApiKey === "string" &&
        settings.space.values.cloudAgentApiKey.length > 0
            ? settings.space.values.cloudAgentApiKey
            : null;

    const cloudAgentApiKey = accountCloudAgentApiKey ?? spaceCloudAgentApiKey;

    if (!cloudAgentApiKey) {
        throw new FailedPreconditionError("Missing `cloudAgentApiKey` string in bot settings", {
            displayMessage: errorDisplayMessage`Please add a Cursor Cloud Agents API key in ${errorDisplayMessage.link("settings", `${env.EDGE_SERVICE_URL}/settings/${spaceId}/bots/${botId}`)}.`,
        });
    }

    const githubRepositoryUrl = hasOwnProperty(settings.space.values, "githubRepositoryUrl")
        ? settings.space.values.githubRepositoryUrl
        : undefined;

    if (typeof githubRepositoryUrl !== "string" || githubRepositoryUrl.length === 0) {
        throw new FailedPreconditionError("Missing `githubRepositoryUrl` string in bot settings", {
            displayMessage: errorDisplayMessage`Please add a GitHub repository URL in ${errorDisplayMessage.link("settings", `${env.EDGE_SERVICE_URL}/settings/${spaceId}/bots/${botId}`)}.`,
        });
    }

    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(githubRepositoryUrl)) {
        throw new FailedPreconditionError("Invalid `githubRepositoryUrl` string in bot settings", {
            displayMessage: errorDisplayMessage`\u201C${githubRepositoryUrl}\u201D isn\u2019t a valid GitHub repository URL. Make sure your GitHub repository URL in ${errorDisplayMessage.link("settings", `${env.EDGE_SERVICE_URL}/settings/${spaceId}/bots/${botId}`)} is formatted as \u201Chttps://github.com/your-org/your-repo\u201D.`,
        });
    }

    return {
        cloudAgentApiKey,
        githubRepositoryUrl,
    };
}

async function withCursorAgentMessageStreamSession<Value>(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    action: (launchMessageSession: {
        index: number;
        createStreamPart: (payload: ApiMessageStreamPartPayload) => Promise<void>;
    }) => Promise<Value>,
): Promise<Value> {
    const {
        data: {message},
    } = await createApiMessage(tracer, request.apiClient, request.room, {
        isStream: true,
        content: {elements: []},
        createdTimeZone: request.event.createdTimeZone,
    });

    const mutex = new Mutex();

    const createPingInterval = () => {
        return createInterval(() => {
            void mutex.withLock(async () => {
                await pingApiMessageStream(tracer, request.apiClient, request.room, message.index);
            });
        }, agentMessageStreamPingIntervalMs);
    };

    let pingInterval: Interval | null = null;
    pingInterval = createPingInterval();

    const createStreamPart = async (payload: ApiMessageStreamPartPayload) => {
        await mutex.withLock(async () => {
            // Pause the ping interval while creating a stream part.
            pingInterval?.clear();
            pingInterval = null;

            await createApiMessageStreamPart(
                tracer,
                request.apiClient,
                request.room,
                message.index,
                {payload},
            );

            // Resume the ping interval.
            assert(pingInterval === null);
            pingInterval = createPingInterval();
        });
    };

    try {
        try {
            const value = await action({
                index: message.index,
                createStreamPart,
            });

            return value;
        } catch (error) {
            // If an error was thrown then update the stream with the error message.

            const displayMessage =
                error instanceof ErrorBase
                    ? (error.displayMessage ?? defaultErrorDisplayMessage)
                    : defaultErrorDisplayMessage;

            await createStreamPart({
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: Array.from(
                                concatIterables(
                                    [{type: "Text", text: "Couldn\u2019t start coding. "}],
                                    renderErrorDisplayMessageForCursorAgent(displayMessage),
                                ),
                            ),
                        },
                    ],
                },
            });

            throw error;
        }
    } finally {
        // All done with the message stream!
        pingInterval?.clear();
        pingInterval = null;
        await mutex.waitForUnlock();
        await completeApiMessageStream(tracer, request.apiClient, request.room, message.index);
    }
}

function* renderErrorDisplayMessageForCursorAgent(
    displayMessage: ErrorDisplayMessage,
): IterableIterator<ApiContentTextInlineElement> {
    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
            case "SensitiveText":
                yield {type: "Text", text: segment.text};
                break;

            case "Link":
                yield {type: "Text", text: segment.text, marks: [{type: "Link", url: segment.url}]};
                break;

            default:
                throw exhaustive(segment);
        }
    }
}

async function handleCursorAgentLaunchFirstPartyWebhook({
    env,
    storage,
    durableObjectId,
    span,
    request,
}: {
    env: AgentServiceEnv;
    storage: AgentDurableObjectStorageInterface;
    durableObjectId: DurableObjectId;
    span: TracerSpan;
    request: AgentWebhookRequest;
}) {
    // In-memory storage that's garbage collected after this webhook finishes. We use
    // for storing links discovered while printing agent messages. Since we don't need
    // to keep track of links after the one-shot webhook finishes.
    const temporaryStorage = new TemporaryDurableObjectStorage();

    const conversationState = {
        timeZone: request.event.createdTimeZone,
        startTime: new Date(),
    };

    const setupPromise = runAllPromises([
        getCursorBotSettings({
            env,
            span,
            apiClient: request.apiClient,
            spaceId: request.spaceId,
            botId: request.botId,
            accountId: request.event.authorId,
        }),
        isOneOnOneChat(span, request).then(isOneOnOneChat =>
            loadInitialAgentMessagesContent({
                tracer: span,
                transaction: temporaryStorage,
                request,
                conversationState,
                // Cursor doesn't have tool calls so we load more context by default since it won't
                // be able to load more itself. However, if this is a 1:1 chat then it's likely
                // that one message = one Cloud Agent since every message gets a response from our
                // bot.
                tokenLimitForPage: isOneOnOneChat
                    ? agentInitializeMessagesTokenLimit
                    : cursorAgentInitializeMessagesTokenLimit,
            }),
        ),
    ]);

    await runAllPromises([
        setupPromise,
        withCursorAgentMessageStreamSession(span, request, async launchMessageSession => {
            const [
                settings,
                {
                    preamble: promptPreamble,
                    messages: promptMessages,
                    messagesContent: promptMessagesContent,
                },
            ] = await setupPromise;

            const cursorClient = new CursorClient({
                cloudAgentApiKey: settings.cloudAgentApiKey,
                edgeServiceUrl: env.EDGE_SERVICE_URL,
                spaceId: request.spaceId,
                botId: request.botId,
            });

            const {agentId, webhookSecret, launchedAgent} = await launchCursorCloudAgent({
                span,
                env,
                temporaryStorage,
                durableObjectId,
                request,
                conversationState,
                cursorClient,
                githubRepositoryUrl: settings.githubRepositoryUrl,
                promptPreamble,
                promptMessages,
                promptMessagesContent,
            });

            await storage.transaction(async transaction => {
                await CursorCloudAgentReferenceByMessageIndexCollection.put(
                    transaction,
                    `${printApiMessageRoomPath(request.room)}:${launchMessageSession.index}`,
                    {agentId, kind: "Launch"},
                );

                // Keep track of the agent for future requests (e.g. cloud agent webhook calls).
                await CursorCloudAgentCollection.put(transaction, agentId, {
                    actualId: launchedAgent.id,
                    name: launchedAgent.name,
                    targetUrl: launchedAgent.target.url,
                    targetBranchName: launchedAgent.target.branchName ?? null,
                    targetPrUrl: launchedAgent.target.prUrl ?? null,
                    webhookSecret,
                    apiAccessToken: request.apiAccessToken,
                    spaceId: request.spaceId,
                    botId: request.botId,
                    botAccountId: request.botAccountId,
                    room: request.room,
                    startTime: conversationState.startTime,
                    timeZone: request.event.createdTimeZone,
                    launchMessageIndex: launchMessageSession.index,
                    followUpMessageIndexes: emptySet,
                    statusChangeMessageIndexes: emptySet,
                    status: launchedAgent.status,
                });
            });

            const elements: Array<ApiContentBlockElement> = [];

            elements.push({
                type: "Heading",
                level: 2,
                elements: [{type: "Text", text: launchedAgent.name}],
            });

            const paragraphElements: Array<ApiContentTextInlineElement> = [];

            elements.push({
                type: "Paragraph",
                elements: paragraphElements,
            });

            paragraphElements.push(
                {type: "Text", text: "Started coding. I\u2019ll let you know when I\u2019m done ("},
                {
                    type: "Text",
                    text: "watch me work",
                    marks: [{type: "Link", url: launchedAgent.target.url}],
                },
                {type: "Text", text: ")."},
            );

            await launchMessageSession.createStreamPart({
                type: "Content",
                content: {elements},
            });
        }),
    ]);
}

async function launchCursorCloudAgent({
    span,
    env,
    temporaryStorage,
    durableObjectId,
    request,
    conversationState,
    cursorClient,
    githubRepositoryUrl,
    promptPreamble,
    promptMessages,
    promptMessagesContent,
}: {
    span: TracerSpan;
    env: AgentServiceEnv;
    temporaryStorage: TemporaryDurableObjectStorage;
    durableObjectId: DurableObjectId;
    request: AgentWebhookRequest;
    conversationState: Pick<AgentConversationState, "timeZone" | "startTime">;
    cursorClient: CursorClient;
    githubRepositoryUrl: string;
    promptPreamble: Array<RootContent>;
    promptMessages: Array<AgentMessage>;
    promptMessagesContent: Root;
}) {
    const agentId = generateId<CursorCloudAgentId>();

    // Generate a secret that's at least 32 characters long.
    const webhookSecretBytes = new Uint8Array(24);
    crypto.getRandomValues(webhookSecretBytes);
    const webhookSecret = encodeBase64(webhookSecretBytes);

    const webhookUrl = `${request.origin}/cursor/cloud-agents-webhook/${durableObjectId.toString()}/${agentId}`;
    let actualWebhookUrl = webhookUrl;

    // Provide debugging instructions for developers testing webhook functionality. Not
    // the most bulletproof of debugging methods but it's good enough for now.
    if (process.env.NODE_ENV === "development") {
        if (!env.CURSOR_AGENT_SMEE_WEBHOOK_URL) {
            // eslint-disable-next-line no-console
            console.log(
                "To receive Cursor Cloud Agents webhook events you need to set `CURSOR_AGENT_SMEE_WEBHOOK_URL` in `.env.development.local` to a channel from `https://smee.io` and install `smee-client` (`pnpm install --global smee-client`).",
            );
        } else {
            // eslint-disable-next-line no-console
            console.log(
                `To receive Cursor Cloud Agents webhook events, quickly run this: \`smee --url ${env.CURSOR_AGENT_SMEE_WEBHOOK_URL} --target ${webhookUrl}\``,
            );

            actualWebhookUrl = env.CURSOR_AGENT_SMEE_WEBHOOK_URL;
        }
    }

    const lastPromptMessage = promptMessages[promptMessages.length - 1];

    const promptPreambleFirstParagraph = promptPreamble.find(node => node.type === "paragraph");

    // Include some links from the preamble in context.
    const preambleLinkLabelByUrl = new Map(
        filterIterable(
            collectLinksFromMarkdownTreeForCursorAgent({
                type: "root",
                // Only look for links in the first paragraph of the preamble. This is a hacky
                // approach to make sure we don't include links from the `<document_preview>` in
                // document comment thread preambles.
                children: promptPreambleFirstParagraph ? [promptPreambleFirstParagraph] : [],
            }),
            ([path]) => {
                switch (request.room.type) {
                    case "Chat": {
                        // Include no preamble links for chat, it's self explanatory.
                        return false;
                    }
                    case "Post": {
                        // Include no preamble links for post. The post content is included in the printed
                        // messages.
                        return false;
                    }
                    case "DocumentCommentThread": {
                        // If the preamble links to the document, then include the document in context.
                        // Since linking to the document means it wasn't included in the preamble.
                        return path.startsWith("/document/");
                    }
                    case "Task": {
                        // If the preamble links to the task, then include the task in context. Since
                        // linking to the task means it wasn't included in the preamble.
                        return path.startsWith("/task/");
                    }
                    default:
                        throw exhaustive(request.room);
                }
            },
        ),
    );

    const lastMessageLinkLabelByUrl = lastPromptMessage
        ? collectLinksFromMarkdownTreeForCursorAgent({
              type: "root",
              children: lastPromptMessage.markdownContent,
          })
        : emptyMap;

    const linkLabelByUrl = new Map(
        concatIterables(preambleLinkLabelByUrl, lastMessageLinkLabelByUrl),
    );

    // Remove all links from the conversation history. Cursor cloud agents can't read
    // links so it doesn't make sense to spend tokens on them.
    //
    // Don't remove links from the last message. We'll be loading content from those
    // links and adding it to the prompt.
    stripLinksFromMarkdownTreeForCursorAgent(promptMessagesContent, {
        shouldKeepLink: ({url}) => linkLabelByUrl.has(url),
    });

    const promptAttachmentsContent = await loadCursorCloudAgentPromptAttachmentsContent({
        span,
        temporaryStorage,
        request,
        conversationState,
        linkLabelByUrl,
    });

    // Launch the agent! 🚀
    const launchedAgent = await cursorClient.launchCloudAgent(span, {
        prompt: {
            text:
                cursorAgentInstructions.get().trim() +
                "\n\n" +
                printAgentContentMarkdownTree(promptMessagesContent).trim() +
                // Add any linked content as attachments to the end of the prompt.
                (promptAttachmentsContent.length > 0
                    ? `\n\n${promptAttachmentsContent.join("\n\n")}`
                    : ""),
        },
        source: {
            repository: githubRepositoryUrl,
        },
        target: {
            autoCreatePr: true,
            openAsCursorGithubApp: true,
            skipReviewerRequest: true,
            autoBranch: true,
        },
        webhook: {
            url: actualWebhookUrl,
            secret: webhookSecret,
        },
    });

    return {agentId, webhookSecret, launchedAgent};
}

async function loadCursorCloudAgentPromptAttachmentsContent({
    span,
    temporaryStorage,
    request,
    conversationState,
    linkLabelByUrl,
}: {
    span: TracerSpan;
    temporaryStorage: TemporaryDurableObjectStorage;
    request: AgentWebhookRequest;
    conversationState: Pick<AgentConversationState, "timeZone" | "startTime">;
    linkLabelByUrl: ReadonlyMap<string, string>;
}) {
    return await runAllPromises(
        mapIterable(linkLabelByUrl, async ([linkUrl]) => {
            // Agent links were put in `temporaryStorage` since they're not needed after the
            // webhook finishes.
            const link = assertExists(
                await getAgentLink(temporaryStorage, linkUrl),
                "Expected link to exist in temporary storage since we should have just put it there",
            );

            const markdownTree = await loadAgentLinkContent({
                tracer: span,
                transaction: temporaryStorage,
                request,
                link,
                conversationState,
                // Load a number of tokens as if the agent made 3 "Next page" reads. Since Cursor
                // doesn't have tool calls we need to aggressively load the context it needs.
                //
                // We only load the links in the last message which is the message that launched
                // the Cursor agent so we feel pretty good that this is useful context.
                tokenLimitFactor:
                    agentPaginationTokenLimitGrowthFactor ** 0 +
                    agentPaginationTokenLimitGrowthFactor ** 1 +
                    agentPaginationTokenLimitGrowthFactor ** 2,
            });

            // Remove all links from the loaded content. Cursor cloud agents can't read links
            // so it doesn't make sense to spend tokens on them.
            stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
                shouldKeepLink: ({url}) => linkLabelByUrl.has(url),
            });

            return (
                `<attachment path="${escapeHtml(linkUrl)}">\n` +
                printAgentContentMarkdownTree(markdownTree).trim() +
                "\n</attachment>"
            );
        }),
    );
}

async function handleCursorAgentAddFollowUpFirstPartyWebhook({
    env,
    storage,
    span,
    request,
    agentId,
    agent,
}: {
    env: AgentServiceEnv;
    storage: AgentDurableObjectStorageInterface;
    span: TracerSpan;
    request: AgentWebhookRequest & {event: {type: "NewMessage"}};
    agentId: CursorCloudAgentId;
    agent: CursorCloudAgent;
}) {
    // In-memory storage that's garbage collected after this webhook finishes. We use
    // for storing links discovered while printing agent messages. Since we don't need
    // to keep track of links after the one-shot webhook finishes.
    const temporaryStorage = new TemporaryDurableObjectStorage();

    let lastMessageIndex = agent.launchMessageIndex;

    // Find the last message the agent has in context. We only load additional context
    // into the agent for launch messages and follow-up messages.
    for (const messageIndex of agent.followUpMessageIndexes) {
        if (messageIndex > lastMessageIndex) {
            lastMessageIndex = messageIndex;
        }
    }

    const setupPromise = runAllPromises([
        getCursorBotSettings({
            env,
            span,
            apiClient: request.apiClient,
            spaceId: request.spaceId,
            botId: request.botId,
            accountId: request.event.authorId,
        }),
        getAgentMessagesBetweenIndexes(
            span,
            temporaryStorage,
            request,
            // `startMessageIndex` is exclusive. We want to load the last message into context
            // since the agent hasn't seen it yet.
            lastMessageIndex - 1,
            request.event.index,
        ).then(messages => ({
            messages: messages ?? [],
            messagesContent: printAgentMessagesIntoMarkdownTree(messages ?? [], {
                time: agent.startTime,
                timeZone: agent.timeZone,
            }),
        })),
    ]);

    await runAllPromises([
        setupPromise,
        withCursorAgentMessageStreamSession(span, request, async followUpMessageSession => {
            const [settings, {messages: promptMessages, messagesContent: promptMessagesContent}] =
                await setupPromise;

            const cursorClient = new CursorClient({
                cloudAgentApiKey: settings.cloudAgentApiKey,
                edgeServiceUrl: env.EDGE_SERVICE_URL,
                spaceId: request.spaceId,
                botId: request.botId,
            });

            await addCursorCloudAgentFollowUp({
                span,
                temporaryStorage,
                request,
                agent,
                conversationState: {
                    startTime: agent.startTime,
                    timeZone: agent.timeZone,
                },
                cursorClient,
                promptMessages,
                promptMessagesContent: {type: "root", children: promptMessagesContent},
            });

            await storage.transaction(async transaction => {
                await CursorCloudAgentReferenceByMessageIndexCollection.put(
                    transaction,
                    `${printApiMessageRoomPath(request.room)}:${followUpMessageSession.index}`,
                    {agentId, kind: "FollowUp"},
                );

                // Keep track of the agent for future requests (e.g. cloud agent webhook calls).
                await CursorCloudAgentCollection.put(transaction, agentId, {
                    ...agent,
                    // Refresh the API access token so webhook calls from Cursor work even if the
                    // previous access token expired.
                    apiAccessToken: request.apiAccessToken,
                    // Record the follow-up message in our agent object.
                    followUpMessageIndexes: new Set(
                        addToIterable(agent.followUpMessageIndexes, followUpMessageSession.index),
                    ),
                });
            });

            const elements: Array<ApiContentBlockElement> = [];

            elements.push({
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Gotcha. I\u2019ll update my \u201C"},
                    {
                        type: "Text",
                        text: agent.name,
                        marks: agent.targetPrUrl ? [{type: "Link", url: agent.targetPrUrl}] : [],
                    },
                    {type: "Text", text: "\u201D PR ("},
                    {
                        type: "Text",
                        text: "watch me work",
                        marks: [{type: "Link", url: agent.targetUrl}],
                    },
                    {type: "Text", text: ")."},
                ],
            });

            await followUpMessageSession.createStreamPart({
                type: "Content",
                content: {elements},
            });
        }),
    ]);
}

async function addCursorCloudAgentFollowUp({
    span,
    temporaryStorage,
    request,
    agent,
    conversationState,
    cursorClient,
    promptMessages,
    promptMessagesContent,
}: {
    span: TracerSpan;
    temporaryStorage: TemporaryDurableObjectStorage;
    request: AgentWebhookRequest;
    agent: CursorCloudAgent;
    conversationState: Pick<AgentConversationState, "timeZone" | "startTime">;
    cursorClient: CursorClient;
    promptMessages: Array<AgentMessage>;
    promptMessagesContent: Root;
}) {
    const lastPromptMessage = promptMessages[promptMessages.length - 1];

    const linkLabelByUrl = lastPromptMessage
        ? collectLinksFromMarkdownTreeForCursorAgent({
              type: "root",
              children: lastPromptMessage.markdownContent,
          })
        : emptyMap;

    // Remove all links from the conversation history. Cursor cloud agents can't read
    // links so it doesn't make sense to spend tokens on them.
    //
    // Don't remove links from the last message. We'll be loading content from those
    // links and adding it to the prompt.
    stripLinksFromMarkdownTreeForCursorAgent(promptMessagesContent, {
        shouldKeepLink: ({url}) => linkLabelByUrl.has(url),
    });

    const promptAttachmentsContent = await loadCursorCloudAgentPromptAttachmentsContent({
        span,
        temporaryStorage,
        request,
        conversationState,
        linkLabelByUrl,
    });

    await cursorClient.addCloudAgentFollowUp(span, agent.actualId, {
        prompt: {
            text:
                printAgentContentMarkdownTree(promptMessagesContent).trim() +
                // Add any linked content as attachments to the end of the prompt.
                (promptAttachmentsContent.length > 0
                    ? `\n\n${promptAttachmentsContent.join("\n\n")}`
                    : ""),
        },
    });
}

// Since we don't have an OpenAPI schema for Cursor Cloud Agent webhook payloads we
// assume every property from their "Payload format" documentation is optional.
//
// https://cursor.com/docs/cloud-agent/api/webhooks#payload-format
type CursorCloudAgentsWebhookRequestBody = {
    readonly event?: string;
    readonly timestamp?: string;
    readonly id?: string;
    readonly status?: CursorCloudAgentStatus;
    readonly summary?: string;
    readonly target?: {
        readonly url?: string;
        readonly branchName?: string;
        readonly prUrl?: string;
    };
};

/**
 * This handles a webhook from _Cursor_. Not from Alpine! Cursor calls this webhook
 * when the Cloud Agent is done processing.
 */
async function handleCursorCloudAgentsThirdPartyWebhook({
    env,
    apiKey,
    storage,
    request,
    agentId,
    span,
}: {
    env: AgentServiceEnv;
    apiKey: string;
    storage: AgentDurableObjectStorageInterface;
    request: Request;
    agentId: CursorCloudAgentId;
    span: TracerSpan;
}) {
    const cursorWebhookId = request.headers.get("x-webhook-id");
    const cursorWebhookEvent = request.headers.get("x-webhook-event");

    span.addData({
        cursor: {
            cloudAgents: {
                webhook: {
                    id: cursorWebhookId ?? undefined,
                    event: cursorWebhookEvent ?? undefined,
                },
            },
        },
    });

    const bodyText = await request.text();

    // We need a transaction around the `CursorCloudAgentCollection` `get()` + `put()`
    // to make sure there are no race conditions.
    await storage.transaction(async transaction => {
        const oldAgent = await CursorCloudAgentCollection.get(transaction, agentId);
        if (!oldAgent) throw new NotFoundError("Cursor Cloud Agent not found");

        // Make sure the signature is valid.
        await validateCursorCloudAgentsThirdPartyWebhookSignature({
            request,
            webhookSecret: oldAgent.webhookSecret,
            bodyText,
        });

        const body: CursorCloudAgentsWebhookRequestBody = JSON.parse(bodyText);

        // The status didn't change. There's nothing to do.
        if (!body.status || body.status === oldAgent.status) return;

        let newAgent: CursorCloudAgent = {
            ...oldAgent,
            status: body.status,
        };

        // Create an API client using the `accessToken` we stored in the Durable Object's
        // state so we can send a new message to the conversation.
        const apiClient = createApiClient({
            baseUrl: assertExists(
                env.API_SERVICE_URL,
                "Missing `API_SERVICE_URL` environment variable",
            ),
            apiKey,
            accessToken: newAgent.apiAccessToken,
        });

        switch (newAgent.status) {
            // Ignore these status changes.
            case "CREATING":
            case "RUNNING": {
                break;
            }

            case "FINISHED":
            case "ERROR":
            case "EXPIRED": {
                newAgent = await sendCursorCloudAgentsThirdPartyWebhookMessage({
                    apiClient,
                    span,
                    transaction,
                    agentId,
                    agent: newAgent,
                    agentStatus: newAgent.status,
                    body,
                });
                break;
            }

            default: {
                // Make sure we handle all statuses with `cast<never>()` but don't throw (like we
                // would with `exhaustive()`).
                cast<never>(newAgent.status);
                break;
            }
        }

        // Finally, write our updated agent back to the collection.
        // `sendCursorCloudAgentsWebhookMessage()` may have updated the agent as well.
        await CursorCloudAgentCollection.put(transaction, agentId, newAgent);
    });
}

async function validateCursorCloudAgentsThirdPartyWebhookSignature({
    request,
    webhookSecret,
    bodyText,
}: {
    request: Request;
    webhookSecret: string;
    bodyText: string;
}) {
    const actualSignature = request.headers.get("x-webhook-signature");

    // Verify the `X-Webhook-Signature` header to make sure this request is actually
    // coming from Cursor.

    if (!actualSignature) throw new InvalidArgumentError("Missing `X-Webhook-Signature` header");

    const encoder = new TextEncoder();

    const webhookSecretKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(webhookSecret),
        {name: "HMAC", hash: "SHA-256"},
        false,
        ["sign"],
    );

    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        webhookSecretKey,
        encoder.encode(bodyText),
    );

    const expectedSignature = `sha256=${Array.from(new Uint8Array(signatureBuffer), byte =>
        byte.toString(16).padStart(2, "0"),
    ).join("")}`;

    if (actualSignature !== expectedSignature) {
        throw new PermissionDeniedError("Invalid signature");
    }
}

async function sendCursorCloudAgentsThirdPartyWebhookMessage({
    apiClient,
    span,
    transaction,
    agentId,
    agent,
    agentStatus,
    body,
}: {
    apiClient: ApiClient;
    span: TracerSpan;
    transaction: DurableObjectTransactionInterface;
    agentId: CursorCloudAgentId;
    agent: CursorCloudAgent;
    agentStatus: "FINISHED" | "ERROR" | "EXPIRED";
    body: CursorCloudAgentsWebhookRequestBody;
}): Promise<CursorCloudAgent> {
    const elements: Array<ApiContentBlockElement> = [];

    const paragraphElements: Array<ApiContentTextInlineElement> = [];
    elements.push({type: "Paragraph", elements: paragraphElements});

    switch (agentStatus) {
        case "FINISHED": {
            paragraphElements.push({
                type: "Text",
                text: "Finished coding.",
            });
            break;
        }

        case "ERROR":
        // NOTE(calebmer): Cursor doesn't have any documentation for what `EXPIRED` means.
        // So use our generic error message until we figure that out.
        case "EXPIRED": {
            paragraphElements.push({
                type: "Text",
                text: "An unexpected error occurred while coding.",
            });
            break;
        }

        default:
            throw exhaustive(agentStatus);
    }

    if (body.target?.prUrl) {
        paragraphElements.push(
            {type: "Text", text: " I opened a "},
            {
                type: "Text",
                text: "GitHub PR",
                marks: [{type: "Link", url: body.target.prUrl}],
            },
            {type: "Text", text: " where you can review my changes."},
        );
    }

    // NOTE(calebmer): Cursor has a [`GET /v0/agents/{id}/conversation` API
    // endpoint][1] that we could use to show a conversation history. However, it
    // includes messages we consider "thinking" in addition to a final summary message.
    // We'd love to stream the thinking messages in realtime with a `Reasoning` stream
    // part but Cursor doesn't have a convenient API for this and doesn't provide a
    // distinction between thinking parts and non-thinking parts.
    //
    // Example messages for "Can you add a new danger button variant for our shared
    // `<Button>` component that's red?" It has 8 "thinking" messages and 1 final
    // summary message which is more verbose than `summary` from the webhook call.
    //
    // > I'll help you add a new danger button variant for the shared `<Button>`
    // > component. Let me start by finding the Button component.
    // >
    // > Now I'll add the danger button variant. Let me make the changes to add the
    // > "danger" variant with red styling.
    // >
    // > Let me commit and push these changes to the branch.
    // >
    // > Let me verify the implementation by checking if there are any tests I should
    // > run.
    // >
    // > ...
    // >
    // > I successfully added a new "danger" button variant to the shared `<Button>`
    // > component. Here's what I did:
    // >
    // > **Changes made:** ...
    // >
    // > **Testing:** ...
    // >
    // > **Git:** ...
    //
    // Summary from the webhook call (which is what we use here):
    //
    // > A new "danger" variant was added to the shared `<Button>` component in
    // > `client/web/design/button.tsx`.
    // >
    // > - The `ButtonVariant` type was extended to include `"danger"`.
    // > - Styling for the "danger" variant was implemented:
    // >     - Enabled state: `red-60` background with `grey-0` text.
    // >     - Disabled state: `grey-5` background with `grey-30` text.
    // >
    // > This provides a distinct visual style for critical actions, aligning with
    // > existing component patterns.
    //
    // [1] https://cursor.com/docs/cloud-agent/api/endpoints#agent-conversation
    if (body.summary) {
        let summary = body.summary.trim();

        // Make sure `summary` ends with punctuation if punctuation wasn't already added.
        if (!doesStringEndWithPunctuation(summary)) {
            summary += ".";
        }

        // We use `AgentMessageStream` even though there's no streaming so we parse content
        // from LLMs consistently across all our agents.
        const summaryMessageStream = new AgentMessageStream({
            spaceId: agent.spaceId,
            getTargetPathIfExists: async () => null,
        });

        summaryMessageStream.pushText(span, summary);

        for (const {part} of await summaryMessageStream.update(span)) {
            // We only push text so there should be only content parts.
            if (part.payload.type !== "Content") continue;

            for (const element of part.payload.content.elements) {
                elements.push(element);
            }
        }
    }

    // Get the last message index from the agent across all messages it sends.
    let lastAgentMessageIndex = agent.launchMessageIndex;
    for (const messageIndex of concatIterables(
        agent.statusChangeMessageIndexes,
        agent.followUpMessageIndexes,
    )) {
        if (messageIndex > lastAgentMessageIndex) {
            lastAgentMessageIndex = messageIndex;
        }
    }

    // Were there any messages sent after our launch message? If yes then we want to
    // create a new message with our old message as a parent.
    const {
        data: {messages: messagesAfterLastAgentMessage},
    } = await getApiMessagesFromStart(span, apiClient, agent.room, {
        limit: 1,
        cursor: lastAgentMessageIndex,
    });

    const {
        data: {message},
    } = await createApiMessage(span, apiClient, agent.room, {
        // If there are messages after our launch message then reply to the launch message.
        // Otherwise, our message will go right underneath the launch message.
        parent:
            messagesAfterLastAgentMessage.length > 0
                ? {type: "Message", index: agent.launchMessageIndex}
                : undefined,

        // Make sure any quote characters from `body.summary` use proper curly quotes.
        content: convertApiContentToProperQuotes({elements}),

        createdTimeZone: agent.timeZone,
    });

    await CursorCloudAgentReferenceByMessageIndexCollection.put(
        transaction,
        `${printApiMessageRoomPath(agent.room)}:${message.index}`,
        {agentId, kind: "StatusChange"},
    );

    // The object returned here will be saved to `CursorCloudAgentCollection`. In the
    // same transaction. So our `CursorCloudAgentByMessageIndexCollection` call above
    // won't lead to corrupted data.
    return {
        ...agent,
        targetBranchName: body.target?.branchName ?? null,
        targetPrUrl: body.target?.prUrl ?? null,
        statusChangeMessageIndexes: new Set(
            addToIterable(agent.statusChangeMessageIndexes, message.index),
        ),
    };
}
