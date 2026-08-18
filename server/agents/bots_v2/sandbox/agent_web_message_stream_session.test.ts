import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebMessageStreamSession} from "~/server/agents/bots_v2/sandbox/agent_web_message_stream_session.js";
import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {printErrorDisplayMessageToApiContent} from "~/shared/api/content/print_error_display_message_to_api_content.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.open_source.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const apiClient = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(generateId<SpaceId>());
const chatId = generateId<ChatId>();
const messageIndex = 1;
const {span} = testTracer.getRoot().startSpan("test-span");

test("throws a terminal agent-facing error after a stream update fails", async () => {
    const streamError = new InternalError("Failed to update message stream");

    apiClient.spy("POST", "/chats/{id}/messages/{index}/stream/parts");
    apiClient.spy("PUT", "/chats/{id}/messages/{index}/stream/completion");
    apiClient.mockPut("/chats/{id}/messages/{index}/stream/parts/{partIndex}", {
        params: "Any",
        error: streamError,
    });

    const session = new AgentWebMessageStreamSession({
        parentSpan: span,
        apiClient,
        room: {type: "Chat", id: chatId},
        messageIndex,
        streamParser: new AgentWebMarkdownStreamParser({storage, documentId: null}),
    });

    session.pushReasoningSummary(span, "Reasoning summary");
    await waitMacrotask();

    let pushError: unknown;
    try {
        session.pushText(span, "Response text");
    } catch (error) {
        pushError = error;
    }

    expect(pushError).toMatchObject({
        message: "Can\u2019t continue after a terminal message stream error",
        cause: streamError,
        displayMessage: [{type: "Text", text: "An unexpected error occurred."}],
    });
    await session.complete(span);
    expect(apiClient.getRequestHistory().slice(-2)).toMatchObject([
        {
            method: "POST",
            path: "/chats/{id}/messages/{index}/stream/parts",
            body: {
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "I couldn\u2019t generate a response. "},
                                    ...printErrorDisplayMessageToApiContent(
                                        defaultErrorDisplayMessage,
                                    ),
                                ],
                            },
                        ],
                    },
                },
            },
        },
        {
            method: "PUT",
            path: "/chats/{id}/messages/{index}/stream/completion",
        },
    ]);
});
