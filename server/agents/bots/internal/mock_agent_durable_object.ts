import {
    completeApiMessageStream,
    createApiMessage,
    pingApiMessageStream,
    putApiMessageStreamPart,
} from "~/server/agents/api/api_client.js";
import {
    AgentContext,
    AgentDurableObjectBase,
    AgentWebhookRequest,
} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {AgentServiceEnv} from "~/server/agents/bots/internal/agent_service_env.js";
import {DurableObjectStorageCollection} from "~/server/cloudflare/durable_object_storage_collection.js";
import {shouldAgentRespondToRequest} from "~/server/agents/bots/internal/should_agent_respond_to_request.js";
import {MockAgentRecording} from "~/shared/agents/mock_agent_recording.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

// The `/webhook` route is shared across all agents and parsed/handled in
// `AgentDurableObjectBase`.
type MockAgentRoute = "NotFound" | "Recording";

const MockAgentRecordingCollection = new DurableObjectStorageCollection<"", MockAgentRecording>(
    "Zz",
);

abstract class MockAgentDurableObjectBase extends AgentDurableObjectBase<MockAgentRoute, never> {
    constructor(state: DurableObjectState, env: AgentServiceEnv) {
        super("MockAgentService", state, env);

        // Can only run this durable object in test or development environments.
        assert(process.env.NODE_ENV !== "production");
    }

    protected override _parseRoute(url: URL): [string, MockAgentRoute] {
        if (url.pathname === "/recording") {
            return ["/recording", "Recording"];
        }

        return ["/*", "NotFound"];
    }

    protected override async _fetch(
        context: AgentContext,
        request: Request,
        route: MockAgentRoute,
    ): Promise<Response> {
        switch (route) {
            case "Recording": {
                return await this._fetchRecording(context, request);
            }
            case "NotFound": {
                return new Response("404 Not Found", {
                    status: 404,
                    headers: {"content-type": "text/plain"},
                });
            }
            default:
                throw exhaustive(route);
        }
    }

    protected override async _event(tracer: TracerBase, event: never): Promise<void> {
        cast<never>(event);

        throw new UnimplementedError("Mock agent has no scheduled events");
    }

    private async _fetchRecording(context: AgentContext, request: Request): Promise<Response> {
        // May only call this route in test and development environments.
        assert(process.env.NODE_ENV !== "production");

        if (request.method !== "PUT") {
            return new Response("405 Method Not Allowed", {
                status: 405,
                headers: {"content-type": "text/plain"},
            });
        }

        const recording: MockAgentRecording = await request.json();

        await MockAgentRecordingCollection.put(this._state.storage, "", recording);

        return new Response(null, {status: 200});
    }

    public override async webhook(tracer: TracerBase, request: AgentWebhookRequest) {
        // May only play a the recording in test and development environments.
        assert(process.env.NODE_ENV !== "production");

        // Mirror the real agent's response policy so the mock behaves the same in a 1:1
        // chat with the bot — where users don't typically @-mention — as the production
        // ChatGPT agent does.
        if (!(await shouldAgentRespondToRequest(tracer, request))) return;

        let recording =
            (await MockAgentRecordingCollection.get(this._state.storage, "")) ?? emptyArray;

        const {
            data: {message},
        } = await createApiMessage(tracer, request.apiClient, request.room, {
            isStream: true,
            content: {elements: []},
            createdTimeZone: defaultTimeZone,
        });

        // If there is no recording, use a default recording with an error message.
        if (recording.length === 0) {
            recording = [
                {
                    type: "PutPart",
                    index: 0,
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "No recording found for this messaging room.",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            ];
        }

        for (const action of recording) {
            switch (action.type) {
                case "Wait": {
                    await wait(action.milliseconds);
                    break;
                }
                case "Ping": {
                    await pingApiMessageStream(
                        tracer,
                        request.apiClient,
                        request.room,
                        message.index,
                    );
                    break;
                }
                case "PutPart": {
                    await putApiMessageStreamPart(
                        tracer,
                        request.apiClient,
                        request.room,
                        message.index,
                        action.index,
                        {payload: action.payload},
                    );
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        }

        await completeApiMessageStream(tracer, request.apiClient, request.room, message.index);
    }
}

export class MockChatGptAgentDurableObject extends MockAgentDurableObjectBase {
    protected override _getApiKey() {
        return assertExists(
            this._env.MOCK_CHAT_GPT_API_SERVICE_KEY,
            "Missing `MOCK_CHAT_GPT_API_SERVICE_KEY` environment variable",
        );
    }
}

export class MockCursorAgentDurableObject extends MockAgentDurableObjectBase {
    protected override _getApiKey() {
        return assertExists(
            this._env.MOCK_CURSOR_API_SERVICE_KEY,
            "Missing `MOCK_CURSOR_API_SERVICE_KEY` environment variable",
        );
    }
}
