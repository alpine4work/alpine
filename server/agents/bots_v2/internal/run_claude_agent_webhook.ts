import {getSandbox} from "@cloudflare/sandbox";
import {
    completeApiMessageStream,
    createApiClient,
    createApiMessage,
    createApiMessageStreamPart,
    pingApiMessageStream,
} from "~/server/agents/api/api_client.open_source.js";
import {shouldAgentRespondToApiBotWebhookRequest} from "~/server/agents/api/should_agent_respond_to_bot_webhook_request.js";
import {AgentV2ServiceEnv} from "~/server/agents/bots_v2/internal/agent_v2_service_env.js";
import {createSimpleOkResponse} from "~/server/helpers/create_simple_ok_response.js";
import {messageStreamPingIntervalMs} from "~/shared/agents/message_stream_ping_interval_ms.js";
import {printErrorDisplayMessageToApiContent} from "~/shared/api/content/print_error_display_message_to_api_content.js";
import {
    convertApiReferenceKeyToLowercase,
    printApiReferenceKey,
} from "~/shared/api/specification/api_reference_key.open_source.js";
import {
    botWebhookSignatureHeader,
    verifyBotWebhookRequestSignature,
} from "~/shared/api/specification/sign_bot_webhook_request.js";
import {
    ApiBotWebhookRequestBody,
    ApiContentRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {getErrorDisplayMessage} from "~/shared/error/default_error_display_message.open_source.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export async function runClaudeAgentWebhook(
    span: TracerSpan,
    request: Request,
    env: AgentV2ServiceEnv,
    evaluationContext: ExecutionContext,
): Promise<Response> {
    if (request.method !== "POST") {
        return new Response("405 Method Not Allowed", {
            status: 405,
            headers: {"content-type": "text/plain"},
        });
    }

    const requestBodyString = await request.text();
    const signature = request.headers.get(botWebhookSignatureHeader);

    // A secret is required in production and optional in development.
    if (process.env.NODE_ENV === "production" || typeof env.CLAUDE_WEBHOOK_SECRET === "string") {
        await verifyBotWebhookRequestSignature({
            requestBodyString,
            signature,
            secret: assertExists(env.CLAUDE_WEBHOOK_SECRET),
        });
    }

    const requestBody: ApiBotWebhookRequestBody = JSON.parse(requestBodyString);
    const {accessToken, botAccount, event} = requestBody;

    const apiClient = createApiClient({
        baseUrl: assertExists(env.API_SERVICE_URL),
        apiKey: assertExists(env.CLAUDE_API_SERVICE_KEY),
        accessToken,
    });

    switch (event.type) {
        case "CreatedMessage":
        case "CreatedPost": {
            const shouldRespond = await shouldAgentRespondToApiBotWebhookRequest(
                span,
                apiClient,
                botAccount.id,
                event,
            );

            if (!shouldRespond) {
                span.addData({common: {branch: "NotResponding"}});

                return createSimpleOkResponse();
            }
            break;
        }
        case "UpdatedMessageStreamExperimentalApprovalsPart":
            // Naive check to see if it's worth starting the container. Ultimately, the
            // container owns the business logic for deciding if it should respond to the event
            // or not because it has the canonical approval state (which is used to compare the
            // incoming event against the agent's understanding of the pending approvals).
            //
            // However, before we get there, we know we can ignore the event if either of the
            // following are true:
            //
            // 1. **Approvals are partially decided.** Every decision a user makes triggers a
            //    webhook, so a card with several approvals produces several deliveries. Only
            //    the one where everything is decided needs the agent.
            // 2. **The agent made a decision.** The agent will reject when a new message
            //    superseded it, or the run errored and wiped its state. When the agent rejects
            //    its own approvals, the server fires a decision webhook right back at us, and
            //    acting on it would run the agent for a card we just retired.
            for (const approval of event.approvals) {
                const decisionValue = approval.decision.value;

                // If any approval is undecided, ignore the event
                if (decisionValue === undefined) return createSimpleOkResponse();

                // If any approval is decided by this account, ignore the event. The bot only ever
                // rejects approvals and only does so when something has gone wrong (e.g. a user
                // asked the agent to do something else before the agent received the approval
                // decisions.) So if the agent was waiting on three approvals and I accepted two,
                // but before responding to the third, another user asked the agent to do something
                // else, the agent will reject the third approval and start handling that users
                // message.
                if (decisionValue.decider?.account.id === botAccount.id) {
                    return createSimpleOkResponse();
                }
            }

            break;
        default:
            throw exhaustive(event);
    }

    span.addData({common: {branch: "Responding"}});

    const promise = (async () => {
        const {room} = event;
        const sandboxId = `${botAccount.id}/${convertApiReferenceKeyToLowercase(printApiReferenceKey(room))}`;

        const sandbox = getSandbox(env.ClaudeAgentSandbox, sandboxId, {
            // In order to support steering, each `sandbox.startProcess()` call should have its
            // own session. So we don't wait on the last process to start the next process.
            enableDefaultSession: false,
        });

        const [initializeSandboxResult, {request, pingInterval}] = await runAllPromises([
            // Perform some initialization for the container. Like mounting a bucket and
            // setting up environment variables.
            captureResultPromise(
                span.withSpan("Initialize sandbox", async span => {
                    const {branch} = await sandbox.initialize();
                    span.addData({common: {branch}});
                }),
            ),

            (async () => {
                // We are intentionally using the parent span instead of the "Start sandbox
                // process" span. We'll root the Claude agent execution in the parent span.
                const tracerContext = span.getPropagationContext();
                // We create the new stream message immediately. Even before the sandbox
                // initializes. Since sandbox initialization can be expensive and we want to give
                // the user some immediate feedback that we're working on their request.
                //
                // An approval decision gets no message here — the container creates one only if it
                // decides to respond (see `ClaudeAgentServiceApprovalDecisionRequest`).
                if (event.type === "UpdatedMessageStreamExperimentalApprovalsPart") {
                    return {
                        pingInterval: null,
                        request: {
                            type: "ApprovalDecisionRequest",
                            body: {...requestBody, event},
                            tracerContext,
                        },
                    } as const;
                }
                const {
                    data: {message: streamMessage},
                } = await createApiMessage(span, apiClient, room, {
                    isStream: true,
                    content: {elements: []},
                    createdTimeZone: event.createdTimeZone,
                });

                // Keep the message stream alive while we're waiting on acknowledgement from the
                // sandbox. Once we get acknowledgement, then it's the sandbox's responsibility to
                // keep the message stream alive.
                //
                // It's important that the ping interval starts immediately and doesn't wait for
                // "Initialize sandbox" which can take a while.
                const pingInterval = createInterval(() => {
                    void pingApiMessageStream(span, apiClient, room, streamMessage.index);
                }, messageStreamPingIntervalMs);

                return {
                    request: {
                        type: "MessageRequest",
                        body: {...requestBody, event},
                        streamMessageIndex: assertExists(streamMessage).index,
                        tracerContext,
                    },
                    pingInterval,
                } as const;
            })(),
        ]);

        let errorContent: ApiContentRequest | null = null;

        try {
            // If initializing the sandbox fails, then we want to throw in this try/catch.
            unwrapResult(initializeSandboxResult);

            // Being really safe and encoding the event to base64 before passing it as a shell
            // argument to the sandbox. This way we avoid the possibility of shell injection
            // attacks. I couldn't find a shell escaper module I was 100% confident in.
            const requestArg = encodeBase64(new TextEncoder().encode(JSON.stringify(request)));

            const startProcessAndAcknowledgeEvent = async () => {
                const sandboxProcess = await span.withSpan("Start sandbox process", async () => {
                    return await sandbox.startProcess(
                        // eslint-disable-next-line cyberworlds/string-quotes
                        `node /workspace/claude_agent_service_bundle.mjs '${requestArg}'`,
                    );
                });

                // This function will reject if the process exits before the event is acknowledged.
                try {
                    await span.withSpan("Wait for sandbox to acknowledge event", () =>
                        // Either signal ends the wait: the container took the event, or it read its state
                        // and decided the event isn't actionable. Without the second case a legitimate
                        // no-op looks exactly like a crashed process.
                        sandboxProcess.waitForLog(
                            new RegExp(`(Acknowledged|Ignored) event ${requestBody.eventId}`),
                        ),
                    );
                } catch (error) {
                    // If we exited with code 3, that's a signal that the sandbox wrote the error
                    // content to `/workspace/error.json`. Read the file and use it as our error
                    // content.
                    if (
                        isObject(error) &&
                        isObject(error.errorResponse) &&
                        isObject(error.errorResponse.context) &&
                        error.errorResponse.context.exitCode === 3
                    ) {
                        const {content} = await sandbox.readFile("/workspace/error.json", {
                            encoding: "utf8",
                        });

                        errorContent = JSON.parse(content).content;
                    }

                    throw error;
                }
            };

            const promiseResolver = createPromiseResolver();
            const timeout = createTimeout(promiseResolver.resolve, 10 * 1000);

            let hasTimedOut = false;
            try {
                hasTimedOut = await Promise.race([
                    promiseResolver.promise.then(() => true),
                    startProcessAndAcknowledgeEvent().then(() => false),
                ]);
            } finally {
                timeout.clear();
            }

            // We give `startProcessAndAcknowledgeEvent()` 10 seconds. If it times out then we
            // assume there's a dead leader so we kill all processes in the sandbox and try
            // starting the process one more time.
            if (hasTimedOut) {
                await span.withSpan("Kill all sandbox processes", () => sandbox.killAllProcesses());

                await startProcessAndAcknowledgeEvent();
            }

            // Now it's the sandbox's responsibility to keep the message stream alive. The
            // sandbox should start a ping interval itself with
            pingInterval?.clear();
        } catch (error) {
            if (!span.isFinished()) {
                span.addException(error);
            } else {
                span.logException("Error after Claude webhook span finished", error);
            }

            // We're completing the message now with an error!
            pingInterval?.clear();

            // If there was an error before the sandbox acknowledged our event then it's our
            // responsibility to complete the stream with an error message. There may have been
            // content made available at `/workspace/error.json` and if there's nothing there
            // then we end up with the default error message.

            const content: ApiContentRequest = errorContent ?? {
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

            const messageIndex =
                request.type === "MessageRequest"
                    ? request.streamMessageIndex
                    : // NOTE(ifitzsimmons, 2026-08-18): Approval decisions don't get new messages from
                      // AgentV2Service. Instead,the container creates one, but only after it
                      // acknowledges. Reaching here means we never _saw_ an acknowledgement, which isn't
                      // the same as none happening. The 10s timeout above kills the sandbox's processes,
                      // and one may have acknowledged and created its message just before we did.
                      //
                      // So the worst case here is that, very rarely, we'll create two messages for the
                      // same approval decision event, and at least one of them (this one) will report an
                      // error.
                      (
                          await createApiMessage(span, apiClient, room, {
                              isStream: true,
                              content: {elements: []},
                          })
                      ).data.message.index;

            await createApiMessageStreamPart(span, apiClient, room, messageIndex, {
                payload: {type: "Content", content},
            });

            await completeApiMessageStream(span, apiClient, room, messageIndex);
        }
    })();

    {
        // We need to respond to Alpine within 10 seconds or else Alpine will retry the
        // webhook. So wait 8 seconds and then if the message hasn't been acknowledged in
        // that time it probably means the agent is working. So finish the webhook request
        // and register `evaluationContext.waitUntil()` to have Cloudflare wait for 30 more
        // seconds.
        const promiseResolver = createPromiseResolver();
        const timeout = createTimeout(promiseResolver.resolve, 8 * 1000);

        try {
            await Promise.race([promiseResolver.promise, promise]);
        } finally {
            timeout.clear();
        }

        // Wait on `promise` to complete for 30 more seconds. This should be enough time to
        // spin up the container and start running Claude.
        evaluationContext.waitUntil(promise);
    }

    return createSimpleOkResponse();
}
