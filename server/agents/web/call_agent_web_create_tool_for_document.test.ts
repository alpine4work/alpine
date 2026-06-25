import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_create_tool.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

function createDocumentContentFromText(text: string): ApiContentResponseWithoutKeys {
    return {elements: [{type: "Paragraph", elements: [{type: "Text", text}]}]};
}

function createEmptyDocumentContent(): ApiContentResponseWithoutKeys {
    return {elements: [{type: "Paragraph", elements: []}]};
}

function createDocumentContentFromTextWithKeys(text: string): ApiContentResponse {
    return {
        elements: [
            {
                type: "Paragraph",
                key: new ApiContentKeyEncoder({entityId: "Test", version: 0}).encode({
                    pos: 0,
                    nodeSize: text.length + 2,
                }),
                elements: [{type: "Text", text}],
            },
        ],
    };
}

function createEmptyDocumentContentWithKeys(): ApiContentResponse {
    return {
        elements: [
            {
                type: "Paragraph",
                key: new ApiContentKeyEncoder({entityId: "Test", version: 0}).encode({
                    pos: 0,
                    nodeSize: 2,
                }),
                elements: [],
            },
        ],
    };
}

function mockCreateDocument({
    id = generateId<DocumentId>(),
    title,
    content,
    version = 1,
}: {
    id?: DocumentId;
    title: string;
    content: ApiContentResponse;
    version?: number;
}): DocumentId {
    api.mockPost("/documents", {
        data: {
            spaceId,
            document: {
                id,
                title,
                content,
                version,
            },
        },
    });

    return id;
}

test("calls the documents API with parsed document content", async () => {
    const documentId = generateId<DocumentId>();

    mockCreateDocument({
        id: documentId,
        title: "API Created Document",
        content: createDocumentContentFromTextWithKeys("Initial body paragraph."),
        version: 7,
    });

    const responseString = await callAgentWebCreateTool(context, {
        type: "document",
        content: `\
# API Created Document

Initial body paragraph.`,
    });

    expect(responseString).toEqual(
        "Create was successful. New document: [API Created Document](/document/api-created-document).\n",
    );
    expect(api.getCallCount("POST", "/documents")).toBe(1);
    expect(api.getRequestHistory()[0]).toMatchObject({
        method: "POST",
        path: "/documents",
        body: {
            spaceId,
            document: {
                title: "API Created Document",
                content: createDocumentContentFromText("Initial body paragraph."),
            },
        },
    });
});

test("creates a document with an empty title", async () => {
    const documentId = generateId<DocumentId>();

    mockCreateDocument({
        id: documentId,
        title: "",
        content: createEmptyDocumentContentWithKeys(),
    });

    const responseString = await callAgentWebCreateTool(context, {
        type: "document",
        content: "#",
    });

    expect(responseString).toEqual(
        "Create was successful. New document: [Untitled](/document/untitled).\n",
    );
    expect(api.getCallCount("POST", "/documents")).toBe(1);
    expect(api.getRequestHistory()[0]).toMatchObject({
        method: "POST",
        path: "/documents",
        body: {
            spaceId,
            document: {
                title: "",
                content: createEmptyDocumentContent(),
            },
        },
    });
});
