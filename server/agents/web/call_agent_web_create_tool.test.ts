import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {printAgentWebPageLinkKey} from "~/server/agents/web/agent_web_page_link_key.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {callAgentWebFindTool} from "~/server/agents/web/call_agent_web_find_tool.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_create_tool.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);
const context: AgentWebContext = {spaceId, api, storage, span};

function createDocumentContentFromText(text: string): ApiContentResponse {
    return {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
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

function getCreatedPathname(responseString: string): string {
    const match = /\]\(([^)]+)\)/.exec(responseString);

    return assertExists(match?.[1]);
}

test("calls the documents API with parsed document content", async () => {
    const documentId = generateId<DocumentId>();
    const content = createDocumentContentFromText("Initial body paragraph.");

    mockCreateDocument({
        id: documentId,
        title: "API Created Document",
        content,
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
                content,
            },
        },
    });
});

test.each([
    "doc",
    "Doc",
    "DOC",
    "docs",
    "Docs",
    "DOCS",
    "document",
    "Document",
    "DOCUMENT",
    "documents",
    "Documents",
    "DOCUMENTS",
])("supports `%s` as a document type", async type => {
    const content = createDocumentContentFromText(`Created with type ${type}.`);

    mockCreateDocument({
        title: "Alias Support",
        content,
    });

    const responseString = await callAgentWebCreateTool(context, {
        type,
        content: `\
# Alias Support

Created with type ${type}.`,
    });

    expect(responseString).toEqual(
        "Create was successful. New document: [Alias Support](/document/alias-support).\n",
    );
    expect(api.getCallCount("POST", "/documents")).toBe(1);
});

test("deduplicates the created document pathname from existing pathnames", async () => {
    const existingDocumentId = generateId<DocumentId>();
    const documentId = generateId<DocumentId>();
    const content = createDocumentContentFromText("Created after a pathname collision.");

    await context.storage.pageLinkByPathname.put("/document/product-spec", {
        type: "Document",
        id: existingDocumentId,
        title: "Product Spec",
    });

    mockCreateDocument({
        id: documentId,
        title: "Product Spec",
        content,
    });

    const responseString = await callAgentWebCreateTool(context, {
        type: "document",
        content: `\
# Product Spec

Created after a pathname collision.`,
    });

    expect(responseString).toEqual(
        "Create was successful. New document: [Product Spec](/document/product-spec-2).\n",
    );
    expect(await context.storage.pageLinkByPathname.get("/document/product-spec")).toEqual({
        type: "Document",
        id: existingDocumentId,
        title: "Product Spec",
    });
    expect(await context.storage.pageLinkByPathname.get("/document/product-spec-2")).toEqual({
        type: "Document",
        id: documentId,
        title: "Product Spec",
    });
    expect(
        await context.storage.latestPageLinkPathnameByKey.get(
            printAgentWebPageLinkKey({type: "Document", id: documentId}),
        ),
    ).toBe("/document/product-spec-2");
});

test("makes created content available to scroll and find tools", async () => {
    const content = createDocumentContentFromText("First paragraph before the blank line.");

    mockCreateDocument({
        title: "Tool Usable Document",
        content,
    });

    const createResponseString = await callAgentWebCreateTool(context, {
        type: "document",
        content: `\
# Tool Usable Document

First paragraph before the blank line.

Second paragraph contains target needle.

Third paragraph after the match.`,
    });

    const path = getCreatedPathname(createResponseString);
    const scrollResponseString = await callAgentWebScrollTool(context, {
        path,
        offset: 4,
        limit: "1kb",
    });
    const findResponseString = await callAgentWebFindTool(context, {
        path,
        pattern: "target needle",
        offset: 0,
        limit: 5,
        matchLimit: "80b",
    });

    expect(scrollResponseString).toEqual(`\
Second paragraph contains target needle.

Third paragraph after the match.

(End of file. Showing lines 5-7 of 7.)`);
    expect(findResponseString).toEqual(`\
Found 1 match.

<match>

Second paragraph contains target needle.

Third paragraph after the match.

(Showing lines 5-7.)

</match>
`);
});

test("throws for unsupported create types before calling the API", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "spreadsheet",
            content: `\
# Unsupported

Body.`,
        }),
    ).rejects.toThrow(InvalidArgumentError);

    expect(api.getCallCount("POST", "/documents")).toBe(0);
});
