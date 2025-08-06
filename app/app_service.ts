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
import {authenticateDynamoActorContextModule} from "~/app/helpers/authenticate_dynamo_actor_context_module.js";
import {createAppServerRoutes} from "~/app/router/app_server_routes.js";
import {seedDynamo} from "~/app/seed_dynamo.js";
import {
    DynamoActorContextModule,
    DynamoSystemActorContextModule,
    DynamoUnknownActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {
    ApnsContextModule,
    ApnsContextModuleBase,
    TestApnsContextModule,
} from "~/server/apns/apns_context_module.js";
import {createServiceCloudflareR2ContextModule} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {ContentContextModule} from "~/server/content/context_module/content_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {createServerProcessContext} from "~/server/node/create_server_process_context.js";
import {
    createServiceTokenAgent,
    getServiceTokenAgentKeyFromOption,
} from "~/server/node/create_service_token_agent.js";
import {createStandardizedRequestListener} from "~/server/node/create_standardized_server.js";
import {ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {createServiceOpensearchContextModule} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {LoaderContextModule, LoaderContextModules} from "~/server/remix/loader_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {getSpaceAccountsCacheForTest} from "~/server/spaces/spaces_table.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {TaskRealtimeServiceEcsRouter} from "~/server/tasks/data/task_realtime_service_ecs_router.js";
import {TaskRealtimeServiceLocalRouter} from "~/server/tasks/data/task_realtime_service_local_router.js";
import {EdgeServiceContextModule} from "~/server/tokens/edge_service_context_module.js";
import {SessionCookie, withSessionCookie} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentAppServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
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
    const [tokenAgent, apnsCertificate, apnsCertificatePrivateKey] = await runAllPromises([
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

    const baseProcessContext = createServerProcessContext({
        tracer,
        shutdownManager,
        awsSigner,
        options,
    });

    const opensearchContextModule = createServiceOpensearchContextModule(awsSigner, options);

    // Create the router object here so we cache `TaskRealtimeService` routes
    // across the entire process.
    const taskRealtimeServiceRouter =
        process.env.NODE_ENV === "production"
            ? new TaskRealtimeServiceEcsRouter({
                  region: "us-east-1",
                  ecsCluster: assertExists(
                      options.ecsCluster,
                      "`ecsCluster` option is required in production",
                  ),
                  ecsTaskDefinitionFamily: assertExists(
                      options.taskRealtimeServiceEcsTaskDefinitionFamily,
                      "`taskRealtimeServiceEcsTaskDefinitionFamily` option is required in production",
                  ),
                  securityGroupId: assertExists(
                      options.taskRealtimeServiceSecurityGroupId,
                      "`taskRealtimeServiceSecurityGroupId` option is required in production",
                  ),
              })
            : new TaskRealtimeServiceLocalRouter({
                  port: parseInt(
                      assertExists(
                          options.taskRealtimeServiceLocalPort,
                          "Task realtime service local port must be provided when running locally",
                      ),
                      10,
                  ),
              });

    // In tests, don't send push notifications. Otherwise in development and
    // production set up a connection pool to APNs so we can send notifications.
    let apnsContextModule: ApnsContextModuleBase;
    if (process.env.NODE_ENV === "test") {
        apnsContextModule = new TestApnsContextModule();
    } else {
        const apnsConnectionPool = new ApnsConnectionPool(baseProcessContext, {
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

    const processContext: AppServiceProcessContext = baseProcessContext.clone({
        email:
            process.env.NODE_ENV === "production"
                ? new SesEmailContextModule()
                : new NoopEmailContextModule(),
        edge: new EdgeServiceContextModule({
            edgeServiceUrl: assertExists(
                options.edgeServiceUrl,
                "`edgeServiceUrl` option is required",
            ),
            tokenAgent,
        }),
        opensearch: opensearchContextModule,
        languageModel: new LanguageModelContextModule(languageModel),
        apns: apnsContextModule,
        files: new FilesContextModule(tokenAgent),
        r2: createServiceCloudflareR2ContextModule(options),
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
                        actor: DynamoActorContextModule;
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
                            actor: DynamoSystemActorContextModule.dangerouslyNew(
                                context.actor.serviceName,
                                spaceId,
                            ),
                        },
                        action,
                    );
                };

                const loaderContextModule = new LoaderContextModule(request, {
                    tokenAgent,
                    sessionCookie,
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
                        content: new ContentContextModule(),
                        tasks: new TaskContextModule({
                            router: taskRealtimeServiceRouter,
                            tokenAgent,
                            dangerouslyEscalateToSystemContext,
                        }),
                    },
                    context => {
                        // The first time our server process runs in development, seed DynamoDB with
                        // some initial data. The seed function should be idempotent.
                        if (
                            process.env.NODE_ENV !== "production" &&
                            options.shouldSeedDynamo &&
                            !hasSeededDynamo
                        ) {
                            hasSeededDynamo = true;
                            processContext.process.waitUntil(
                                processContext.tracer.withSpan(
                                    "Seeding DynamoDB",
                                    async context => {
                                        try {
                                            await seedDynamo(context);
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
    return new DynamoUnknownActorContextModule(async context => {
        const authorizationHeader = request.headers.get("authorization");

        const spaceIdStringHint =
            request.headers.get("cyberworlds-space-id-hint") ??
            url.pathname.match(/^\/s\/([a-zA-Z0-9]+)(?:\/|$)/)?.[1];

        const spaceIdHint =
            spaceIdStringHint && isId<SpaceId>(spaceIdStringHint) ? spaceIdStringHint : null;

        return authenticateDynamoActorContextModule(context, {
            tokenAgent,
            sessionCookie,
            authorizationHeader,
            spaceIdHint,
        });
    });
}
