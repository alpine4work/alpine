import {ApiClient, createApiClient} from "~/server/agents/api/api_client.js";
import {
    AgentScheduleEventRequest,
    deleteAgentScheduleEvent,
    getAgentScheduleEventsBeforeDate,
    getNextAgentScheduleEvent,
    putAgentScheduleEvent,
} from "~/server/agents/bots/internal/agent_schedule_events_collection.js";
import {AgentServiceEnv} from "~/server/agents/bots/internal/agent_service_env.js";
import {
    AgentUsageDatabase,
    AgentUsageDatabaseInterface,
} from "~/server/agents/bots/internal/d1/agent_usage_database.js";
import {OpenAiClient, OpenAiClientInterface} from "~/server/agents/bots/internal/open_ai_client.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {parseApiBotWebhookEventIntoMessageRoom} from "~/shared/api/specification/parse_api_path.js";
import {
    ApiBotWebhookEvent,
    ApiBotWebhookRequestBody,
    ApiMessageRoomTarget,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError, InternalError} from "~/shared/error/error.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type AgentContext = Context<AgentContextModules>;

export type AgentContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
};

export type AgentWebhookRequest = {
    readonly storage: DurableObjectStorage;
    readonly apiClient: ApiClient;
    readonly apiAccessToken: string;
    readonly openAiClient: Lazy<OpenAiClientInterface>;
    readonly agentUsageDatabase: Lazy<AgentUsageDatabaseInterface>;
    readonly origin: string;
    readonly spaceId: SpaceId;
    readonly botId: BotId;
    readonly botAccountId: AccountId;
    readonly event: ApiBotWebhookEvent;
    readonly room: ApiMessageRoomTarget;
};

export type ConversationStateRequest = {
    readonly storage: DurableObjectStorage;
};

/**
 * Storage interface exposed to agent subclasses. Excludes `setAlarm` to ensure
 * alarm scheduling is controlled only by the base class.
 */
export type AgentDurableObjectStorageInterface = Omit<DurableObjectStorage, "setAlarm">;

type AgentProcessWebhookScheduleEventRequest = AgentScheduleEventRequest & {
    readonly type: "ProcessWebhook";
    readonly origin: string;
    readonly payload: ApiBotWebhookRequestBody;
};

/**
 * Base class for agent Cloudflare Durable Objects. Sets up some basic
 * infrastructure like the tracer and process context module.
 */
export abstract class AgentDurableObjectBase<
    Route,
    ScheduleEventRequest extends AgentScheduleEventRequest,
> {
    protected readonly _state: DurableObjectState;
    protected readonly _env: AgentServiceEnv;
    private readonly _tracer: Lazy<TracerRoot>;
    private readonly _processContext: Lazy<AgentContext>;
    private readonly _openAiClient: Lazy<OpenAiClient>;
    private readonly _agentUsageDatabase: Lazy<AgentUsageDatabase>;

    private readonly _scheduledEventsMutex = new Mutex();

    constructor(serviceName: TracerServiceName, state: DurableObjectState, env: AgentServiceEnv) {
        this._state = state;
        this._env = env;

        this._tracer = new Lazy(() => {
            // TODO(ifitzsimmons, #local-kinesis): This will eventually be required. For now,
            // there is no local Kinesis stream so we don't need to pass in a stream name.
            const streamName = env.KINESIS_TRACER_STREAM_NAME;
            if (!streamName && process.env.NODE_ENV === "production")
                throw new InternalError("Must provide `KINESIS_TRACER_STREAM_NAME` in production");

            return createServerTracer({
                serviceName,
                jsHost: "CloudflareWorker",
                honeycombApiKey: env.HONEYCOMB_API_KEY,
                honeycombDataset: "tracer",
                waitUntil: promise => state.waitUntil(promise),
                kinesisTracerStreamOptions: streamName
                    ? {
                          streamName,
                          awsSigner: new AwsRequestSigner({
                              accessKeyId: assertExists(
                                  env.KINESIS_AWS_ACCESS_KEY_ID,
                                  "`KINESIS_AWS_ACCESS_KEY_ID` is required",
                              ),
                              secretAccessKey: assertExists(
                                  env.KINESIS_AWS_SECRET_ACCESS_KEY,
                                  "`KINESIS_AWS_SECRET_ACCESS_KEY` is required",
                              ),
                          }),
                      }
                    : undefined,
            });
        });

        this._processContext = new Lazy(() =>
            Context.new({
                process: new ProcessContextModule({
                    waitUntil: promise =>
                        this._state.waitUntil(
                            promise.catch(error => {
                                this._tracer
                                    .get()
                                    .logException("Uncaught exception from `waitUntil()`", error);
                            }),
                        ),
                }),
                tracer: new TracerContextModule(this._tracer.get()),
            }),
        );

        this._openAiClient = new Lazy(() => {
            return new OpenAiClient({
                apiKey: assertExists(
                    this._env.OPEN_AI_API_KEY,
                    "Missing `OPEN_AI_API_KEY` environment variable",
                ),
            });
        });

        this._agentUsageDatabase = new Lazy(() => {
            return new AgentUsageDatabase(this._env.AgentUsageDatabase);
        });
    }

    protected abstract _getApiKey(): string;

    /**
     * Parse the route from a URL. We include the route in the tracer span for this
     * request which helps since we can search our logs for all requests to a certain
     * route.
     */
    protected abstract _parseRoute(url: URL): [string, Route];

    /**
     * Execute an HTTP request against the Durable Object.
     */
    protected abstract _fetch(
        context: AgentContext,
        request: Request,
        route: Route,
        span: TracerSpan,
    ): Promise<Response>;

    /**
     * Handle an HTTP webhook call from Alpine.
     */
    public abstract webhook(tracer: TracerBase, request: AgentWebhookRequest): Promise<void>;

    /**
     * Handle an event scheduled by this Durable Object.
     */
    protected abstract _event(tracer: TracerBase, event: ScheduleEventRequest): Promise<void>;

    public async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        const [route, routeObject]: [string, Route | "Webhook"] =
            url.pathname === "/webhook" ? ["/webhook", "Webhook"] : this._parseRoute(url);

        return traceServerResponse(
            this._tracer.get(),
            request,
            url,
            route,
            async (span, request) => {
                try {
                    const response = await this._processContext.get().with<{}, Response>(
                        {
                            // Replace the tracer context module with one that uses our span for this request.
                            tracer: new TracerContextModule(span),
                        },
                        async actionContext => {
                            if (routeObject === "Webhook") {
                                return this._fetchWebhook(actionContext, request, url, span);
                            } else {
                                return this._fetch(actionContext, request, routeObject, span);
                            }
                        },
                    );
                    return response;
                } catch (error) {
                    span.addException(error);
                    return createSimpleErrorResponse(error);
                }
            },
        );
    }

    private async _fetchWebhook(
        context: AgentContext,
        request: Request,
        url: URL,
        span: TracerSpan,
    ): Promise<Response> {
        if (request.method !== "POST") {
            return new Response("405 Method Not Allowed", {
                status: 405,
                headers: {"content-type": "text/plain"},
            });
        }

        const requestBody: ApiBotWebhookRequestBody = await request.json();

        // TODO(ifitzsimmons): If this works, we'll probably want to execute the following
        // logic before scheduling the event:
        //
        // 1. Determine whether the agent needs to respond
        // 2. If yes, create the message stream message and send its index with the event
        //    payload.
        await this._actuallySchedule(context, {
            type: "ProcessWebhook",
            // Schedule the event for immediate execution.
            date: new Date(),
            origin: url.origin,
            payload: requestBody,
            tracerPropagationContext: span.getPropagationContext(),
        });

        return new Response(null, {status: 200});
    }

    /**
     * Schedule an event to be executed at a future date. Uses `alarm()` under the hood
     * to execute the event.
     */
    protected async _schedule(context: AgentContext, event: ScheduleEventRequest): Promise<void> {
        await this._actuallySchedule(context, event);
    }

    private async _actuallySchedule(
        context: AgentContext,
        event: ScheduleEventRequest | AgentProcessWebhookScheduleEventRequest,
    ): Promise<void> {
        await context.tracer
            .getTracer()
            .withSpan(quote`Scheduling event ${event.type}`, async () => {
                await putAgentScheduleEvent(this._state.storage, event);
                await this._scheduleNextAlarm();
            });
    }

    private async _processScheduledWebhookEvent(
        parentSpan: TracerSpan,
        {origin, payload}: AgentProcessWebhookScheduleEventRequest,
    ) {
        await parentSpan.withSpan("Process agent webhook", async span => {
            const {accessToken, spaceId, botId, botAccountId, event} = payload;

            try {
                const request: AgentWebhookRequest = {
                    storage: this._state.storage,
                    origin,
                    spaceId,
                    botId,
                    botAccountId,
                    event,
                    room: parseApiBotWebhookEventIntoMessageRoom(event),
                    apiClient: createApiClient({
                        baseUrl: assertExists(
                            this._env.API_SERVICE_URL,
                            "Missing `API_SERVICE_URL` environment variable",
                        ),
                        apiKey: this._getApiKey(),
                        accessToken,
                    }),
                    apiAccessToken: accessToken,
                    openAiClient: this._openAiClient,
                    agentUsageDatabase: this._agentUsageDatabase,
                };

                await this.webhook(span, request);
            } catch (error) {
                // Log errors in development since webhook errors aren't shown to the user in the
                // UI. So we need to show webhook errors in our logs.
                if (process.env.NODE_ENV !== "production") {
                    // eslint-disable-next-line no-console
                    console.error("Agent webhook failed:", error);
                }

                span.addException(error);
            }
        });
    }

    /**
     * Alarm has run! Get all scheduled events before `time = now` and execute them.
     *
     * If `alarm()` were to throw an uncaught error, it'll retry the process up to 6
     * times with exponential backoff [1]. We don't want to retry the entire process
     * because that would cause us to process a message multiple times. If the alarm
     * process fails due to any of the following, we'll emit a DataLossError.
     *
     * 1. We fail to delete the scheduled event from storage. If this fails, the event
     *    will be retried indefinitely (or until the Durable Object is deleted / has
     *    its state cleared).
     * 2. We fail to schedule the next alarm. If this fails the "event loop" will die
     *    (until a new request is made to the Durable Object).
     */
    public async alarm() {
        // Acquire a lock as we remove the events scheduled for execution in this alarm
        // cycle. This prevents concurrent alarm cycles from processing the same events.
        //
        // This also prevents us from scheduling the next alarm while we "dequeue" the
        // events scheduled for execution right now. So let's say we have events [T1, T2,
        // T3] scheduled for execution in this alarm cycle. If we call
        // `_scheduleNextAlarm()` _before_ we remove these events from storage, it will
        // schedule a new alarm at time T1. This adds an extra, unnecessary alarm cycle.
        const scheduledEvents = await this._scheduledEventsMutex.withLock(async () => {
            const scheduleEvents = await getAgentScheduleEventsBeforeDate(
                this._state.storage,
                new Date(),
            );

            await runAllPromises(
                scheduleEvents.map(event =>
                    deleteAgentScheduleEvent(this._state.storage, event.id),
                ),
            );

            return scheduleEvents;
        });

        try {
            for (const scheduledEvent of scheduledEvents) {
                const withSpan = async <T>(
                    callback: (span: TracerSpan) => Promise<T>,
                ): Promise<T> => {
                    if (scheduledEvent.tracerPropagationContext) {
                        return this._tracer
                            .get()
                            .withSpanFromPropagationContext(
                                quote`Executing scheduled event ${scheduledEvent.type}`,
                                scheduledEvent.tracerPropagationContext,
                                callback,
                            );
                    } else {
                        return this._tracer
                            .get()
                            .withSpan(
                                quote`Executing scheduled event ${scheduledEvent.type}`,
                                callback,
                            );
                    }
                };

                await withSpan(async span => {
                    try {
                        const currentTime = new Date();

                        span.addData({
                            agents: {
                                schedule: {
                                    event: {
                                        type: scheduledEvent.type,
                                        time: serializeDateString(scheduledEvent.date),
                                        executionTime: serializeDateString(currentTime),
                                        queueDurationMs:
                                            currentTime.getTime() - scheduledEvent.date.getTime(),
                                    },
                                },
                            },
                        });

                        // The Durable Object only allows scheduling `ProcessWebhook` events and events of
                        // the type `ScheduleEventRequest`.
                        if (scheduledEvent.type === "ProcessWebhook") {
                            const actualScheduledEvent =
                                scheduledEvent as any as AgentProcessWebhookScheduleEventRequest;

                            await this._processScheduledWebhookEvent(span, actualScheduledEvent);
                        } else {
                            await this._event(span, scheduledEvent as any as ScheduleEventRequest);
                        }
                    } catch (error) {
                        // Log errors in development since webhook errors aren't shown to the user in the
                        // UI. So we need to show webhook errors in our logs.
                        if (process.env.NODE_ENV !== "production") {
                            // eslint-disable-next-line no-console
                            console.error(
                                quote`Agent scheduled event ${scheduledEvent.type} failed:`,
                                error,
                            );
                        }

                        span.addException(error);
                    }
                });
            }

            await this._scheduleNextAlarm();
        } catch (error) {
            // Log errors in development since event scheduling errors aren't shown to the user
            // in the UI. So we need to show event scheduling errors in our logs.
            if (process.env.NODE_ENV !== "production") {
                // eslint-disable-next-line no-console
                console.error("Agent scheduled event failed:", error);
            }

            this._tracer
                .get()
                .getRoot()
                .logException(
                    "Agent scheduled event failed",
                    new DataLossError("Failed to execute scheduled events", {cause: error}),
                );
        }
    }

    protected async _scheduleNextAlarm() {
        // Don't schedule the next alarm while we are "dequeing" scheduled events.
        await this._scheduledEventsMutex.withLock(async () => {
            const nextEvent = await getNextAgentScheduleEvent(this._state.storage);

            if (!nextEvent) return;

            await this._state.storage.setAlarm(nextEvent.date);
        });
    }
}
