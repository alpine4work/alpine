import {createRequestHandler} from "@remix-run/node";
import {ServerRoute} from "@remix-run/server-runtime";
import type {RouteMatch} from "@remix-run/server-runtime/dist/routeMatching.js";
import * as build from "virtual:remix/server-build";
import {
    AppServiceProcessContext,
    AppServiceProcessContextModules,
    AppServiceSystemActionContext,
    AppServiceSystemActionContextModules,
} from "~/app/app_service_context.js";
import {AppService, AppServiceConstants} from "~/app/app_service_types.js";
import {authenticateActorContextModule} from "~/app/helpers/authenticate_actor_context_module.js";
import {createAppServerRoutes} from "~/app/router/app_server_routes.js";
import {seedDynamo} from "~/app/seed_dynamo.js";
import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {ApnsContextModule} from "~/server/apns/apns_context_module.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createServiceCloudflareR2ContextModule} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {
    ApnsContextModuleBase,
    TestApnsContextModule,
} from "~/server/context/apns_context_module_base.js";
import {EdgeServiceContextModule} from "~/server/context/edge_service_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    NotificationsInjectionContextModule,
    SearchInjectionContextModule,
    SpacesInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {
    TestWebPushContextModule,
    WebPushContextModule,
} from "~/server/context/web_push_context_module.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module.js";
import {TraceOnlyEmailContextModule} from "~/server/emails/trace_only_email_context_module.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {
    ActorContextModule,
    SystemActorContextModule,
    UnknownActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {createServerBasicProcessContextModules} from "~/server/node/create_server_basic_process_context_modules.js";
import {
    createServiceTokenAgent,
    getServiceTokenAgentKeyFromOption,
} from "~/server/node/create_service_token_agent.js";
import {createStandardizedRequestListener} from "~/server/node/create_standardized_server.js";
import {ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {createServiceOpensearchContextModule} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {LoaderContextModule, LoaderContextModules} from "~/server/remix/loader_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {getSpaceAccountsCacheForTest} from "~/server/spaces/spaces_actions.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {createServiceTaskRealtimeServiceRouter} from "~/server/tasks/data/create_service_task_realtime_service_router.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {SessionCookie, withSessionCookie} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentAppServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {isId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

let appService: {
    constants: AppServiceConstants;
    promise: Promise<AppService>;
} | null = null;

/**
 * Get the app server if it exists and creates the app server if it doesn't
 * already exist. You are expected to pass in the same `constants` object every
 * time this function is called.
 *
 * Our app server is designed this way to work well with Vite hot reloading. If
 * a Vite hot reload happens `AppService` will need to be created again. But it
 * only needs to be created once until the next hot reload.
 */
export function getAppService(constants: AppServiceConstants): Promise<AppService> {
    if (appService !== null) {
        assert(appService.constants === constants);
    } else {
        appService = {
            constants,
            promise: createAppService(constants),
        };
    }

    return appService.promise;
}

async function createAppService({
    tracer,
    shutdownManager,
    options,
}: Replace<AppServiceConstants, {shutdownManager: ShutdownManagerBase}>): Promise<AppService> {
    const [
        tokenAgent,
        apnsCertificate,
        apnsCertificatePrivateKey,
        webPushVapidPublicKey,
        webPushVapidPrivateKey,
        seedDynamoOptions,
    ] = await runAllPromises([
        createServiceTokenAgent({
            serviceName: "AppService",
            privateSide: TokenAgentAppServicePrivateSide,
            options,
        }),
        getServiceTokenAgentKeyFromOption(
            assertExists(options.apnsCertificate, "Missing `apnsCertificate` option"),
        ),
        getServiceTokenAgentKeyFromOption(
            assertExists(
                options.apnsCertificatePrivateKey,
                "Missing `apnsCertificatePrivateKey` option",
            ),
        ),
        getServiceTokenAgentKeyFromOption(
            assertExists(options.webPushVapidPublicKey, "Missing `webPushVapidPublicKey` option"),
        ),
        getServiceTokenAgentKeyFromOption(
            assertExists(options.webPushVapidPrivateKey, "Missing `webPushVapidPrivateKey` option"),
        ),
        process.env.NODE_ENV !== "production" && options.shouldSeedDynamo
            ? (async () => {
                  const agentServiceLocalPort = assertExists(
                      options.agentServiceLocalPort,
                      "Missing `agentServiceLocalPort` option in development",
                  );

                  const chatGptLocalUnscopedApiKey = await getServiceTokenAgentKeyFromOption(
                      assertExists(
                          options.chatGptLocalUnscopedApiKey,
                          "Missing `chatGptLocalUnscopedApiKey` option in development",
                      ),
                  );

                  const chatGptLocalScopedApiKey = await getServiceTokenAgentKeyFromOption(
                      assertExists(
                          options.chatGptLocalScopedApiKey,
                          "Missing `chatGptLocalScopedApiKey` option in development",
                      ),
                  );

                  const mockChatGptLocalUnscopedApiKey = await getServiceTokenAgentKeyFromOption(
                      assertExists(
                          options.mockChatGptLocalUnscopedApiKey,
                          "Missing `mockChatGptLocalUnscopedApiKey` option in development",
                      ),
                  );

                  return {
                      agentServiceLocalPort,
                      chatGptLocalUnscopedApiKey: chatGptLocalUnscopedApiKey.trim(),
                      chatGptLocalScopedApiKey: chatGptLocalScopedApiKey.trim(),
                      mockChatGptLocalUnscopedApiKey: mockChatGptLocalUnscopedApiKey.trim(),
                  };
              })()
            : null,
    ]);

    const awsSigner = new AwsRequestSigner();

    const languageModel =
        process.env.NODE_ENV === "production"
            ? new CohereEmbedEnglishV3LanguageModel({
                  apiKey: assertExists(
                      options.cohereApiKey,
                      "`cohereApiKey` option is required in production",
                  ),
              })
            : await AllMiniLmL6V2LanguageModel.new(
                  assertExists(
                      options.allMiniLmL6V2LanguageModel,
                      "`allMiniLmL6V2LanguageModel` option is required in development",
                  ),
              );

    const basicProcessContext = Context.new(
        createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
    );

    // In tests, don't send push notifications. Otherwise in development and
    // production set up a connection pool to APNs so we can send notifications.
    let apnsContextModule: ApnsContextModuleBase;
    if (process.env.NODE_ENV === "test") {
        apnsContextModule = new TestApnsContextModule();
    } else {
        const apnsConnectionPool = new ApnsConnectionPool(basicProcessContext, {
            certificate: apnsCertificate,
            certificatePrivateKey: apnsCertificatePrivateKey,
        });

        shutdownManager.registerListener(
            "Destroying APNs connection pool",
            async (signal, span) => {
                await apnsConnectionPool.destroy(span);
            },
        );

        apnsContextModule = new ApnsContextModule(apnsConnectionPool);
    }

    // Sometimes we want to upgrade a session actor to a system actor. This gives
    // the action escalated the system permission level which is dangerous! The
    // system permission level has broad access to a space. We should tightly
    // control what code is allowed to call this function, only allowed context
    // modules get access and those context modules are expected to treat this as a
    // private variable.
    //
    // It's important we use new caches + batchers here. We don't want to load some
    // data at a higher permission level then let the session context see it. So we
    // derive our new context from the process context to help avoid reusing any
    // request-level caches.
    const dangerouslyEscalateToSystemContext = <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor?: ActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: AppServiceSystemActionContext) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<
                AppServiceSystemActionContextModules,
                Exclude<keyof AppServiceProcessContextModules, "tracer">
            >,
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: context.cache.forkForChangedActor(),
                batch: context.batch.forkForChangedActor(),
                actor: SystemActorContextModule.dangerouslyNew(
                    // `context.actor` is `undefined` for maintenance jobs. Though we shouldn't be
                    // running maintenance jobs in `AppService`. Handle the case anyway.
                    context.actor?.serviceName ?? "AppService",
                    spaceId,
                ),
            },
            action,
        );
    };

    const edgeServiceUrl = assertExists(
        options.edgeServiceUrl,
        "`edgeServiceUrl` option is required",
    );

    const agentServiceUrl = options.agentServiceUrl ?? null;

    if (process.env.NODE_ENV !== "test") {
        assertExists(agentServiceUrl, "`agentServiceUrl` option is required in production");
    }
    const resourceServiceUrl = assertExists(
        options.resourceServiceUrl,
        "`resourceServiceUrl` option is required",
    );

    const processContext: AppServiceProcessContext = basicProcessContext.clone({
        opensearch: createServiceOpensearchContextModule(awsSigner, options),
        r2: createServiceCloudflareR2ContextModule(options),
        files: new FilesContextModule({tokenAgent, resourceServiceUrl}),
        edge: new EdgeServiceContextModule({tokenAgent, edgeServiceUrl}),
        tasks: new TaskContextModule({
            router: createServiceTaskRealtimeServiceRouter(options),
            tokenAgent,
            dangerouslyEscalateToSystemContext,
        }),
        email:
            process.env.NODE_ENV === "production"
                ? new SesEmailContextModule(tokenAgent)
                : new TraceOnlyEmailContextModule(),
        languageModel: new LanguageModelContextModule(languageModel),
        apns: apnsContextModule,
        webPush:
            process.env.NODE_ENV === "test"
                ? new TestWebPushContextModule()
                : new WebPushContextModule({
                      vapidPublicKey: webPushVapidPublicKey,
                      vapidPrivateKey: webPushVapidPrivateKey,
                  }),
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        notificationsInjection: new NotificationsInjectionContextModule(notificationsInjection),
        searchInjection: new SearchInjectionContextModule(searchInjection),
        spacesInjection: new SpacesInjectionContextModule(spacesInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),
    });

    let hasSeededDynamo = false;

    // In development, Vite handles Remix requests.
    //
    // Note that in development Vite creates a completely separate Node.js runtime
    // environment on the server! This will break a number of JavaScript features
    // you may expect to work:
    //
    // 1. Module scoped caches won't be shared across `app_service_worker.ts` and
    //    Vite.
    // 2. The context object created in `app_service_worker.ts` and passed to Vite
    //    won't work with `instanceof` checks.
    //
    // In production (and integration tests) we have one Node.js runtime for Remix
    // code and our custom `app_service_worker.ts` server so the above features
    // will work.
    const handleRequest = createRequestHandler(
        {...build, routes: createAppServerRoutes(build.routes)},
        process.env.NODE_ENV,
    );

    const requestListener = createStandardizedRequestListener<
        "HealthCheck" | "ClearSpaceAccountsCacheForTest" | Array<RouteMatch<ServerRoute>> | null
    >(
        tracer,
        url => {
            if (url.pathname === "/api/internal/healthcheck") return [url.pathname, "HealthCheck"];

            // Add route when running integration tests...
            if (process.env.NODE_ENV === "test") {
                if (url.pathname === "/api/internal/test/clearSpaceAccountsCache")
                    return [url.pathname, "ClearSpaceAccountsCacheForTest"];
            }

            const matches = handleRequest.matchServerRoutes(url);

            let route = "";

            if (matches === null) {
                route = "/*";
            } else {
                for (const match of matches) {
                    if (match.route.id === "root") continue;
                    if (match.route.path === undefined) continue;
                    route = `${route}/${match.route.path}`;
                }
            }

            return [route, matches];
        },
        (request, url, matches, span) => {
            if (typeof matches === "string") {
                switch (matches) {
                    case "HealthCheck": {
                        return Promise.resolve(
                            new Response("200 OK", {
                                status: 200,
                                headers: {"content-type": "text/plain"},
                            }),
                        );
                    }
                    case "ClearSpaceAccountsCacheForTest": {
                        const spaceAccountsCache = getSpaceAccountsCacheForTest();
                        spaceAccountsCache.clearForTest();

                        return Promise.resolve(
                            new Response("200 OK", {
                                status: 200,
                                headers: {"content-type": "text/plain"},
                            }),
                        );
                    }
                    default:
                        throw exhaustive(matches);
                }
            }

            return withSessionCookie(tokenAgent, request, async sessionCookie => {
                const loaderContextModule = new LoaderContextModule(request, {
                    tokenAgent,
                    sessionCookie,
                    agentServiceUrl,
                    webPushVapidPublicKey,
                });

                const response = await processContext.with<
                    Omit<
                        LoaderContextModules,
                        Exclude<keyof AppServiceProcessContextModules, "tracer">
                    >,
                    globalThis.Response
                >(
                    {
                        tracer: new TracerContextModule(span),
                        rpc: new LocalRpcContextModule(),
                        loader: loaderContextModule,
                        cache: CacheContextModule.new(),
                        batch: BatchContextModule.new(),
                        actor: createActorContextModule(request, url, tokenAgent, sessionCookie),
                    },
                    context => {
                        // The first time our server process runs in development, seed DynamoDB with
                        // some initial data. The seed function should be idempotent.
                        if (
                            process.env.NODE_ENV !== "production" &&
                            options.shouldSeedDynamo &&
                            !hasSeededDynamo
                        ) {
                            const options = assertExists(seedDynamoOptions);

                            hasSeededDynamo = true;
                            processContext.process.waitUntil(
                                processContext.tracer.withSpan(
                                    "Seeding DynamoDB",
                                    async context => {
                                        try {
                                            await seedDynamo(context, options);
                                        } catch (error) {
                                            // If there is an error, log it but don't crash the process.
                                            // eslint-disable-next-line no-console
                                            console.error("Failed to seed DynamoDB data:", error);
                                        }
                                    },
                                ),
                            );
                        }

                        return handleRequest(
                            request,
                            context,
                            // We already parsed route matches. Pass them to Remix...
                            {url, matches},
                        );
                    },
                );

                loaderContextModule.addResponseHeaders(response.headers);

                // Include the route in an HTTP header so our edge service can use the route in
                // its HTTP span name.
                {
                    let route = "";
                    if (matches === null) {
                        route = "/*";
                    } else {
                        for (const match of matches) {
                            if (match.route.id === "root") continue;
                            if (match.route.path === undefined) continue;
                            route = `${route}/${match.route.path}`;
                        }
                    }

                    response.headers.set("cyberworlds-route", route);
                }

                return response;
            });
        },
    );

    return requestListener;
}

function createActorContextModule(
    request: Request,
    url: URL,
    tokenAgent: TokenAgent,
    sessionCookie: SessionCookie,
) {
    // We authenticate lazily. If a route doesn't need authentication this function
    // never gets called. You can also parallelize other network requests with
    // authentication deeper in a route. Once we authenticate it is cached for
    // the route.
    return new UnknownActorContextModule<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>(async context => {
        const authorizationHeader = request.headers.get("authorization");

        const spaceIdStringHint =
            request.headers.get("cyberworlds-space-id-hint") ??
            url.pathname.match(/^\/s\/([a-zA-Z0-9]+)(?:\/|$)/)?.[1];

        const spaceIdHint =
            spaceIdStringHint && isId<SpaceId>(spaceIdStringHint) ? spaceIdStringHint : null;

        return authenticateActorContextModule(context, {
            tokenAgent,
            sessionCookie,
            authorizationHeader,
            spaceIdHint,
        });
    });
}
