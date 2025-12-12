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
} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentServiceEnv} from "~/server/agents/internal/agent_service_env.js";
import {DurableObjectStorageCollection} from "~/server/agents/internal/durable_object_storage_collection.js";
import {MockAgentRecording} from "~/shared/agents/mock_agent_recording.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type MockAgentRoute = "NotFound" | "Recording";

const MockAgentRecordingCollection = new DurableObjectStorageCollection<"", MockAgentRecording>(
    "Zz",
);

export class MockAgentDurableObject extends AgentDurableObjectBase<MockAgentRoute> {
    // We store the mock agent's recording in the durable object's storage. We don't
    // want to delete it after 6 hours of inactivity, that would break any scenarios
    // environments that use `MockAgentDurableObject`.
    protected override readonly _withoutStorageTimeToLiveForTest = false;

    constructor(state: DurableObjectState, env: AgentServiceEnv) {
        super("MockAgentService", state, env);

        // Can only run this durable object in test or development environments.
        assert(process.env.NODE_ENV !== "production");
    }

    protected override _getApiKey() {
        return assertExists(
            this._env.MOCK_CHAT_GPT_API_SERVICE_KEY,
            "Missing `MOCK_CHAT_GPT_API_SERVICE_KEY` environment variable",
        );
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
        if (route === "Recording") {
            return this._fetchRecording(context, request);
        }

        return new Response("404 Not Found", {
            status: 404,
            headers: {"content-type": "text/plain"},
        });
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

        await MockAgentRecordingCollection.put(this.getStorage(), "", recording);

        return new Response(null, {status: 200});
    }

    protected override async _webhook(tracer: TracerBase, request: AgentWebhookRequest) {
        // May only play a the recording in test and development environments.
        assert(process.env.NODE_ENV !== "production");

        // Only respond with recording if mentioned. Otherwise noop.
        if (!request.event.wasMentioned) return;

        let recording =
            (await MockAgentRecordingCollection.get(this.getStorage(), "")) ?? emptyArray;

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
