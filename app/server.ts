import "~/app/helpers/install_remix_globals.js";

import * as build from "@remix-run/dev/server-build";
import {
    Headers,
    Request,
    RequestInit,
    Response,
    createRequestHandler,
    writeReadableStreamToWritable,
} from "@remix-run/node";
import {parse as parseCookieHeader} from "cookie";
import {
    IncomingHttpHeaders,
    IncomingMessage,
    STATUS_CODES,
    ServerResponse,
    createServer,
} from "http";
import {PassThrough} from "stream";
import {parseArgs} from "util";
import {defaultClientInfo, defaultMobileClientInfo} from "~/client/remix/client_info_context.js";
import {createAwsContextModules} from "~/server/aws/create_aws_context_modules.js";
import {Session} from "~/server/dynamo/accounts_table.js";
import {MaybeSessionActorContextModule} from "~/server/dynamo/context/actor_context_module.js";
import {NotificationsContextModule} from "~/server/dynamo/context/notifications_context_module.js";
import {DynamoBatchContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {seedDynamo} from "~/server/dynamo/seed_dynamo.js";
import {LoaderContextModule, LoaderContextModules} from "~/server/remix/loader_context.js";
import {SessionCookieStorage} from "~/server/remix/session_cookie.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceFetchResponse} from "~/server/tracer/trace_fetch_response.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {ClientInfoSchema} from "~/shared/remix/client_info.js";

// NOCOMMIT: Add back durable objects and queues!

const {
    values: {
        port: portString,
        sessionCookieSecret,
        awsAccessKeyId,
        awsSecretAccessKey,
        honeycombApiKey,
        devServerPort,
        dynamoLocalPort,
        shouldSeedDynamo,
    },
} = parseArgs({
    options: {
        port: {type: "string"},
        sessionCookieSecret: {type: "string"},
        awsAccessKeyId: {type: "string"},
        awsSecretAccessKey: {type: "string"},
        honeycombApiKey: {type: "string"},
        devServerPort: {type: "string"},
        dynamoLocalPort: {type: "string"},
        shouldSeedDynamo: {type: "boolean"},
    },
});

if (!portString) throw new InternalError("Missing `port` arg");
if (!sessionCookieSecret) throw new InternalError("Missing `sessionCookieSecret` arg");

const port = parseInt(portString, 10);

const sessionCookieStorage = new SessionCookieStorage({
    // The session cookie domain is not set in development because we may be
    // accessing from a proxied domain or an IP address on a mobile device.
    domain: process.env.NODE_ENV === "production" ? "cyberworlds.dev" : null,
    secret: sessionCookieSecret,
});

const awsContextModules = createAwsContextModules({
    awsAccessKeyId,
    awsSecretAccessKey,
    dynamoLocalPort,
});

let hasSeededDynamo = false;

const handleRequest = createRequestHandler(build, process.env.NODE_ENV);

const server = createServer((req, res) => {
    const request = createRequest(req);
    const url = new URL(request.url);

    // Create a new tracer for every request because we need a Honeycomb client and
    // the Honeycomb client needs `executionContext.waitUntil()` which is request
    // scoped. Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "AppServer",
        honeycombApiKey,
        waitUntil: promise => {
            // We don't need to extend the lifetime of our Node.js process with a promise.
            // If the tracer throws an error, well, there's nowhere else to send the error.
            promise.catch(error => {
                // eslint-disable-next-line no-console
                console.error(error);
            });
        },
    });

    const responsePromise = traceFetchResponse(tracer, request, url, (span, request) => {
        return sessionCookieStorage.with(request, sessionCookiePromise => {
            const cookieHeader = request.headers.get("cookie");
            const clientInfoCookieString = cookieHeader
                ? parseCookieHeader(cookieHeader)["client-info"]
                : null;

            let clientInfo = defaultClientInfo;
            if (clientInfoCookieString) {
                try {
                    clientInfo = ClientInfoSchema.deserialize(JSON.parse(clientInfoCookieString));
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

            return Context.with<LoaderContextModules, globalThis.Response>(
                {
                    ...awsContextModules,
                    process: new ProcessContextModule({
                        waitUntil: promise => {
                            // Don't crash the process when there's an uncaught promise exception in
                            // `waitUntil()` but definitely log it.
                            promise.catch(error => {
                                // eslint-disable-next-line no-console
                                if (process.env.NODE_ENV !== "production") console.error(error);

                                tracer.logUncaughtException(
                                    "Uncaught exception in `waitUntil()`",
                                    error,
                                );
                            });
                        },
                    }),
                    tracer: new TracerContextModule(span),
                    rpc: new LocalRpcContextModule(),
                    loader: new LoaderContextModule({
                        sessionCookiePromise,
                        clientInfo,
                        devServerPort: devServerPort ? parseInt(devServerPort, 10) : null,
                    }),
                    cache: new CacheContextModule(),
                    dynamoBatchContext: new DynamoBatchContextModule(),
                    notifications: new NotificationsContextModule({}),

                    actor: new MaybeSessionActorContextModule(async context => {
                        const sessionCookie = await sessionCookiePromise;

                        const {sessionId, sessionAccountId} = sessionCookie.get();
                        if (!sessionId) return null;

                        const session = await Session.getIfExists(
                            context,
                            sessionId,
                            sessionAccountId ?? null,
                        );
                        if (!session) {
                            // If the session was deleted since we stored the session in our cookie, remove
                            // the session from the cookie.
                            sessionCookie.unsetSessionId();
                            return null;
                        }

                        // Optimization: Add the account ID for the session to our cookie which allows
                        // us to load account data in parallel with session data in the future.
                        if (!sessionAccountId)
                            sessionCookie.dangerouslySetSessionId(sessionId, session.accountId);

                        return session;
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
                                console.error(
                                    InternalError.from(error, "Failed to seed DynamoDB data"),
                                );
                            }
                        });
                    }

                    return handleRequest(request, context);
                },
            );
        });
    });

    responsePromise.then(
        response => sendResponse(res, response as Response),
        error => {
            // Errors should be caught and handled by this point. So this error handler is
            // for unexpected internal code failures.
            // eslint-disable-next-line no-console
            console.error(error);

            res.writeHead(500, {"content-type": "text/plain"});
            res.write(STATUS_CODES[res.statusCode]);
            res.end();
        },
    );
});

server.listen(port);

/**
 * Convert a Node.js request object to a WhatWG fetch request object.
 */
function createRequest(req: IncomingMessage): Request {
    const protocol = "http";
    const host = req.headers.host;
    const url = `${protocol}://${host!}${req.url!}`;

    const init: RequestInit = {
        method: req.method,
        headers: createRequestHeaders(req.headers),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = req.pipe(new PassThrough({highWaterMark: 16384}));
    }

    return new Request(url, init);
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
async function sendResponse(res: ServerResponse, response: Response) {
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
