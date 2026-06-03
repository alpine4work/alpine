import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {printAgentWebPageStoredLinkPathname} from "~/server/agents/web/agent_web_page_stored_link.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_update_tool_document.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);
const context: AgentWebContext = {spaceId, api, storage, span};

afterEach(() => {
    import.meta.jest.useRealTimers();
});

function createDocumentContentFromMarkdown(markdown: string): ApiContentResponse {
    return parseApiContentFromMarkdown(markdown, {spaceId}) as ApiContentResponse;
}

async function seedDocumentPathViaPrint(documentId: DocumentId, title: string): Promise<string> {
    const content: ApiContentResponse = {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "See "},
                    {
                        type: "Mention",
                        reference: {
                            type: "Document",
                            id: documentId,
                            title,
                        },
                    } as any,
                    {type: "Text", text: "."},
                ],
            },
        ],
    };

    await printApiContentToAgentWebMarkdown(context.storage, content);

    return printAgentWebPageStoredLinkPathname({type: "Document", id: documentId, title}, 1);
}

async function seedReadCacheViaRead({
    documentId,
    title,
    bodyMarkdown,
    path,
    version = 1,
}: {
    documentId: DocumentId;
    title: string;
    bodyMarkdown: string;
    path: string;
    version?: number;
}) {
    api.mockGetDocument(spaceId, documentId, {
        title,
        version,
        content: createDocumentContentFromMarkdown(bodyMarkdown),
    });

    await callAgentWebReadTool(context, {path, limit: "10kb"});
}

async function setupDocument({
    title,
    bodyMarkdown,
    version = 1,
    readPath,
}: {
    title: string;
    bodyMarkdown: string;
    version?: number;
    readPath?: string;
}) {
    const documentId = generateId<DocumentId>();
    const path = await seedDocumentPathViaPrint(documentId, title);

    await seedReadCacheViaRead({
        documentId,
        title,
        bodyMarkdown,
        path: readPath ?? path,
        version,
    });

    return {documentId, path};
}

function mockDocumentPatch(documentId: DocumentId, ...versions: ReadonlyArray<number>) {
    for (const version of versions) {
        api.mockPatch(
            "/documents/{id}",
            {
                data: {
                    document: {
                        id: documentId,
                        version,
                        title: "ignored",
                        content: createDocumentContentFromMarkdown("ignored"),
                    },
                    spaceId,
                },
            } as any,
            {path: {id: documentId}},
        );
    }
}

function getDocumentPatchRequests() {
    return api
        .getRequestHistory()
        .filter(record => record.method === "PATCH" && record.path === "/documents/{id}");
}

function stripEndOfFileSuffix(response: string): string {
    expect(response).toContain("(End of file.");
    return response.replace(/\n\n\(End of file\.[\s\S]*\)$/, "");
}

async function readFull(path: string): Promise<string> {
    const response = await callAgentWebScrollTool(context, {
        path,
        offset: 1,
        limit: "200kb",
    });

    return stripEndOfFileSuffix(response);
}

test("parse failure for missing title bubbles and keeps cache unchanged", async () => {
    const {path} = await setupDocument({
        title: "Main Title",
        bodyMarkdown: "Body text.",
    });

    const before = await readFull(path);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "# Main Title", new: "Main Title", replaceAll: false}],
        }),
    ).rejects.toThrow("Missing title in document");

    const after = await readFull(path);
    expect(after).toEqual(before);
    expect(getDocumentPatchRequests()).toHaveLength(0);
});

test("parse failure for second h1 bubbles and keeps cache unchanged", async () => {
    const {path} = await setupDocument({
        title: "Main Title",
        bodyMarkdown: "Body text.",
    });

    const before = await readFull(path);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "Body text.", new: "# Extra\n\nBody text.", replaceAll: false}],
        }),
    ).rejects.toThrow("Documents can only have a single heading level 1");

    const after = await readFull(path);
    expect(after).toEqual(before);
    expect(getDocumentPatchRequests()).toHaveLength(0);
});

test("uses updated version from first update as precondition for second update", async () => {
    const {documentId, path} = await setupDocument({
        title: "Version Inference",
        bodyMarkdown: "one two",
        version: 1,
    });

    mockDocumentPatch(documentId, 2, 3);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "two", new: "three", replaceAll: false}],
    });

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "three", new: "four", replaceAll: false}],
    });

    const patchRequests = getDocumentPatchRequests();

    expect(patchRequests).toHaveLength(2);
    expect((patchRequests[0] as any).body.document.version).toBe(1);
    expect((patchRequests[1] as any).body.document.version).toBe(2);
});
