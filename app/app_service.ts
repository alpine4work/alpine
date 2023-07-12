import "~/app/helpers/install_remix_globals.js";

import {fromContainerMetadata} from "@aws-sdk/credential-providers";
import * as build from "@remix-run/dev/server-build";
import {
    Request as NodeRequest,
    RequestInit as NodeRequestInit,
    Response as NodeResponse,
    createRequestHandler,
    writeReadableStreamToWritable,
} from "@remix-run/node";
import {AwsCredentialIdentity} from "@smithy/types";
import {AwsClient} from "aws4fetch";
import cluster from "cluster";
import {parse as parseCookieHeader} from "cookie";
import fs from "fs-extra";
import {IncomingHttpHeaders, IncomingMessage, ServerResponse, createServer} from "http";
import * as os from "os";
import {join as joinPath} from "path";
import createServeStaticMiddleware from "serve-static";
import {PassThrough} from "stream";
import {parseArgs} from "util";
import {defaultClientInfo, defaultMobileClientInfo} from "~/client/remix/client_info_context.js";
import {Session} from "~/server/dynamo/accounts_table.js";
import {
    AppSessionActorContextModule,
    AppSystemActorContextModule,
    AppUnknownActorContextModule,
} from "~/server/dynamo/context/app_actor_context_module.js";
import {AppProcessContextModules} from "~/server/dynamo/context/app_process_context.js";
import {NotificationsContextModule} from "~/server/dynamo/context/notifications_context_module.js";
import {
    DynamoBatchContextModule,
    DynamoContextModule,
} from "~/server/dynamo/dynamo_context_module.js";
import {seedDynamo} from "~/server/dynamo/seed_dynamo.js";
import {isAccountMemberOfSpace} from "~/server/dynamo/spaces_table.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module.js";
import {LoaderContextModule, LoaderContextModules} from "~/server/remix/loader_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {SessionCookie, withSessionCookie} from "~/server/tokens/session_cookie.js";
import {AppServiceTokenAgent} from "~/server/tokens/token_agent.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceFetchResponse} from "~/server/tracer/trace_fetch_response.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {ClientInfoSchema} from "~/shared/remix/client_info.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

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

// Kill the process if we get an uncaught exception before the
// tracer initializes.
function handleUncaughtExceptionBeforeTracerInitialization(error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
}

process.on("uncaughtException", handleUncaughtExceptionBeforeTracerInitialization);

// In production, run our service across all available CPUs so we get full
// CPU utilization.
//
// TODO(calebmer): Could we detect the `SpaceId` and route requests from that
// `SpaceId` to the same process? So we can use in-memory caches for the space.
if (cluster.isPrimary) {
    const workerCount = process.env.NODE_ENV !== "production" ? 1 : os.cpus().length;

    for (let i = 0; i < workerCount; i++) {
        cluster.fork();
    }

    // If any worker in the cluster dies, kill all other workers and exit the
    // process with an error.
    cluster.on("exit", () => {
        process.exit(1);
    });
} else {
    main().catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    });
}

async function main() {
    const {
        values: {
            port: portString,
            edgeServiceUrl,
            appServicePublicKey: appServicePublicKeyArg,
            edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyArg,
            appServicePrivateKey: appServicePrivateKeyArg,
            awsAccessKeyId: awsAccessKeyIdArg,
            awsSecretAccessKey: awsSecretAccessKeyArg = process.env.NODE_ENV !== "production"
                ? "local"
                : undefined,
            honeycombApiKey,
            remixDevServerPort,
            dynamoLocalPort,
            shouldSeedDynamo,
        },
    } = parseArgs({
        options: {
            port: {type: "string"},
            edgeServiceUrl: {type: "string"},
            appServicePublicKey: {type: "string"},
            edgeServiceFamilyPublicKey: {type: "string"},
            appServicePrivateKey: {type: "string"},
            awsAccessKeyId: {type: "string"},
            awsSecretAccessKey: {type: "string"},
            honeycombApiKey: {type: "string"},
            remixDevServerPort: {type: "string"},
            dynamoLocalPort: {type: "string"},
            shouldSeedDynamo: {type: "boolean"},
        },
    });

    if (!portString) throw new InternalError("Missing `port` arg");
    if (!edgeServiceUrl) throw new InternalError("Missing `edgeServiceUrl` arg");

    if (!appServicePublicKeyArg) throw new InternalError("Missing `appServicePublicKey` arg");
    if (!edgeServiceFamilyPublicKeyArg)
        throw new InternalError("Missing `edgeServiceFamilyPublicKeyPath` arg");
    if (!appServicePrivateKeyArg) throw new InternalError("Missing `appServicePrivateKey` arg");

    // If a Honeycomb API key is not provided in production then we get no logging
    // from our service.
    if (!honeycombApiKey && process.env.NODE_ENV === "production")
        throw new InternalError("Must provide `honeycombApiKey` arg in production");

    const tracer = createServerTracer({
        serviceName: "AppService",
        jsHost: "Node",
        honeycombApiKey,
        waitUntil: promise => {
            // We don't need to extend the lifetime of our Node.js process with a promise.
            // If the tracer throws an error, well, there's nowhere else to send the error.
            promise.catch(scheduleUncaughtError);
        },
    });

    let isLocalAws = false;
    let getAwsCredentials: (
        tracer: TracerBase,
    ) => Promise<AwsCredentialIdentity & {httpClient?: AwsClient}>;
    if (process.env.NODE_ENV !== "production") {
        isLocalAws = !awsAccessKeyIdArg;
        getAwsCredentials = async () => ({
            accessKeyId: awsAccessKeyIdArg ?? "local",
            secretAccessKey: awsSecretAccessKeyArg ?? "local",
        });
    }
    // In production, we load our AWS credentials from container metadata with an
    // API request. These are short-lived credentials so we need to continuously
    // refetch the credentials.
    //
    // Normally this is handled by the AWS SDK but because we use `aws4fetch` we
    // need direct access to the AWS credentials outside of the SDK so we have to
    // implement refresh manually.
    //
    // See: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html
    else {
        if (awsAccessKeyIdArg || awsSecretAccessKeyArg) {
            throw new InternalError(
                "Not allowed to provide `awsAccessKeyIdArg` and `awsSecretAccessKeyArg` arg in production",
            );
        }

        const actuallyFetchAwsCredentials = fromContainerMetadata();

        const fetchAwsCredentials = (tracer: TracerBase) =>
            tracer.withSpan("Fetching AWS credentials from container metadata", async span => {
                try {
                    const credentials = await actuallyFetchAwsCredentials();

                    if (credentials.expiration) {
                        span.addData({
                            aws: {
                                credentials: {
                                    expirationTime: serializeDateString(credentials.expiration),
                                },
                            },
                        });
                    }

                    return credentials;
                } catch (error) {
                    // Escalate to internal error! If this isn't resolved requests will
                    // start failing.
                    throw InternalError.from(error);
                }
            });

        let currentAwsCredentialsPromise: Promise<AwsCredentialIdentity> =
            fetchAwsCredentials(tracer);
        let nextAwsCredentialsPromise: Promise<AwsCredentialIdentity> | null;

        getAwsCredentials = async (tracer: TracerBase) => {
            const awsCredentials = await currentAwsCredentialsPromise;

            if (
                awsCredentials.expiration &&
                // Wait until four minutes before our current AWS credentials expire to fetch
                // new credentials. The docs say new credentials are available five minutes
                // before the expiration time. We fetch four minutes before the expiration time
                // to account for clock drift.
                Date.now() > awsCredentials.expiration.getTime() - 1000 * 60 * 4 &&
                !nextAwsCredentialsPromise
            ) {
                const ourAwsCredentialsPromise = fetchAwsCredentials(tracer);
                nextAwsCredentialsPromise = ourAwsCredentialsPromise;

                ourAwsCredentialsPromise.then(
                    () => {
                        if (nextAwsCredentialsPromise === ourAwsCredentialsPromise) {
                            currentAwsCredentialsPromise = ourAwsCredentialsPromise;
                            nextAwsCredentialsPromise = null;
                        }
                    },
                    () => {
                        if (nextAwsCredentialsPromise === ourAwsCredentialsPromise) {
                            // If there was an error, clear our promise which will cause us to try fetching
                            // credentials again. Errors should already be reported by `tracer.withSpan()`.
                            nextAwsCredentialsPromise = null;
                        }
                    },
                );
            }

            return awsCredentials;
        };
    }

    const port = parseInt(portString, 10);

    // Our key args may either be a file path or an environment variable name. We
    // first test the environment variable name then try to load as a file path.
    function getKeyFromArg(arg: string) {
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

    const [appServicePublicKey, edgeServiceFamilyPublicKey, appServicePrivateKey] =
        await runAllPromises([
            getKeyFromArg(appServicePublicKeyArg),
            getKeyFromArg(edgeServiceFamilyPublicKeyArg),
            getKeyFromArg(appServicePrivateKeyArg),
        ]);

    const tokenAgent = await AppServiceTokenAgent.new({
        appServicePublicKey,
        edgeServiceFamilyPublicKey,
        appServicePrivateKey,
    });

    const getAwsHttpClient = async (tracer: TracerBase) => {
        const awsCredentials = await getAwsCredentials(tracer);

        return (awsCredentials.httpClient ??= new AwsClient({
            accessKeyId: awsCredentials.accessKeyId,
            secretAccessKey: awsCredentials.secretAccessKey,
            sessionToken: awsCredentials.sessionToken,
        }));
    };

    const processContext = Context.new<AppProcessContextModules>({
        process: new ProcessContextModule({
            waitUntil: promise => {
                promise.catch(error => {
                    tracer.logUncaughtException("Uncaught exception from `waitUntil()`", error);
                });
            },
        }),
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new({
            getAwsHttpClient,
            awsDynamoUrl: !isLocalAws
                ? `https://dynamodb.us-east-1.amazonaws.com`
                : `http://localhost:${parseInt(
                      assertExists(
                          dynamoLocalPort,
                          "DynamoDB local port must be provided when running DynamoDB locally",
                      ),
                      10,
                  )}`,
        }),
        email: !isLocalAws
            ? new SesEmailContextModule(getAwsHttpClient)
            : new NoopEmailContextModule(),
    });

    let hasSeededDynamo = false;

    const handleRequest = createRequestHandler(build, process.env.NODE_ENV);

    // Now that we've initialized our tracer, don't crash the process on uncaught
    // exceptions and instead log the exception with our tracer.
    process.off("uncaughtException", handleUncaughtExceptionBeforeTracerInitialization);
    process.on("uncaughtException", error => {
        tracer.logUncaughtException("Uncaught exception", error);
    });

    const server = createServer((req, res) => {
        serveStaticMiddleware(req, res, () => {
            const request = createRequest(req);
            const url = new URL(request.url);

            const responsePromise = traceFetchResponse(tracer, request, url, (span, request) => {
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

                    return processContext.with<
                        Omit<
                            LoaderContextModules,
                            Exclude<keyof AppProcessContextModules, "tracer">
                        >,
                        globalThis.Response
                    >(
                        {
                            tracer: new TracerContextModule(span),
                            rpc: new LocalRpcContextModule(),
                            loader: new LoaderContextModule({
                                sessionCookie,
                                clientInfo,
                                devServerPort: remixDevServerPort
                                    ? parseInt(remixDevServerPort, 10)
                                    : null,
                            }),
                            cache: new CacheContextModule(),
                            dynamoBatchContext: new DynamoBatchContextModule(),
                            actor: createActorContextModule(
                                request,
                                url,
                                tokenAgent,
                                sessionCookie,
                            ),
                            notifications: new NotificationsContextModule({
                                processContext,
                                edgeServiceUrl,
                                tokenAgent,
                            }),
                        },
                        context => {
                            // The first time our server process runs in development, seed DynamoDB with
                            // some initial data. The seed function should be idempotent.
                            if (
                                process.env.NODE_ENV !== "production" &&
                                shouldSeedDynamo &&
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

            responsePromise.then(
                response => sendResponse(res, response as NodeResponse),
                error => {
                    // Errors should be caught and handled by this point. So this error handler is
                    // for unexpected internal code failures.
                    scheduleUncaughtError(error);

                    res.writeHead(500, {"content-type": "text/plain"});
                    res.end("Internal Server Error");
                },
            );
        });
    });

    server.listen(port, () => {
        // Log when ready in production to help show debugging container startup.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Listening on port ${port}`);
        }
    });
}

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
    return new AppUnknownActorContextModule(async context => {
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
            return AppSessionActorContextModule.dangerouslyNew("AppClient", session);
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
                    return AppSessionActorContextModule.dangerouslyNew(serviceName, session);
                }
                case "System": {
                    return AppSystemActorContextModule.dangerouslyNew(
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

/**
 * Convert a Node.js request object to a WhatWG fetch request object.
 */
function createRequest(req: IncomingMessage): NodeRequest {
    const protocol = "http";
    const host = req.headers.host;
    const url = `${protocol}://${host!}${req.url!}`;

    const init: NodeRequestInit = {
        method: req.method,
        headers: createRequestHeaders(req.headers),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
        // Derived from the following. Unclear to me how the `highWaterMark` number
        // was picked.
        // https://github.com/mcansh/remix-node-http-server/blob/230a8b5f270231011466c6b9452c543224588603/packages/remix-raw-http/src/server.ts#L90
        init.body = req.pipe(new PassThrough({highWaterMark: 16384}));
    }

    return new NodeRequest(url, init);
}

/**
 * Convert a Node.js request headers object to a WhatWG fetch request
 * headers object.
 */
function createRequestHeaders(reqHeaders: IncomingHttpHeaders): Headers {
    const headers = new Headers();

    for (const [key, values] of Object.entries(reqHeaders)) {
        if (values) {
            if (Array.isArray(values)) {
                for (const value of values) {
                    headers.append(key, value);
                }
            } else {
                headers.set(key, values);
            }
        }
    }

    return headers;
}

/**
 * Convert a WhatWG response object to a Node.js response.
 */
async function sendResponse(res: ServerResponse, response: NodeResponse) {
    res.statusCode = response.status;

    for (const [key, values] of Object.entries(response.headers.raw())) {
        res.setHeader(key, values);
    }

    if (response.body) {
        await writeReadableStreamToWritable(response.body, res);
    } else {
        res.end();
    }
}
