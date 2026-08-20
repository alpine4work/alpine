import fs from "fs/promises";
import {Socket, createConnection, createServer} from "net";
import {createApiClient} from "~/server/agents/api/api_client.open_source.js";
import {
    ClaudeAgentServiceApprovalDecisionRequest,
    ClaudeAgentServiceRequest,
    ClaudeAgentServiceRoomRequest,
} from "~/server/agents/bots_v2/sandbox/claude_agent_service_request.js";
import {createClaudeAgentServiceTracer} from "~/server/agents/bots_v2/sandbox/create_claude_agent_service_tracer.js";
import {runClaudeAgent} from "~/server/agents/bots_v2/sandbox/run_claude_agent.js";
import {printErrorDisplayMessageToApiContent} from "~/shared/api/content/print_error_display_message_to_api_content.js";
import {ApiContentRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {getErrorDisplayMessage} from "~/shared/error/default_error_display_message.open_source.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {isTransientError} from "~/shared/error/is_transient_error.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {decodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {EventQueue} from "~/shared/helpers/control/event_queue.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

type ClaudeAgentServiceMessageEvent = {
    type: "MessageEvent";
    span: TracerSpan | null;
    request: ClaudeAgentServiceRoomRequest;
    acknowledge: () => void;
};

export type ClaudeAgentServiceApprovalDecisionEvent = {
    type: "ApprovalDecisionEvent";
    span: TracerSpan | null;
    request: ClaudeAgentServiceApprovalDecisionRequest;
    acknowledge: () => void;

    /**
     * Report that we looked at this event and it isn't actionable, so no response is
     * coming. The webhook waits for this or `acknowledge()` — without it a legitimate
     * no-op would look like the process crashed.
     *
     * Only approval decisions can be ignored. Every room event gets a response, and
     * its stream message already exists by the time we see it.
     */
    ignore: () => void;
};

export type ClaudeAgentServiceEvent =
    | ClaudeAgentServiceMessageEvent
    | ClaudeAgentServiceApprovalDecisionEvent
    | {
          type: "Error";
          error: unknown;
      };

// Kill the process if we get an uncaught exception before the tracer initializes.
function handleUncaughtExceptionBeforeTracerInitialization(error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
}

process.on("uncaughtException", handleUncaughtExceptionBeforeTracerInitialization);

main()
    .then(
        () => {
            process.exit(0);
        },
        async error => {
            // eslint-disable-next-line no-console
            console.error("Main failed:", error);

            const content: ApiContentRequest = {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "I couldn\u2019t generate a response. "},
                            ...printErrorDisplayMessageToApiContent(getErrorDisplayMessage(error)),
                        ],
                    },
                ],
            };

            await fs.writeFile("/workspace/error.json", JSON.stringify({content}) + "\n");

            // We use exit code 3 to indicate we've written an error file to
            // `/workspace/error.json` so the agent can read that file and use it to respond.
            //
            // Exit code 3 seems to be fine to give a program-specific meaning:
            // https://stackoverflow.com/questions/1101957/are-there-any-standard-exit-status-codes-in-linux
            process.exit(3);
        },
    )
    .catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    });

async function main() {
    const request: ClaudeAgentServiceRequest = JSON.parse(
        new TextDecoder().decode(decodeBase64(process.argv[2] ?? "")),
    );

    const {tracer, flushTracerEvents} = createClaudeAgentServiceTracer();

    try {
        await tracer.withSpanFromPropagationContext(
            "Run Claude agent service",
            request.tracerContext,
            async span => {
                // Now that we've initialized our tracer, don't crash the process on uncaught
                // exceptions and instead log the exception with our tracer.
                process.off("uncaughtException", handleUncaughtExceptionBeforeTracerInitialization);
                process.on("uncaughtException", (error, origin) => {
                    switch (origin) {
                        case "uncaughtException": {
                            tracer.logException("Uncaught exception", error);
                            break;
                        }
                        case "unhandledRejection": {
                            tracer.logException("Unhandled rejection", error);
                            break;
                        }
                        default:
                            throw exhaustive(origin);
                    }
                });

                await actuallyMain(span, request);
            },
        );
    } finally {
        // Flush any pending tracer events before exiting. Once we return the process exits
        // and any pending tracer events won't be sent.
        await flushTracerEvents();
    }
}

async function actuallyMain(span: TracerSpan, request: ClaudeAgentServiceRequest) {
    const apiUrl = assertExists(process.env.ALPINE_API_URL);

    const apiClient = createApiClient({
        // `localhost` within the Docker container refers to the container's local
        // networking stack. We want to send API requests against the host's networking
        // stack. Only matters in development environments.
        baseUrl: apiUrl.startsWith("http://localhost:")
            ? `http://host.docker.internal:${apiUrl.slice("http://localhost:".length)}`
            : apiUrl,
        apiKey: assertExists(process.env.ALPINE_API_KEY),
        accessToken: request.body.accessToken,
    });

    await retryWithExponentialBackoff(async retry => {
        const result = await tryStartingClaudeAgentSocketServer(span);

        switch (result.type) {
            case "AddressInUse": {
                span.addData({common: {branch: "AddressInUse"}});

                try {
                    // Another process in this sandbox already owns the socket server and is running
                    // the Claude loop. Forward our webhook request to it over the local socket — it'll
                    // steer the running conversation — and wait for it to acknowledge before we report
                    // success and exit.
                    await sendRequestToClaudeAgentSocketServer(span, request);
                } catch (error) {
                    // If we failed to send the event, retry up to five times. This process may need to
                    // become the new server. For example, if there was a server when we first called
                    // `tryStartingClaudeAgentSocketServer()` but it closed right before we sent our
                    // event (so we never get an acknowledgement).
                    if (isTransientError(error)) {
                        span.logException("Retry after transient error", error);
                        throw retry(error);
                    }

                    throw error;
                }

                // eslint-disable-next-line no-console
                console.log(`Acknowledged event ${request.body.eventId} (sent to other process)`);
                break;
            }
            case "Listening": {
                span.addData({common: {branch: "Listening"}});

                try {
                    // Enqueue the first event which will actually kick off the agent.
                    result.eventQueue.enqueue(
                        createClaudeAgentServiceRequestEvent(request, {
                            span: null,
                            acknowledge: () => {
                                // eslint-disable-next-line no-console
                                console.log(
                                    `Acknowledged event ${request.body.eventId} (in own process)`,
                                );
                            },
                            ignore: () => {
                                // eslint-disable-next-line no-console
                                console.log(
                                    `Ignored event ${request.body.eventId} (in own process)`,
                                );
                            },
                        }),
                    );

                    await runClaudeAgent(span, {
                        apiClient,
                        spaceId: request.body.spaceId,
                        botAccount: request.body.botAccount,
                        room: request.body.event.room,
                        eventQueue: result.eventQueue,
                    });
                } finally {
                    await result.close();
                }
                break;
            }
            default:
                throw exhaustive(result);
        }
    });
}

/**
 * Wraps a request in the queue event for its kind, so only an approval decision
 * carries `ignore()` and only a room event carries a stream message index.
 */
function createClaudeAgentServiceRequestEvent(
    request: ClaudeAgentServiceRequest,
    {
        span,
        acknowledge,
        ignore,
    }: {span: TracerSpan | null; acknowledge: () => void; ignore: () => void},
): ClaudeAgentServiceEvent {
    switch (request.type) {
        case "MessageRequest":
            return {type: "MessageEvent", span, request, acknowledge};
        case "ApprovalDecisionRequest":
            return {type: "ApprovalDecisionEvent", span, request, acknowledge, ignore};
        default:
            throw exhaustive(request);
    }
}

type TryStartingClaudeAgentSocketServerResult =
    | {type: "AddressInUse"}
    | {
          type: "Listening";
          eventQueue: EventQueue<ClaudeAgentServiceEvent>;
          close: () => Promise<void>;
      };

function tryStartingClaudeAgentSocketServer(tracer: TracerBase) {
    return new Promise<TryStartingClaudeAgentSocketServerResult>((resolve, reject) => {
        const listenSpan = tracer.startSpan("Try starting Claude agent socket server");
        let serverSpan: {span: TracerSpan; finishSpan: () => void} | null = null;

        const eventQueue = new EventQueue<ClaudeAgentServiceEvent>();

        const sockets = new Set<Socket>();

        const server = createServer(socket => {
            sockets.add(socket);

            socket.setEncoding("utf8");

            assert(serverSpan !== null);

            const clientSpan = serverSpan.span.startSpan("Connected Claude agent socket client");

            let requestSpan: {span: TracerSpan; finishSpan: () => void} | null = null;

            let isClientClosed = false;
            let data = "";

            // If a socket errors or closes before it sends a request, that's not our problem
            // it's the client's problem. Report an error and continue on.
            const handleError = (error: unknown) => {
                if (requestSpan !== null) {
                    requestSpan.span.addException(error);
                    requestSpan.finishSpan();
                }

                clientSpan.span.addException(error);
                clientSpan.finishSpan();
            };

            socket.on("error", error => {
                if (isClientClosed) return;
                isClientClosed = true;

                handleError(error);
            });

            socket.on("close", () => {
                // Once the socket closes, we don't need to `destroy()` it when the server
                // `close()` function is called.
                sockets.delete(socket);

                if (isClientClosed) return;
                isClientClosed = true;

                const error = new InternalError(
                    requestSpan === null
                        ? "Claude agent socket client closed before request was received"
                        : "Claude agent socket client closed before request was acknowledged",
                );

                handleError(error);
            });

            socket.on("data", chunk => {
                if (isClientClosed) return;

                data += chunk as any as string;

                const newlineIndex = data.indexOf("\n");
                if (newlineIndex === -1) return;

                socket.pause();

                requestSpan = clientSpan.span.startSpan(
                    "Received Claude agent socket client request",
                );

                const request: ClaudeAgentServiceRequest = JSON.parse(data.slice(0, newlineIndex));

                let isAcknowledged = false;

                // The client expects an acknowledgement before we can report a 200 response to the
                // webhook. Once Claude has accepted the request we should call this function.
                const acknowledge = () => {
                    if (isClientClosed) {
                        throw new InternalError(
                            "Can\u2019t acknowledge request after socket is closed",
                        );
                    }

                    assert(!isAcknowledged);
                    isAcknowledged = true;

                    assert(requestSpan !== null);
                    requestSpan.finishSpan();
                    clientSpan.finishSpan();

                    // The healthy close path is after `acknowledge()` is called. We've already closed
                    // `clientSpan`, don't report an error.
                    isClientClosed = true;

                    socket.end(`${JSON.stringify({type: "Acknowledged"})}\n`);
                };

                // Whenever the leader receives a request, it enqueues an event to be processed by
                // the agent. When the agent processes the event, it will call `acknowledge()` to
                // signal that it has processed the request. That acknowledge is sent back to the
                // "client" (the "trailer" process) over the socket.
                eventQueue.enqueue(
                    createClaudeAgentServiceRequestEvent(request, {
                        span: requestSpan.span,
                        acknowledge,
                        // The forwarding process is waiting on the socket either way — from its point of
                        // view the event was delivered and handled. It logs the acknowledgement the
                        // webhook waits on, so we just close the socket the same way.
                        ignore: acknowledge,
                    }),
                );
            });
        });

        const handleListening = () => {
            server.off("listening", handleListening);
            server.off("error", handleError);

            listenSpan.span.addData({common: {branch: "Listening"}});
            listenSpan.finishSpan();

            assert(serverSpan === null);
            serverSpan = tracer.startSpan("Claude agent socket server");

            let isServerClosed = false;

            server.on("error", error => {
                eventQueue.enqueue({type: "Error", error});
            });

            resolve({
                type: "Listening",
                eventQueue,
                close: () => {
                    return new Promise<void>((resolve, reject) => {
                        assert(!isServerClosed);
                        isServerClosed = true;

                        server.close(error => {
                            assert(serverSpan !== null);

                            if (error === undefined) {
                                serverSpan.finishSpan();
                                resolve();
                            } else {
                                serverSpan.span.addException(error);
                                serverSpan.finishSpan();
                                reject(error);
                            }
                        });

                        // `close()` stops accepting new connections but stays open until existing
                        // connections end. So destroy all existing connections to make sure the server
                        // promptly closes and we don't get stuck in a deadlock.
                        //
                        // This will cause the clients to retry and one of them will become the new leader.
                        for (const socket of sockets) {
                            socket.destroy();
                        }
                    });
                },
            });
        };

        const handleError = (error: Error) => {
            server.off("listening", handleListening);
            server.off("error", handleError);

            // There's another running `ClaudeAgentService` instance which has an active Claude
            // loop. We want to let that instance to handle the message.
            if ("code" in error && error.code === "EADDRINUSE") {
                listenSpan.span.addData({common: {branch: "AddressInUse"}});
                listenSpan.finishSpan();
                resolve({type: "AddressInUse"});
            } else {
                listenSpan.span.addException(error);
                listenSpan.finishSpan();
                reject(error);
            }
        };

        server.on("listening", handleListening);
        server.on("error", handleError);

        server.listen({
            host: "127.0.0.1",
            port: 4321,
            exclusive: true,
            reusePort: false,
        });
    });
}

/**
 * Sends the request to the "leader" process (the one running the server at
 * 127.0.0.1:4321). As soon as we connect to the server, we send the request and
 * wait for an acknowledgement.
 *
 * When the leader receives the request, it adds it to the queue of events that
 * ultimately get streamed into the Claude agent loop.
 */
function sendRequestToClaudeAgentSocketServer(
    tracer: TracerBase,
    request: ClaudeAgentServiceRequest,
) {
    return new Promise<void>((resolve, reject) => {
        const connectSpan = tracer.startSpan("Connecting Claude agent socket client");
        let acknowledgeSpan: {span: TracerSpan; finishSpan: () => void} | null = null;

        let isEnded = false;
        let data = "";

        const socket = createConnection({
            host: "127.0.0.1",
            port: 4321,
        });

        socket.setEncoding("utf8");

        socket.once("connect", () => {
            connectSpan.finishSpan();

            acknowledgeSpan = tracer.startSpan(
                "Waiting for Claude agent socket server acknowledgement",
            );

            // Send the request to the leader process.
            socket.write(`${JSON.stringify(request)}\n`);
        });

        socket.on("data", chunk => {
            if (isEnded) return;

            data += chunk as any as string;

            const newlineIndex = data.indexOf("\n");
            if (newlineIndex === -1) return;

            // The only data we ever expect to receive from the leader process is an
            // acknowledgement.
            const response: {type: string} = JSON.parse(data.slice(0, newlineIndex));
            assert(response.type === "Acknowledged");

            assert(acknowledgeSpan !== null);
            acknowledgeSpan.finishSpan();

            isEnded = true;
            socket.end();

            resolve();
        });

        const handleError = (error: unknown) => {
            if (!connectSpan.span.isFinished()) {
                connectSpan.span.addException(error);
                connectSpan.finishSpan();
            }

            if (acknowledgeSpan !== null && !acknowledgeSpan.span.isFinished()) {
                acknowledgeSpan.span.addException(error);
                acknowledgeSpan.finishSpan();
            }

            reject(error);
        };

        socket.on("error", error => {
            if (isEnded) return;
            isEnded = true;

            handleError(error);
        });

        socket.on("close", () => {
            if (isEnded) return;
            isEnded = true;

            const error = new InternalError(
                !connectSpan.span.isFinished()
                    ? "Claude agent socket client closed before request was sent"
                    : "Claude agent socket client closed before request was acknowledged",
            );

            handleError(error);
        });
    });
}
