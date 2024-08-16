import * as build from "@remix-run/dev/server-build";
import {createRequestHandler} from "@remix-run/node";
import {ServerRoute} from "@remix-run/server-runtime";
import type {RouteMatch} from "@remix-run/server-runtime/dist/routeMatching.js";
import {createServer} from "http";
import {join as joinPath} from "path";
import createServeStaticMiddleware from "serve-static";
import {seedDynamo} from "~/app/seed_dynamo.js";
import {appStaticManifestPaths} from "~/app/static/_manifest/app_static_manifest_paths.js";
import {Session} from "~/server/accounts/accounts_table.js";
import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
    DynamoUnknownActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {
    ApnsContextModule,
    ApnsContextModuleBase,
    TestApnsContextModule,
} from "~/server/apns/apns_context_module.js";
import {
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {
    createServiceTokenAgent,
    getServiceTokenAgentKeyFromOption,
    serviceTokenAgentParseOptions,
} from "~/server/node/create_service_token_agent.js";
import {createStandardizedRequestListener} from "~/server/node/create_standardized_server.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {runService} from "~/server/node/run_service.js";
import {LoaderContextModule, LoaderContextModules} from "~/server/remix/loader_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {
    getSpaceAccountsCacheForTest,
    isAccountMemberOfSpaceWithoutAuthorization,
} from "~/server/spaces/spaces_table.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {TaskRealtimeServiceEcsRouter} from "~/server/tasks/data/task_realtime_service_ecs_router.js";
import {TaskRealtimeServiceLocalRouter} from "~/server/tasks/data/task_realtime_service_local_router.js";
import {SessionCookie, withSessionCookie} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {AppServiceTokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

const staticPath = joinPath(runfilesPath, "cyberworlds/app/static");
const staticBuildPath = joinPath(staticPath, "build");
const staticFontsPath = joinPath(staticPath, "fonts");

// Serve static assets from our `static` directory. These assets will be cached
// by Cloudflare which sits in front of our Node.js HTTP server.
//
// TODO(calebmer): Verify Cloudflare is actually caching these assets in
// production.
//
// TODO(calebmer): We should keep around historical assets for the last N
// server versions so that if an old client tries to load an asset we don't
// fail. (We should only delete assets when no clients can reach it.)
// Cloudflare may do some of this for us automatically but it still may try to
// reload an asset from our web server and get a 404. We want assets to live
// forever. Arguably, because of this, static assets shouldn't be served from
// our app service. Maybe instead we upload static assets to Cloudflare storage
// and our edge service serves them?
const serveStaticMiddleware =
    process.env.NODE_ENV !== "production"
        ? createServeStaticMiddleware(joinPath(runfilesPath, "cyberworlds/app/static"), {
              setHeaders: (res, path) => {
                  // Remix fingerprints its assets so we can cache them forever. Other assets
                  // (like `favicon.ico`) are cached for a day then can be updated.
                  //
                  // We manually version our font assets so fonts can be cached forever too. If
                  // we need to update a font the file name will change.
                  if (path.startsWith(staticBuildPath) || path.startsWith(staticFontsPath)) {
                      // - `public`: Means we can store the asset in a shared cache since they don't
                      //   depend on authorization.
                      // - `max-age=31536000`: The asset lives for one year.
                      // - `immutable`: Indicates the response will never update.
                      res.setHeader("cache-control", "public, max-age=31536000, immutable");
                  } else {
                      // - `public`: Means we can store the asset in a shared cache since they don't
                      //   depend on authorization.
                      // - `max-age=86400`: The asset lives for one day.
                      // - `stale-while-revalidate=31536000`: When the asset is stale, the cache is
                      //   allowed to continue using it for a year as long as the cache revalidates
                      //   the asset in the background.
                      res.setHeader(
                          "cache-control",
                          "public, max-age=86400, stale-while-revalidate=31536000",
                      );
                  }
              },
          })
        : null;

runService({
    serviceName: "AppService",
    options: {
        port: {type: "string"},
        remixDevServerPort: {type: "string"},
        taskRealtimeServiceLocalPort: {type: "string"},
        shouldSeedDynamo: {type: "boolean"},
        ecsCluster: {type: "string"},
        taskRealtimeServiceEcsTaskDefinitionFamily: {type: "string"},
        allMiniLmL6V2LanguageModel: {type: "string"},
        cohereApiKey: {type: "string"},
        apnsCertificate: {type: "string"},
        apnsCertificatePrivateKey: {type: "string"},
        ...serviceTokenAgentParseOptions,
        ...serverProcessContextParseOptions,
    },
    run: async ({options, tracer, shutdownManager}) => {
        const port = options.port ? parseInt(options.port, 10) : null;
        if (!port || !Number.isInteger(port)) throw new InternalError("Missing integer `port` arg");

        const [tokenAgent, apnsCertificate, apnsCertificatePrivateKey] = await runAllPromises([
            createServiceTokenAgent({
                serviceName: "AppService",
                privateSide: AppServiceTokenAgentPrivateSide,
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

        const processContext = createServerProcessContext({
            tracer,
            tokenAgent,
            awsSigner,
            options,
        });

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
        if (process.env.NODE_ENV === "test" || process.env.PLAYWRIGHT_TEST_PATH) {
            apnsContextModule = new TestApnsContextModule();
        } else {
            const apnsConnectionPool = new ApnsConnectionPool(processContext, {
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

        let hasSeededDynamo = false;

        const handleRequest = createRequestHandler(build, process.env.NODE_ENV);

        const requestListener = createStandardizedRequestListener<
            "HealthCheck" | "ClearSpaceAccountsCacheForTest" | Array<RouteMatch<ServerRoute>> | null
        >(
            tracer,
            url => {
                if (url.pathname === "/api/internal/healthcheck")
                    return [url.pathname, "HealthCheck"];

                // Add route when running integration tests...
                if (process.env.PLAYWRIGHT_TEST_PATH) {
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
                if (matches === "HealthCheck") {
                    return Promise.resolve(
                        new Response("200 OK", {
                            status: 200,
                            headers: {"content-type": "text/plain"},
                        }),
                    );
                }

                if (matches === "ClearSpaceAccountsCacheForTest") {
                    const spaceAccountsCache = getSpaceAccountsCacheForTest();
                    spaceAccountsCache.clearForTest();

                    return Promise.resolve(
                        new Response("200 OK", {
                            status: 200,
                            headers: {"content-type": "text/plain"},
                        }),
                    );
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
                        }>,
                        spaceId: SpaceId,
                        action: (context: ServerSystemActionContext) => Promise<Value>,
                    ): Promise<Value> => {
                        return processContext.with<
                            Omit<
                                ServerSystemActionContextModules,
                                Exclude<keyof ServerProcessContextModules, "tracer">
                            >,
                            Value
                        >(
                            {
                                tracer: new TracerContextModule(context.tracer.getTracer()),
                                // Optimization: Share some caches that opt-in to sharing with the session
                                // context. This is dangerous since we don't want to let system data leak into
                                // session actions and vice-versa. We trust the cache author to make the right
                                // determination about their cache.
                                cache: context.cache.dangerouslyForkWithSharedCaches(),
                                dynamoBatchContext: new DynamoBatchContextModule(),
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
                        devServerPort: options.remixDevServerPort
                            ? parseInt(options.remixDevServerPort, 10)
                            : null,
                    });

                    const response = await processContext.with<
                        Omit<
                            LoaderContextModules,
                            Exclude<keyof ServerProcessContextModules, "tracer">
                        >,
                        globalThis.Response
                    >(
                        {
                            tracer: new TracerContextModule(span),
                            rpc: new LocalRpcContextModule(),
                            loader: loaderContextModule,
                            cache: new CacheContextModule(),
                            dynamoBatchContext: new DynamoBatchContextModule(),
                            actor: createActorContextModule(
                                request,
                                url,
                                tokenAgent,
                                sessionCookie,
                            ),
                            tasks: new TaskContextModule({
                                router: taskRealtimeServiceRouter,
                                tokenAgent,
                                dangerouslyEscalateToSystemContext,
                            }),
                            languageModel: new LanguageModelContextModule(languageModel),
                            apns: apnsContextModule,
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
                                context.process.waitUntil(async () => {
                                    try {
                                        await seedDynamo(context);
                                    } catch (error) {
                                        // If there is an error, log it but don't crash the process.
                                        // eslint-disable-next-line no-console
                                        console.error("Failed to seed DynamoDB data:", error);
                                    }
                                });
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

        // TODO(calebmer): Block requests that don't come from Cloudflare -> AWS Load Balancer -> us
        // in application code in production.
        const server = createServer((req, res) => {
            // In development, static assets are served by `serve-static` middleware in
            // `AppService`. In production we serve static assets from Cloudflare R2.
            if (
                process.env.NODE_ENV !== "production" &&
                (req.url!.startsWith("/build/") ||
                    appStaticManifestPaths.has(req.url!.replace(/\?.*$/, "")))
            ) {
                serveStaticMiddleware!(req, res, () => {
                    res.writeHead(404, {"content-type": "text/plain"});
                    res.end("404 Not Found");
                });
            } else {
                requestListener(req, res);
            }
        });

        server.on("error", error => {
            tracer.logUncaughtException("Uncaught exception from HTTP server", error);
        });

        registerGracefulServerShutdown(shutdownManager, server);

        // TODO(calebmer): The way the Node.js `cluster` module works is when multiple
        // workers listen to the same `port` it randomly picks the worker to send a
        // request to. However, we've configured [AWS ALB sticky sessions][1] so we can
        // take advantage of in-memory caches. While AWS ALB routes us to the same EC2
        // instance, then Node.js takes over and puts us in a random process! So we
        // can't actually take advantage of in-memory caches without many cache misses.
        //
        // We need to [implement sticky sessions ourselves][2] for a Node.js cluster.
        // There are [modules like `sticky-session`][3] that do this but they route
        // based on IP address. AWS ALB requests probably come from the same IPs and
        // don't reflect the client's IP. That would destroy the benefits of clustering
        // since all AWS ALB requests go to one process instead of distributed across
        // multiple processes.
        //
        // Instead we should piggy-back off of AWS ALB sticky sessions to decide which
        // worker to send a request to. AWS ALB has "application controlled" sticky
        // sessions which is probably the feature we need to leverage to make this
        // work. We can use the `sticky-session` module as inspiration of how to
        // implement this on the Node.js side.
        //
        // [1]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html
        // [2]: https://stackoverflow.com/questions/51301126/nodejs-clustering-with-sticky-session
        // [3]: https://github.com/indutny/sticky-session
        //
        // TODO(calebmer): It would be nice if sticky sessions directed all traffic for
        // a `SpaceId` to one or two `AppService` instances. Probably two `AppService`
        // instances to avoid bugs where we're depending on in-memory state. That way
        // we could really take advantage of space-level in-memory caches.
        server.listen(port, () => {
            // Log when ready in production to help when debugging container startup.
            if (process.env.NODE_ENV === "production") {
                // eslint-disable-next-line no-console
                console.log(`Listening on port ${port} (pid ${process.pid})`);
            }
        });
    },
});

function createActorContextModule(
    request: Request,
    url: URL,
    tokenAgent: TokenAgent,
    sessionCookie: SessionCookie,
) {
    // Clients can authenticate with our app service in one of two ways:
    //
    // 1. Session cookie authentication. This is what web browsers use. We put a
    //    token in an HTTP only cookie and that token identifies the user. Only
    //    tokens issued by `AppService` are accepted in the session cookie. You can
    //    only authenticate as an account session with this method.
    //
    // 2. Authorization header authentication. This is what HTTP clients use. They
    //    put a token in an "Authorization" HTTP header. This is how the edge
    //    service family executes RPCs against our app service. You can
    //    authenticate as a session or system actor through an authorization header.
    //
    // We authenticate lazily. If a route doesn't need authentication this function
    // never gets called. You can also parallelize other network requests with
    // authentication deeper in a route. Once we authenticate it is cached for
    // the route.
    return new DynamoUnknownActorContextModule(async context => {
        const sessionCookiePayload = await sessionCookie.getIfExists();
        const authorizationHeader = request.headers.get("authorization");

        // Optimization: When loading our session from the database, also attempt to
        // load whether the account associated with the session is a member of the
        // space we're in. We try to determine the `SpaceId` we're in through various
        // hint heuristics. It's not required that we know the `SpaceId` here, if we
        // don't know the `SpaceId` we'll authorize the account later.
        const getSessionIfExists = async (
            sessionId: SessionId,
            accountId: AccountId,
        ): Promise<Session | null> => {
            const spaceIdStringHint =
                request.headers.get("cyberworlds-space-id-hint") ??
                url.pathname.match(/^\/s\/([a-zA-Z0-9]+)(?:\/|$)/)?.[1];

            const spaceIdHint =
                spaceIdStringHint && isId<SpaceId>(spaceIdStringHint)
                    ? spaceIdStringHint
                    : undefined;

            if (!spaceIdHint) {
                return Session.getIfExists(context, sessionId, accountId);
            }

            const [session] = await runAllPromises([
                Session.getIfExists(context, sessionId, accountId),
                // This function caches its result for the duration of the request. Which is
                // why we can call it here and ignore the output.
                isAccountMemberOfSpaceWithoutAuthorization(context, spaceIdHint, accountId),
            ]);

            return session;
        };

        if (sessionCookiePayload && authorizationHeader) {
            throw new InvalidArgumentError(
                'Can\'t provide both an "Authorization" header and a session cookie',
            );
        }

        // 1. Session cookie authentication
        if (sessionCookiePayload) {
            const session = await getSessionIfExists(
                sessionCookiePayload.sessionId,
                sessionCookiePayload.accountId,
            );
            if (!session) {
                // Remove our session cookie if the session was deleted from the database.
                sessionCookie.dangerouslySet(null);
                return null;
            }

            // If we receive a session cookie, we treat the request as if it came from a
            // user's web browser and use the `AppClient` service name.
            return DynamoSessionActorContextModule.dangerouslyNew("AppClient", session);
        }

        // 2. Authorization header authentication
        if (authorizationHeader) {
            const authorizationHeaderMatch = authorizationHeader.match(/^bearer (.+)$/i);

            if (!authorizationHeaderMatch) {
                throw new InvalidArgumentError(
                    'Expected "Authorization" header to have "Bearer" authentication scheme',
                );
            }

            const authorizationHeaderToken = authorizationHeaderMatch[1] ?? "";
            const {serviceName, payload: authorizationHeaderPayload} =
                await tokenAgent.publicSide.verifyToken(authorizationHeaderToken);

            switch (authorizationHeaderPayload.type) {
                case "Session": {
                    const session = await getSessionIfExists(
                        authorizationHeaderPayload.sessionId,
                        authorizationHeaderPayload.accountId,
                    );
                    if (!session) {
                        throw new PermissionDeniedError("Session not found");
                    }
                    return DynamoSessionActorContextModule.dangerouslyNew(serviceName, session);
                }
                case "System": {
                    return DynamoSystemActorContextModule.dangerouslyNew(
                        serviceName,
                        authorizationHeaderPayload.spaceId,
                    );
                }
                default:
                    throw exhaustive(authorizationHeaderPayload);
            }
        }

        return null;
    });
}
