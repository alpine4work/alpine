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
    ApiContent,
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

    // TODO(#claude-bot): Approvals
    if (requestBody.event.type !== "CreatedMessage" && requestBody.event.type !== "CreatedPost") {
        span.addData({common: {branch: "IgnoredEvent"}});

        return createSimpleOkResponse();
    }

    const {accessToken, botAccount, event} = requestBody;

    const apiClient = createApiClient({
        baseUrl: assertExists(env.API_SERVICE_URL),
        apiKey: assertExists(env.CLAUDE_API_SERVICE_KEY),
        accessToken,
    });

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

    span.addData({common: {branch: "Responding"}});

    const promise = (async () => {
        const {room} = event;
        const sandboxId = `${botAccount.id}/${convertApiReferenceKeyToLowercase(printApiReferenceKey(room))}`;

        const sandbox = getSandbox(env.ClaudeAgentSandbox, sandboxId, {
            // In order to support steering, each `sandbox.startProcess()` call should have its
            // own session. So we don't wait on the last process to start the next process.
            enableDefaultSession: false,
        });

        const [initializeSandboxResult, {streamMessage, pingInterval}] = await runAllPromises([
            // Perform some initialization for the container. Like mounting a bucket and
            // setting up environment variables.
            captureResultPromise(
                span.withSpan("Initialize sandbox", async span => {
                    const {branch} = await sandbox.initialize();
                    span.addData({common: {branch}});
                }),
            ),

            // We create the new stream message immediately. Even before the sandbox
            // initializes. Since sandbox initialization can be expensive and we want to give
            // the user some immediate feedback that we're working on their request.
            (async () => {
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

                return {streamMessage, pingInterval};
            })(),
        ]);

        let errorContent: ApiContent | null = null;

        try {
            // If initializing the sandbox fails, then we want to throw in this try/catch.
            unwrapResult(initializeSandboxResult);

            // Being really safe and encoding the event to base64 before passing it as a shell
            // argument to the sandbox. This way we avoid the possibility of shell injection
            // attacks. I couldn't find a shell escaper module I was 100% confident in.
            const requestArg = encodeBase64(
                new TextEncoder().encode(
                    JSON.stringify({
                        body: requestBody,
                        streamMessageIndex: streamMessage.index,
                        // We are intentionally using the parent span instead of the "Start sandbox
                        // process" span. We'll root the Claude agent execution in the parent span.
                        tracerContext: span.getPropagationContext(),
                    }),
                ),
            );

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
                        sandboxProcess.waitForLog(`Acknowledged event ${requestBody.eventId}`),
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
            pingInterval.clear();
        } catch (error) {
            if (!span.isFinished()) {
                span.addException(error);
            } else {
                span.logException("Error after Claude webhook span finished", error);
            }

            // We're completing the message now with an error!
            pingInterval.clear();

            // If there was an error before the sandbox acknowledged our event then it's our
            // responsibility to complete the stream with an error message. There may have been
            // content made available at `/workspace/error.json` and if there's nothing there
            // then we end up with the default error message.

            const content: ApiContent = errorContent ?? {
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

            await createApiMessageStreamPart(span, apiClient, room, streamMessage.index, {
                payload: {type: "Content", content},
            });

            await completeApiMessageStream(span, apiClient, room, streamMessage.index);
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
