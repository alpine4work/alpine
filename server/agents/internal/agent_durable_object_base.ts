import {addHours, subHours} from "date-fns";
import {ApiClient, createApiClient} from "~/server/agents/api/api_client.js";
import {
    AgentDurableObjectScheduleEvent,
    AgentDurableObjectScheduleEventRequest,
    deleteAgentDurableObjectScheduleEvent,
    getAgentDurableObjectScheduleEvents,
    getAgentDurableObjectScheduleEventsBeforeDate,
    getNextAgentDurableObjectScheduleEvent,
    putAgentDurableObjectScheduleEvent,
} from "~/server/agents/internal/agent_durable_object_schedule_events_collection.js";
import {AgentServiceEnv} from "~/server/agents/internal/agent_service_env.js";
import {OpenAiClient} from "~/server/agents/internal/open_ai_client.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {ApiMessageRoomPathObject, parseApiMessageRoomPath} from "~/shared/api/parse_api_path.js";
import {
    ApiBotWebhookEvent,
    ApiBotWebhookRequestBody,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError} from "~/shared/error/error.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
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
    readonly openAiClient: Lazy<OpenAiClient>;
    readonly spaceId: SpaceId;
    readonly accountId: AccountId;
    readonly event: ApiBotWebhookEvent;
    readonly room: ApiMessageRoomPathObject;
};

export type ConversationStateRequest = {
    readonly storage: DurableObjectStorage;
};

/**
 * Storage interface exposed to agent subclasses. Excludes `setAlarm` to ensure
 * alarm scheduling is controlled only by the base class.
 */
export type AgentDurableObjectStorageInterface = Omit<DurableObjectStorage, "setAlarm">;

/**
 * Delete the agent's storage after 6 hours of inactivity. So the agent resets
 * overnight.
 */
export const agentDeleteAllStorageAlarmHours = 6;

/**
 * Reset the agent's alarm every day there's some activity.
 */
export function shouldResetAgentDeleteAllStorageAlarm({
    currentTime,
    alarmTime,
}: {
    currentTime: Date;
    alarmTime: Date;
}) {
    return currentTime > subHours(alarmTime, agentDeleteAllStorageAlarmHours - 1);
}

/**
 * Base class for agent Cloudflare Durable Objects. Sets up some basic
 * infrastructure like the tracer and process context module.
 */
export abstract class AgentDurableObjectBase<Route> {
    private readonly _state: DurableObjectState;
    protected readonly _env: AgentServiceEnv;
    private readonly _tracer: Lazy<TracerRoot>;
    private readonly _processContext: Lazy<AgentContext>;
    private readonly _openAiClient: Lazy<OpenAiClient>;

    private readonly _alarmTimeMutex: MutexValue<
        (AgentDurableObjectScheduleEvent & {type: "ClearStorage"}) | null
    > = new MutexValue(null);

    constructor(serviceName: TracerServiceName, state: DurableObjectState, env: AgentServiceEnv) {
        this._state = state;
        this._env = env;

        this._tracer = new Lazy(() =>
            createServerTracer({
                serviceName,
                jsHost: "CloudflareWorker",
                honeycombApiKey: env.HONEYCOMB_API_KEY,
                waitUntil: promise => state.waitUntil(promise),
            }),
        );

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
    }

    public getStorage(): AgentDurableObjectStorageInterface {
        return this._state.storage;
    }

    /**
     * Parse the route from a URL. We include the route in the tracer span for this
     * request which helps since we can search our logs for all requests to a
     * certain route.
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
    protected abstract _webhook(tracer: TracerBase, request: AgentWebhookRequest): Promise<void>;

    public async fetch(request: Request): Promise<Response> {
        // When the Durable Object's alarm is triggered, we delete all storage
        // associated with the Durable Object.
        await this._maybeResetDurableObjectTimeToLive();

        const url = new URL(request.url);

        const [route, routeObject] = this._parseRoute(url);

        return traceServerResponse(
            this._tracer.get(),
            request,
            url,
            route,
            async (span, request) => {
                try {
                    const response = await this._processContext.get().with<{}, Response>(
                        {
                            // Replace the tracer context module with one that uses our span for
                            // this request.
                            tracer: new TracerContextModule(span),
                        },
                        async actionContext => {
                            if (routeObject === "Webhook") {
                                return this._fetchWebhook(actionContext, request, span);
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
        span: TracerSpan,
    ): Promise<Response> {
        if (request.method !== "POST") {
            return new Response("405 Method Not Allowed", {
                status: 405,
                headers: {"content-type": "text/plain"},
            });
        }

        const requestBody: ApiBotWebhookRequestBody = await request.json();

        // TODO(ifitzsimmons): If this works, we'll probably want to execute the
        // following logic before scheduling the event:
        // 1. Determine whether the agent needs to respond
        // 2. If yes, create the message stream message and send its index
        //    with the event payload.
        await this.schedule(context, {
            type: "ProcessWebhook",
            // Schedule the event for immediate execution.
            date: new Date(),
            payload: requestBody,
            tracerPropagationContext: span.getPropagationContext(),
        });

        return new Response(null, {status: 200});
    }

    /**
     * Schedule an event to be executed at a future date. Uses `alarm()` under the hood
     * to execute the event.
     */
    public async schedule(
        context: AgentContext,
        event: AgentDurableObjectScheduleEventRequest,
    ): Promise<void> {
        await context.tracer
            .getTracer()
            .withSpan(quote`Scheduling event ${event.type}`, async () => {
                await putAgentDurableObjectScheduleEvent(this._state.storage, event);
                await this._scheduleNextAlarm();
            });
    }

    private async _processScheduledWebhookEvent(
        parentSpan: TracerSpan,
        payload: ApiBotWebhookRequestBody,
    ) {
        await parentSpan.withSpan("Process agent webhook", async span => {
            const {accessToken, spaceId, accountId, event} = payload;

            try {
                const context: AgentWebhookRequest = {
                    storage: this._state.storage,
                    spaceId,
                    accountId,
                    event,
                    room: parseApiMessageRoomPath(event.roomPath),
                    apiClient: createApiClient({
                        baseUrl: assertExists(
                            this._env.API_SERVICE_URL,
                            "Missing `API_SERVICE_URL` environment variable",
                        ),
                        apiKey: assertExists(
                            this._env.CHAT_GPT_API_SERVICE_KEY,
                            "Missing `CHAT_GPT_API_SERVICE_KEY` environment variable",
                        ),
                        accessToken,
                    }),
                    openAiClient: this._openAiClient,
                };

                await this._webhook(span, context);
            } catch (error) {
                // Log errors in development since webhook errors aren't shown to the user in
                // the UI. So we need to show webhook errors in our logs.
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
     * If `alarm()` were to throw an uncaught error, it'll retry the process up to
     * 6 times with exponential backoff [1]. We don't want to retry the entire process
     * because that would cause us to process a message multiple times. If the alarm process
     * fails due to any of the following, we'll emit a DataLossError.
     *
     * 1. We fail to delete the scheduled event from storage. If this fails, the event will
     *    be retried indefinitely (or until the Durable Object is deleted / has its state
     *    cleared).
     * 2. We fail to schedule the next alarm. If this fails the "event loop" will die (until
     *    a new request is made to the Durable Object).
     */
    public async alarm() {
        try {
            const scheduledEvents = await getAgentDurableObjectScheduleEventsBeforeDate(
                this._state.storage,
                new Date(),
            );

            let clearStorageEvent:
                | (AgentDurableObjectScheduleEvent & {type: "ClearStorage"})
                | undefined;

            for (const scheduledEvent of scheduledEvents) {
                if (scheduledEvent.type === "ClearStorage") {
                    // Execute all other events before clearing storage. There should only ever
                    // be one `ClearStorage` event, but even if there are multiple, we will only
                    // execute the first one.
                    clearStorageEvent ??= scheduledEvent;
                    continue;
                }

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

                await runAllPromises([
                    deleteAgentDurableObjectScheduleEvent(this._state.storage, scheduledEvent.id),
                    withSpan(async span => {
                        try {
                            // TODO(ifitzsimmons): If this approach works, we should log some span data
                            // here that explains how early or late the event began executing based on
                            // time now and the event's scheduled `date`.

                            switch (scheduledEvent.type) {
                                case "ProcessWebhook":
                                    return this._processScheduledWebhookEvent(
                                        span,
                                        scheduledEvent.payload,
                                    );
                                default:
                                    throw exhaustive(scheduledEvent);
                            }
                        } catch (error) {
                            // Log errors in development since webhook errors aren't shown to the user in
                            // the UI. So we need to show webhook errors in our logs.
                            if (process.env.NODE_ENV !== "production") {
                                // eslint-disable-next-line no-console
                                console.error(
                                    quote`Agent scheduled event ${scheduledEvent.type} failed:`,
                                    error,
                                );
                            }

                            span.addException(error);
                        }
                    }),
                ]);
            }

            if (clearStorageEvent) {
                // NOTE(ifitzsimmons): There's a race condition where we receive a request as the
                // `ClearStorage` event is running, in which case the message will not be responded
                // to.
                //
                // If this becomes a problem later, I think we could check to see if there are any
                // scheduled events left and, if there are, ignore this `ClearStorage` event and
                // schedule a new one for after the last event. That could potentially extend the
                // durable object's lifespan indefinitely, so I don't think we should do that
                // without a good reason.
                //
                // Until then, I think it's fair to assume that any event you schedule is at the
                // mercy of the durable object's state.
                await this._state.storage.deleteAll();
            }

            await this._scheduleNextAlarm();
        } catch (error) {
            // Log errors in development since event scheduling errors aren't shown to the user in
            // the UI. So we need to show event scheduling errors in our logs.
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

    /**
     * We maintain an alarm that'll run a 6 hours from now that deletes all storage
     * associated with the Durable Object. This function checks if the alarm will
     * run soon and if so resets the alarm to a point later in the future.
     */
    private async _maybeResetDurableObjectTimeToLive() {
        const currentTime = new Date();

        await this._alarmTimeMutex.withLock(async alarmTimeRef => {
            // If no alarm time is set, read the alarm time from storage. If there's no
            // alarm time in storage then set an alarm to cleanup the durable object.
            if (alarmTimeRef.current === null) {
                const scheduleEvents = await getAgentDurableObjectScheduleEvents(
                    this._state.storage,
                );
                const clearStorageEvent = scheduleEvents.find(
                    event => event.type === "ClearStorage",
                );

                if (clearStorageEvent) {
                    alarmTimeRef.current = clearStorageEvent;
                } else {
                    alarmTimeRef.current = await putAgentDurableObjectScheduleEvent(
                        this._state.storage,
                        {
                            type: "ClearStorage",
                            date: addHours(currentTime, agentDeleteAllStorageAlarmHours),
                        },
                    );
                }
            }

            assert(alarmTimeRef.current);
            if (
                shouldResetAgentDeleteAllStorageAlarm({
                    currentTime,
                    alarmTime: alarmTimeRef.current.date,
                })
            ) {
                const [newClearStorageEvent] = await runAllPromises([
                    putAgentDurableObjectScheduleEvent(this._state.storage, {
                        type: "ClearStorage",
                        date: addHours(currentTime, agentDeleteAllStorageAlarmHours),
                    }),
                    deleteAgentDurableObjectScheduleEvent(
                        this._state.storage,
                        alarmTimeRef.current.id,
                    ),
                ]);

                alarmTimeRef.current = newClearStorageEvent;
            }
        });
    }

    private async _scheduleNextAlarm() {
        const nextEvent = await getNextAgentDurableObjectScheduleEvent(this._state.storage);

        if (!nextEvent) return;

        await this._state.storage.setAlarm(nextEvent.date);
    }
}
