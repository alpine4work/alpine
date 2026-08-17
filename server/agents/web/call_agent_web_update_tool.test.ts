// NOTE: We mostly use documents in this file to test general
// `callAgentWebUpdateTool()` behavior. For document-specific tests see
// `server/agents/web/call_agent_web_update_tool_document.test.ts`.

import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {mockApiGetDocument} from "~/server/agents/api/test_helpers/mock_api_get_document.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {printAgentWebPageStoredLinkPathname} from "~/server/agents/web/agent_web_page_stored_link.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebScrollTool as actuallyCallAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.open_source.js";
import {callAgentWebUpdateTool as actuallyCallAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiContentResponse,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    const result = await actuallyCallAgentWebReadTool(...callArguments);
    assert(result.response.type === "String");
    return result.response.string;
}

async function callAgentWebScrollTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebScrollTool>
): Promise<string> {
    return (await actuallyCallAgentWebScrollTool(...callArguments)).response;
}

async function callAgentWebUpdateTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebUpdateTool>
): Promise<string> {
    return (await actuallyCallAgentWebUpdateTool(...callArguments)).response;
}

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
        id: botAccountId,
        bot: {id: botId},
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/anything`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc\n\n> Internal error: Assertion failure: `updates.length > 0`",
    );
});

test("throws NotFoundError when no cached read response exists", async () => {
    await expect(
        callAgentWebUpdateTool(context, {
            path: "/document/missing",
            updates: [{old: "a", new: "b", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/missing`. Can\u2019t call the `update` tool for a path that hasn\u2019t been read recently. Call the `read` tool with the path `/document/missing` then call the `update` tool again.",
    );
});

test("throws InvalidArgumentError when updating a skill", async () => {
    await callAgentWebReadTool(context, {path: "/skill/create", limit: "10kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/skill/create",
            updates: [
                {
                    old: "# What can you create in Alpine?",
                    new: "# What can agents create in Alpine?",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/skill/create`. Can\u2019t update a `/skill/...` page. Skills are read-only documentation written by the Alpine team to help you, the agent, navigate and update context in Alpine. If you think there\u2019s a mistake in a skill, please reach out to support@alpine.inc.",
    );
});

test("throws InvalidArgumentError when updating `/bot/me`", async () => {
    api.mockGet("/accounts/{id}-reference", {
        params: {path: {id: botAccountId}},
        data: {
            reference: {
                type: "Account",
                id: botAccountId,
                title: "My Bot",
                shortName: "My",
                bot: {id: botId},
            },
        },
    });

    await callAgentWebReadTool(context, {path: "/bot/me", limit: "10kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/bot/me",
            updates: [
                {
                    old: "You are [My Bot](/bot/my-bot).",
                    new: "You are [Renamed Bot](/bot/my-bot).",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/bot/me`. Your identity is decided by how you\u2019ve authenticated and can\u2019t be changed.",
    );
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/expired-update`. Can\u2019t call the `update` tool for a path that hasn\u2019t been read recently. Call the `read` tool with the path `/document/expired-update` then call the `update` tool again.",
    );
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/equal-strings`. The `old` string and the `new` string must be different. Instead they\u2019re both \u201CAlpha\u201D.",
    );
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/empty-old-string`. The `old` string is empty. You must search for some string in the path `/document/empty-old-string`.",
    );
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/no-match`. Couldn\u2019t find the `old` string \u201CMissing\u201D. Try again. The `old` string must exactly match existing content, including whitespace, indentation, and line endings.",
    );
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/multiple-matches`. Multiple matches were found for the `old` string \u201Crepeat\u201D. Provide more surrounding context to make the match unique. If you want to update every match of the `old` string you may use the `replaceAll` arg, however we recommend only making one update at a time to avoid unintentional updates.",
    );
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/replace-all-no-match`. Couldn\u2019t find the `old` string \u201CMissing\u201D. Try again. The `old` string must exactly match existing content, including whitespace, indentation, and line endings.",
    );

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
        ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/document/patch-failure\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: PATCH failed`);
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
    ).resolves.toEqual(
        "Error: Couldn\u2019t scroll `/document/expiration`. Can\u2019t call the `scroll` tool for a path that hasn\u2019t been read recently. Call the `read` tool with the path `/document/expiration` then call the `scroll` tool again.",
    );
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
