import * as build from "@remix-run/dev/server-build";
import {createRequestHandler} from "@remix-run/node";
import {parse as parseCookieHeader} from "cookie";
import fs from "fs-extra";
import {createServer} from "http";
import {join as joinPath} from "path";
import createServeStaticMiddleware from "serve-static";
import {seedDynamo} from "~/app/seed_dynamo.js";
import {defaultClientInfo, defaultMobileClientInfo} from "~/client/remix/client_info_context.js";
import {Session} from "~/server/accounts/accounts_table.js";
import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
    DynamoUnknownActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {createStandardizedRequestListener} from "~/server/node/create_standardized_server.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {runService} from "~/server/node/run_service.js";
import {NotificationsContextModule} from "~/server/notifications/data/notifications_context_module.js";
import {LoaderContextModule, LoaderContextModules} from "~/server/remix/loader_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {isAccountMemberOfSpace} from "~/server/spaces/spaces_table.js";
import {SessionCookie, withSessionCookie} from "~/server/tokens/session_cookie.js";
import {AppServiceTokenAgent} from "~/server/tokens/token_agent.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {ClientInfoSchema} from "~/shared/remix/client_info.js";

const runfilesPath = assertExists(process.env.RUNFILES);

const assetsBuildDirectory = joinPath(runfilesPath, "cyberworlds/app/public/build");

// Serve static assets from our `public` directory. These assets will be cached
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
const serveStaticMiddleware = createServeStaticMiddleware(
    joinPath(runfilesPath, "cyberworlds/app/public"),
    {
        setHeaders: (res, path) => {
            // Remix fingerprints its assets so we can cache forever. Other assets (like `favicon.ico`)
            if (path.startsWith(assetsBuildDirectory)) {
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
    },
);

runService({
    serviceName: "AppService",
    options: {
        port: {type: "string"},
        edgeServiceUrl: {type: "string"},
        appServicePublicKey: {type: "string"},
        edgeServiceFamilyPublicKey: {type: "string"},
        taskRealtimeServicePublicKey: {type: "string"},
        appServicePrivateKey: {type: "string"},
        remixDevServerPort: {type: "string"},
        shouldSeedDynamo: {type: "boolean"},
        ...serverProcessContextParseOptions,
    },
    run: async (options, tracer) => {
        const port = options.port ? parseInt(options.port, 10) : null;
        if (!port || !Number.isInteger(port)) throw new InternalError("Missing integer `port` arg");

        const {edgeServiceUrl} = options;
        if (!edgeServiceUrl) throw new InternalError("Missing `edgeServiceUrl` option");

        if (!options.appServicePublicKey)
            throw new InternalError("Missing `appServicePublicKey` option");
        if (!options.edgeServiceFamilyPublicKey)
            throw new InternalError("Missing `edgeServiceFamilyPublicKey` option");
        if (!options.taskRealtimeServicePublicKey)
            throw new InternalError("Missing `taskRealtimeServicePublicKey` option");
        if (!options.appServicePrivateKey)
            throw new InternalError("Missing `appServicePrivateKey` option");

        // Our key args may either be a file path or an environment variable name. We
        // first test the environment variable name then try to load as a file path.
        //
        // We allow an environment variable name since an RSA key argument might be too
        // long for the command line. Tools like AWS also make it easiest to pass in
        // secrets through environment variables as opposed to command line arguments
        // or files. As of 2023-08-07 the AWS CDK logic for setting production CLI
        // arguments can be found in
        // `admin/aws/internal/add_all_container_aws_resources.ts`.
        function getKeyFromOption(arg: string) {
            if (arg.startsWith("$")) {
                const envKey = arg.slice(1);
                const envValue = process.env[envKey];

                if (envValue === undefined)
                    throw new InternalError(quote`Env variable ${envKey} does not exist`);

                // Don't allow access to the environment variable anywhere else in the program.
                // Force key usage to be controlled here from the top of the program.
                //
                // Also secures against attacks where an attacker finds a way to inspect
                // `process.env`.
                delete process.env[envKey];

                return envValue;
            } else {
                return fs.readFile(arg, "utf8");
            }
        }

        const [
            appServicePublicKey,
            edgeServiceFamilyPublicKey,
            taskRealtimeServicePublicKey,
            appServicePrivateKey,
        ] = await runAllPromises([
            getKeyFromOption(options.appServicePublicKey),
            getKeyFromOption(options.edgeServiceFamilyPublicKey),
            getKeyFromOption(options.taskRealtimeServicePublicKey),
            getKeyFromOption(options.appServicePrivateKey),
        ]);

        const tokenAgent = await AppServiceTokenAgent.new({
            appServicePublicKey,
            edgeServiceFamilyPublicKey,
            taskRealtimeServicePublicKey,
            appServicePrivateKey,
        });

        const processContext = createServerProcessContext({tracer, options});

        let hasSeededDynamo = false;

        const handleRequest = createRequestHandler(build, process.env.NODE_ENV);

        const requestListener = createStandardizedRequestListener(tracer, (request, url, span) => {
            return withSessionCookie(tokenAgent, request, sessionCookie => {
                const cookieHeader = request.headers.get("cookie");
                const clientInfoCookieString = cookieHeader
                    ? parseCookieHeader(cookieHeader)["client-info"]
                    : null;

                let clientInfo = defaultClientInfo;
                if (clientInfoCookieString) {
                    try {
                        clientInfo = ClientInfoSchema.deserialize(
                            JSON.parse(clientInfoCookieString),
                        );
                    } catch {
                        // Ignore any errors when parsing the client info cookie.
                    }
                } else {
                    // Device detection with user-agent parsing is generally bad and should be
                    // avoided. However, in the case where we don't yet have a client info cookie
                    // we use the user agent as a hint to determine what our default when
                    // server-side rendering should be. We have logic on the client to heal the
                    // cookie if we guess wrong. The user will see a quick flash of content but
                    // that's all.
                    //
                    // [MDN recommends testing for the string "Mobi" to tell if we are on a
                    // mobile device][1].
                    //
                    // [1]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent#mobile_tablet_or_desktop
                    if (/Mobi/i.test(request.headers.get("user-agent") ?? "")) {
                        clientInfo = defaultMobileClientInfo;
                    }
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
                //
                // NOTE(calebmer, 2023-08-07): May be worthwhile turning uses of this function
                // into RPC calls on another machine someday for security? Not sure if that
                // helps.
                const dangerouslyEscalateToSystemContext = (
                    context: Context<{
                        tracer: TracerContextModule;
                        actor: DynamoActorContextModule;
                    }>,
                    spaceId: SpaceId,
                    action: (context: ServerSystemActionContext) => Promise<void>,
                ): Promise<void> => {
                    return processContext.with<
                        Omit<
                            ServerSystemActionContextModules,
                            Exclude<keyof ServerProcessContextModules, "tracer">
                        >,
                        void
                    >(
                        {
                            tracer: new TracerContextModule(context.tracer.getTracer()),
                            cache: new CacheContextModule(),
                            dynamoBatchContext: new DynamoBatchContextModule(),
                            notifications: notificationsContextModule,
                            actor: DynamoSystemActorContextModule.dangerouslyNew(
                                context.actor.serviceName,
                                spaceId,
                            ),
                        },
                        action,
                    );
                };

                const notificationsContextModule = new NotificationsContextModule({
                    dangerouslyEscalateToSystemContext,
                    edgeServiceUrl,
                    tokenAgent,
                });

                return processContext.with<
                    Omit<
                        LoaderContextModules,
                        Exclude<keyof ServerProcessContextModules, "tracer">
                    >,
                    globalThis.Response
                >(
                    {
                        tracer: new TracerContextModule(span),
                        rpc: new LocalRpcContextModule(),
                        loader: new LoaderContextModule({
                            sessionCookie,
                            clientInfo,
                            devServerPort: options.remixDevServerPort
                                ? parseInt(options.remixDevServerPort, 10)
                                : null,
                        }),
                        cache: new CacheContextModule(),
                        dynamoBatchContext: new DynamoBatchContextModule(),
                        actor: createActorContextModule(request, url, tokenAgent, sessionCookie),
                        notifications: notificationsContextModule,
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

                        return handleRequest(request, context);
                    },
                );
            });
        });

        // TODO(calebmer): Block requests that don't come from Cloudflare -> AWS Load Balancer -> us
        // in application code in production.
        const server = createServer((req, res) => {
            serveStaticMiddleware(req, res, () => {
                requestListener(req, res);
            });
        });

        server.on("error", error => {
            tracer.logUncaughtException("Uncaught exception from HTTP server", error);
        });

        registerGracefulServerShutdown(server);

        server.listen(port, () => {
            // Log when ready in production to help when debugging container startup.
            if (process.env.NODE_ENV === "production") {
                // eslint-disable-next-line no-console
                console.log(`Listening on port ${port}`);
            }
        });
    },
});

function createActorContextModule(
    request: Request,
    url: URL,
    tokenAgent: AppServiceTokenAgent,
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
                isAccountMemberOfSpace(context, spaceIdHint, accountId),
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
            const {serviceName, payload: authorizationHeaderPayload} = await tokenAgent.verifyToken(
                authorizationHeaderToken,
            );

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
