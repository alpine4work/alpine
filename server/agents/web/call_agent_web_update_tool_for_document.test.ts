import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {mockApiGetDocument} from "~/server/agents/api/test_helpers/mock_api_get_document.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {printAgentWebPageStoredLinkPathname} from "~/server/agents/web/agent_web_page_stored_link.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiContentResponse,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    BotId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_update_tool_document.test.ts");
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

afterEach(() => {
    import.meta.jest.useRealTimers();
});

function createDocumentContentFromMarkdown(markdown: string): ApiContentResponse {
    return addKeysToApiContentForTest(
        parseApiContentFromMarkdown(markdown) as ApiContentResponseWithoutKeys,
    );
}

function createDocumentContentWithoutKeysFromMarkdown(
    markdown: string,
): ApiContentResponseWithoutKeys {
    return parseApiContentFromMarkdown(markdown) as ApiContentResponseWithoutKeys;
}

async function seedDocumentPathViaPrint(documentId: DocumentId, title: string): Promise<string> {
    const content: ApiContentResponse = addKeysToApiContentForTest({
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
    });

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
    mockApiGetDocument(api, {
        spaceId,
        documentId,
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
        api.mockPatch("/documents/{id}", {
            params: {path: {id: documentId}},
            data: {
                document: {
                    id: documentId,
                    version,
                    title: "ignored",
                    content: createDocumentContentFromMarkdown("ignored"),
                },
                spaceId,
            },
        } as any);
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

function expectLastDocumentPatchContent(content: ApiContentResponseWithoutKeys) {
    const patchRequests = getDocumentPatchRequests();
    const lastPatchRequest = patchRequests[patchRequests.length - 1] as any;

    expect(lastPatchRequest.body.patches[1].content).toEqual(content);
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/main-title`. A title is required for documents. Try again but make sure the document starts with a markdown h1 (e.g. `# My Document`).",
    );

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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/main-title`. A document can only have one markdown h1 (e.g. `# My Document`) and the h1 must be placed at the start of the document. You added an additional markdown h1 \u201CExtra\u201D. Try again but remove the additional markdown h1 or make it an h2 (e.g. `## My Sub-heading`).",
    );

    const after = await readFull(path);
    expect(after).toEqual(before);
    expect(getDocumentPatchRequests()).toHaveLength(0);
});

test("unseen comment ids in document updates are rejected", async () => {
    const {path} = await setupDocument({
        title: "Comment Guard",
        bodyMarkdown: "Review this section.",
    });

    const before = await readFull(path);
    const patchRequestCount = getDocumentPatchRequests().length;

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: "Review this section.",
                    new: '<comment id="1">Review this section.</comment>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t update \`${path}\`. ` +
            ("Can only create a new comment thread by using the `create` tool with type " +
                '`document-thread`. Can\u2019t create a new comment by adding `<comment id="1">` ' +
                "to the document. Try again by calling the `create` tool with a `type` of " +
                "`document-thread` and a `<blockquote>` containing the exact content you want to " +
                "leave a comment on (an `id` for the comment thread will be assigned automatically)."),
    );

    const after = await readFull(path);
    expect(after).toEqual(before);
    expect(getDocumentPatchRequests()).toHaveLength(patchRequestCount);
});

test("can add another reference to an existing comment id", async () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const {documentId, path} = await setupDocument({
        title: "Existing Comment",
        bodyMarkdown: `<comment id="${commentThreadId}">Alpha</comment>\n\nBeta`,
    });

    const patchRequestCount = getDocumentPatchRequests().length;
    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "Beta",
                new: '<comment id="1">Beta</comment>',
                replaceAll: false,
            },
        ],
    });

    expect(getDocumentPatchRequests()).toHaveLength(patchRequestCount + 1);
    expectLastDocumentPatchContent(
        createDocumentContentWithoutKeysFromMarkdown(
            `<comment id="${commentThreadId}">Alpha</comment>\n\n` +
                `<comment id="${commentThreadId}">Beta</comment>`,
        ),
    );
});

test("can move an existing comment id from one location to another", async () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const {documentId, path} = await setupDocument({
        title: "Move Comment",
        bodyMarkdown: `<comment id="${commentThreadId}">Alpha</comment>\n\nBeta`,
    });

    const patchRequestCount = getDocumentPatchRequests().length;
    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: '<comment id="1">Alpha</comment>\n\nBeta',
                new: 'Alpha\n\n<comment id="1">Beta</comment>',
                replaceAll: false,
            },
        ],
    });

    expect(getDocumentPatchRequests()).toHaveLength(patchRequestCount + 1);
    expectLastDocumentPatchContent(
        createDocumentContentWithoutKeysFromMarkdown(
            `Alpha\n\n<comment id="${commentThreadId}">Beta</comment>`,
        ),
    );
});

test("rejects new comment ids when existing comment ids are valid", async () => {
    const commentThreadId = generateId<DocumentCommentThreadId>();
    const {path} = await setupDocument({
        title: "Mixed Comments",
        bodyMarkdown: `<comment id="${commentThreadId}">Alpha</comment>\n\nBeta`,
    });

    const before = await readFull(path);
    const patchRequestCount = getDocumentPatchRequests().length;

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: "Beta",
                    new: '<comment id="2">Beta</comment>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t update \`${path}\`. ` +
            ("Can only create a new comment thread by using the `create` tool with type " +
                '`document-thread`. Can\u2019t create a new comment by adding `<comment id="2">` ' +
                "to the document. Try again by calling the `create` tool with a `type` of " +
                "`document-thread` and a `<blockquote>` containing the exact content you want to " +
                "leave a comment on (an `id` for the comment thread will be assigned automatically)."),
    );

    const after = await readFull(path);
    expect(after).toEqual(before);
    expect(getDocumentPatchRequests()).toHaveLength(patchRequestCount);
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
    expect((patchRequests[0] as any).body.patches[0].version).toBe(1);
    expect((patchRequests[1] as any).body.patches[0].version).toBe(2);
});
