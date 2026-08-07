import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiContentResponse,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
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
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
            },
        ],
    });
}

function createEmptyDocumentContentWithKeys(): ApiContentResponse {
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [],
            },
        ],
    });
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
        params: "Any",
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
        "Create was successful. New document: [API Created Document](/document/api-created-document).",
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

test("rejects comment marks when creating a document", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "document",
            content: `\
# Commented Document

<comment id="1">Review this section.</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document. Can\u2019t create `<comment>`s while creating a " +
            "document. " +
            "First create the document " +
            "without comments and then add the `<comment>`s in after.",
    );
    expect(api.getCallCount("POST", "/documents")).toBe(0);
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
        "Create was successful. New document: [Untitled](/document/untitled).",
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
