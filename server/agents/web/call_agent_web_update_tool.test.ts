// NOTE: We mostly use documents in this file to test general
// `callAgentWebUpdateTool()` behavior. For document-specific tests see
// `server/agents/web/call_agent_web_update_tool_document.test.ts`.

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
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_update_tool.test.ts");
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

test("throws on empty updates", async () => {
    await expect(
        callAgentWebUpdateTool(context, {path: "/document/anything", updates: []}),
    ).rejects.toThrow("Assertion failure");
});

test("throws NotFoundError when no cached read response exists", async () => {
    await expect(
        callAgentWebUpdateTool(context, {
            path: "/document/missing",
            updates: [{old: "a", new: "b", replaceAll: false}],
        }),
    ).rejects.toThrow(NotFoundError);
});

test("throws NotFoundError when cached read response is expired", async () => {
    import.meta.jest.useFakeTimers();

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    import.meta.jest.setSystemTime(t0);

    const {path} = await setupDocument({
        title: "Expired Update",
        bodyMarkdown: "Alpha",
    });

    import.meta.jest.setSystemTime(new Date(t0.getTime() + 61 * 60 * 1000));

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "Alpha", new: "Beta", replaceAll: false}],
        }),
    ).rejects.toThrow(NotFoundError);
});

test("throws InvalidArgumentError when old and new are equal", async () => {
    const {path} = await setupDocument({
        title: "Equal Strings",
        bodyMarkdown: "Alpha",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "Alpha", new: "Alpha", replaceAll: false}],
        }),
    ).rejects.toThrow(InvalidArgumentError);
});

test("throws InvalidArgumentError when old string is empty", async () => {
    const {path} = await setupDocument({
        title: "Empty Old String",
        bodyMarkdown: "Alpha",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "", new: "Beta", replaceAll: false}],
        }),
    ).rejects.toThrow(InvalidArgumentError);
});

test("throws for no match when replaceAll is false", async () => {
    const {path} = await setupDocument({
        title: "No Match",
        bodyMarkdown: "Alpha",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "Missing", new: "Beta", replaceAll: false}],
        }),
    ).rejects.toThrow("Couldn\u2019t find a match for the old string");
});

test("throws for multiple matches when replaceAll is false", async () => {
    const {path} = await setupDocument({
        title: "Multiple Matches",
        bodyMarkdown: "repeat repeat",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "repeat", new: "done", replaceAll: false}],
        }),
    ).rejects.toThrow(FailedPreconditionError);
});

test("updates exactly one match when replaceAll is false", async () => {
    const {documentId, path} = await setupDocument({
        title: "Single Match",
        bodyMarkdown: "first second",
    });

    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "second", new: "third", replaceAll: false}],
    });

    const response = await readFull(path);
    expect(response).toContain("first third");
    expect(getDocumentPatchRequests()).toHaveLength(1);
});

test("replaceAll true with multiple expanding matches updates every match", async () => {
    const {documentId, path} = await setupDocument({
        title: "Expand Replace",
        bodyMarkdown: "aa aa aa",
    });

    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "aa", new: "aaaa", replaceAll: true}],
    });

    const response = await readFull(path);
    expect(response).toContain("aaaa aaaa aaaa");
    expect(getDocumentPatchRequests()).toHaveLength(1);
});

test("replaceAll true with multiple shrinking matches updates every match", async () => {
    const {documentId, path} = await setupDocument({
        title: "Shrink Replace",
        bodyMarkdown: "aaaa aaaa",
    });

    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "aaaa", new: "a", replaceAll: true}],
    });

    const response = await readFull(path);
    expect(response).toContain("a a");
    expect(getDocumentPatchRequests()).toHaveLength(1);
});

test("replaceAll true with zero matches throws and keeps cached content unchanged", async () => {
    const {path} = await setupDocument({
        title: "Replace All No Match",
        bodyMarkdown: "Alpha",
    });

    const before = await readFull(path);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "Missing", new: "Beta", replaceAll: true}],
        }),
    ).rejects.toThrow("Couldn\u2019t find a match for the old string");

    const after = await readFull(path);
    expect(after).toEqual(before);
    expect(getDocumentPatchRequests()).toHaveLength(0);
});

test("replaceAll true with one match succeeds and updates cached content", async () => {
    const {documentId, path} = await setupDocument({
        title: "Replace All One Match",
        bodyMarkdown: "only once",
    });

    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "once", new: "NOW", replaceAll: true}],
    });

    const response = await readFull(path);
    expect(response).toContain("only NOW");
    expect(getDocumentPatchRequests()).toHaveLength(1);
});

test("applies updates sequentially in one call", async () => {
    const {documentId, path} = await setupDocument({
        title: "Sequential Updates",
        bodyMarkdown: "alpha beta gamma",
    });

    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {old: "alpha", new: "alpha2", replaceAll: false},
            {old: "alpha2 beta", new: "X", replaceAll: false},
        ],
    });

    const response = await readFull(path);
    expect(response).toContain("X gamma");
});

test("uses non-overlapping replacement semantics", async () => {
    const {documentId, path} = await setupDocument({
        title: "Overlapping",
        bodyMarkdown: "aaaa",
    });

    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "aa", new: "b", replaceAll: true}],
    });

    const response = await readFull(path);
    expect(response).toContain("bb");
});

test("handles UTF-8 multibyte replacements", async () => {
    const {documentId, path} = await setupDocument({
        title: "Unicode",
        bodyMarkdown: "I like 🧪 and café",
    });

    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "🧪 and café", new: "🚀 and naïve", replaceAll: false}],
    });

    const response = await readFull(path);
    expect(response).toContain("I like 🚀 and naïve");
});

test("normalizes path during update lookup", async () => {
    const title = "Path Normalized Update";
    const documentId = generateId<DocumentId>();
    const path = await seedDocumentPathViaPrint(documentId, title);

    await seedReadCacheViaRead({
        documentId,
        title,
        bodyMarkdown: "Only once",
        path: `${path}?a=1&b=2#ignored`,
    });

    mockDocumentPatch(documentId, 2);

    await callAgentWebUpdateTool(context, {
        path: `${path.slice(1)}?a=1&b=2#tail`,
        updates: [{old: "Only once", new: "Updated", replaceAll: false}],
    });

    const response = await readFull(`${path}?a=1&b=2`);
    expect(response).toContain("Updated");
});

test("api patch failure bubbles unchanged and keeps cache unchanged", async () => {
    const {path} = await setupDocument({
        title: "PATCH Failure",
        bodyMarkdown: "Body text.",
    });

    const before = await readFull(path);
    const patchError = new FailedPreconditionError("PATCH failed");
    const originalPatch = api.patch;

    api.patch = async () => {
        throw patchError;
    };

    try {
        await expect(
            callAgentWebUpdateTool(context, {
                path,
                updates: [{old: "Body text.", new: "Updated text.", replaceAll: false}],
            }),
        ).rejects.toBe(patchError);
    } finally {
        api.patch = originalPatch;
    }

    const after = await readFull(path);
    expect(after).toEqual(before);
});

test("does not extend cache expiration after update", async () => {
    import.meta.jest.useFakeTimers();

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    import.meta.jest.setSystemTime(t0);

    const {documentId, path} = await setupDocument({
        title: "Expiration",
        bodyMarkdown: "Alpha",
    });

    mockDocumentPatch(documentId, 2);

    import.meta.jest.setSystemTime(new Date(t0.getTime() + 30 * 60 * 1000));

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "Alpha", new: "Beta", replaceAll: false}],
    });

    import.meta.jest.setSystemTime(new Date(t0.getTime() + 59 * 60 * 1000));

    await expect(
        callAgentWebScrollTool(context, {path, offset: 1, limit: "200kb"}),
    ).resolves.toContain("(End of file.");

    import.meta.jest.setSystemTime(new Date(t0.getTime() + 61 * 60 * 1000));

    await expect(
        callAgentWebScrollTool(context, {path, offset: 1, limit: "200kb"}),
    ).rejects.toThrow(NotFoundError);
});

test("serializes concurrent updates for the same path", async () => {
    const {documentId, path} = await setupDocument({
        title: "Concurrent",
        bodyMarkdown: "alpha omega",
    });

    mockDocumentPatch(documentId, 2, 3);

    await Promise.all([
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "alpha", new: "alpha-1", replaceAll: false}],
        }),
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "omega", new: "omega-1", replaceAll: false}],
        }),
    ]);

    const response = await readFull(path);

    expect(response).toContain("alpha-1 omega-1");
    expect(getDocumentPatchRequests()).toHaveLength(2);
});
