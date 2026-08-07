import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetDocumentThreadMessages} from "~/server/agents/api/test_helpers/mock_api_get_document_thread_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebPageDocumentThreadRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.open_source.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiAccountResponse,
    ApiContentResponse,
    ApiContentResponseWithoutKeys,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {UrlPath} from "~/shared/helpers/http/url_path.open_source.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    BotId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const documentId = generateId<DocumentId>();
const otherDocumentId = generateId<DocumentId>();
const threadId = generateId<DocumentCommentThreadId>();
const otherThreadId = generateId<DocumentCommentThreadId>();
const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const botApiAccount = createApiAccountMock({
    id: botAccountId,
    name: "ChatGPT",
    botId,
});

const documentReference = {
    type: "Document" as const,
    id: documentId,
    title: "Launch Spec",
};

const otherDocumentReference = {
    type: "Document" as const,
    id: otherDocumentId,
    title: "Roadmap",
};

const documentThreadReference: AgentWebPageDocumentThreadRoutedLink = {
    type: "DocumentThread",
    document: documentReference,
    threadId,
};

const documentThreadPath = "/document/launch-spec/comments/1";

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_document_thread.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);

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

beforeEach(async () => {
    await storage.deleteAll();

    const actualBotAccountPathname = await storeAgentWebPageLinkForTest(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);

    const actualDocumentPathname = await storeAgentWebPageLinkForTest(storage, documentReference);
    assert(actualDocumentPathname === "/document/launch-spec");

    const actualOtherDocumentPathname = await storeAgentWebPageLinkForTest(
        storage,
        otherDocumentReference,
    );
    assert(actualOtherDocumentPathname === "/document/roadmap");

    const actualDocumentThreadPathname = await createAgentWebPageLinkPathname(
        storage,
        documentThreadReference,
    );
    assert(actualDocumentThreadPathname === documentThreadPath);

    await storeAgentWebPageLinkForTest(storage, [aliceAccount, bobAccount]);
});

function createTextContent(text: string): ApiContentResponseWithoutKeys {
    return {elements: [{type: "Paragraph", elements: [{type: "Text", text}]}]};
}

function createPreviewContent(): ApiContentResponse {
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Keep "},
                    {
                        type: "Text",
                        text: "current",
                        marks: [{type: "Comment", thread: {id: threadId}}],
                    },
                    {type: "Text", text: " and strip "},
                    {
                        type: "Text",
                        text: "other",
                        marks: [{type: "Comment", thread: {id: otherThreadId}}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
}

function createComment({
    index,
    author = index % 2 === 0 ? aliceAccount : bobAccount,
    content = `Comment ${index}.`,
    createdTime = new Date(Date.UTC(2026, 4, 14, 15, index * 5)).toISOString(),
}: {
    index: number;
    author?: ApiAccountResponse;
    content?: ApiContentResponse | string;
    createdTime?: string;
}): ApiMessageResponse {
    return createApiMessageMock({
        index,
        author,
        content,
        createdTime,
    });
}

function getReadPageInfo(path: string): {
    from?: "Start" | "End";
    cursor?: number;
} {
    const url = new UrlPath(path);

    if (url.searchParams.has("start")) {
        return {};
    }

    const after = url.searchParams.get("after");
    if (after !== null) {
        if (after === "blockquote") return {};
        return {cursor: parseInt(after, 10)};
    }

    const before = url.searchParams.get("before");
    if (before !== null) {
        return {from: "End", cursor: before === "blockquote" ? 0 : parseInt(before, 10)};
    }

    return {};
}

function mockGetDocumentThread({
    documentContent = createPreviewContent(),
    createdTime = new Date("2026-05-14T15:00:00.000Z"),
    previewContent = documentContent,
    isResolved = false,
}: {
    documentContent?: ApiContentResponse;
    createdTime?: Date;
    previewContent?: ApiContentResponse;
    isResolved?: boolean;
} = {}) {
    api.mockGet("/documents/{id}/threads/{threadId}-with-preview", {
        params: {path: {id: documentId, threadId}},
        data: {
            spaceId,
            thread: {
                id: threadId,
                isResolved,
                totalMessageCount: 0,
                firstMessage: {
                    author: aliceAccount,
                    createdTime: serializeDateString(createdTime),
                    createdTimeZone: defaultTimeZone,
                },
                preview: {
                    version: 1,
                    contentSnippet: previewContent,
                },
            },
            document: {
                id: documentId,
                title: documentReference.title,
                content: documentContent,
                version: 1,
            },
        },
    });
}

function mockPatchDocumentThread(isResolved: boolean) {
    api.mockPatch("/documents/{id}/threads/{threadId}", {
        params: {path: {id: documentId, threadId}},
        data: {
            spaceId,
            thread: {
                id: threadId,
                isResolved,
                totalMessageCount: 0,
                firstMessage: {
                    author: aliceAccount,
                    createdTime: serializeDateString(new Date("2026-05-14T15:00:00.000Z")),
                    createdTimeZone: defaultTimeZone,
                },
            },
        },
    });
}

async function readDocumentThread({
    path = documentThreadPath,
    limit = "100kb",
    totalCommentCount,
    createComment: actuallyCreateComment,
    previewContent,
    isResolved,
}: {
    path?: string;
    limit?: string;
    totalCommentCount: number;
    createComment?: (index: number) => ApiMessageResponse;
    previewContent?: ApiContentResponse;
    isResolved?: boolean;
}): Promise<string> {
    const actualPreviewContent = previewContent ?? createPreviewContent();

    mockGetDocumentThread({documentContent: actualPreviewContent, isResolved});

    mockApiGetDocumentThreadMessages(api, {
        spaceId,
        documentId,
        threadId,
        ...getReadPageInfo(path),
        totalMessageCount: totalCommentCount,
        limit: 30,
        createMessage:
            actuallyCreateComment ??
            (index => createComment({index, author: index % 2 === 0 ? aliceAccount : bobAccount})),
    });

    return await callAgentWebReadTool(context, {path, limit});
}

function mockCreateComments({count, startIndex = 0}: {count: number; startIndex?: number}) {
    for (let index = 0; index < count; index++) {
        api.mockPost("/documents/{id}/threads/{threadId}/messages", {
            params: {path: {id: documentId, threadId}},
            data: {
                spaceId,
                message: createComment({
                    index: startIndex + index,
                    author: botApiAccount,
                    content: "Created comment response",
                }),
            },
        });
    }
}

function getCreateCommentRequests() {
    return api
        .getRequestHistory()
        .filter(
            request =>
                request.method === "POST" &&
                request.path === "/documents/{id}/threads/{threadId}/messages",
        );
}

function getPatchDocumentThreadRequests() {
    return api
        .getRequestHistory()
        .filter(
            request =>
                request.method === "PATCH" && request.path === "/documents/{id}/threads/{threadId}",
        );
}

function getLastCommentBlock(response: string): string {
    const startIndex = response.lastIndexOf("\n\n<comment");
    assert(startIndex !== -1);
    return response.slice(startIndex + 2);
}

function getNewlineIndexes(response: string): ReadonlyArray<number> {
    const newlineIndexes: Array<number> = [];

    for (let index = 0; index < response.length; index++) {
        if (response[index] === "\n") {
            newlineIndexes.push(index);
        }
    }

    newlineIndexes.push(response.length);

    return newlineIndexes;
}

async function writeDocumentThreadReadResponseWithoutResolvedState() {
    const response = `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Preview.

</blockquote>

End of comments.`;

    await storage.readResponseByPath.put(documentThreadPath, {
        expirationTime: new Date(Date.now() + 60 * 60 * 1000),
        pageMetadata: {
            type: "DocumentThread",
            id: documentId,
            threadId,
            isStartOfMessages: true,
            isEndOfMessages: true,
            messages: [],
        },
        response,
        newlineIndexes: getNewlineIndexes(response),
    });
}

async function addMatchAttributeToStoredDocumentPreview() {
    const readResponse = await storage.readResponseByPath.get(documentThreadPath);
    assert(readResponse !== undefined);

    const response = readResponse.response.replace("<blockquote>", '<blockquote match="2">');
    assert(response !== readResponse.response);

    await storage.readResponseByPath.put(documentThreadPath, {
        ...readResponse,
        response,
        newlineIndexes: getNewlineIndexes(response),
    });
}

test("creates the first comment on a document thread", async () => {
    await readDocumentThread({totalCommentCount: 0});
    mockCreateComments({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: "</blockquote>",
                    new: '</blockquote>\n\n<comment from="[ChatGPT](/bot/chatgpt)">\n\nFirst bot comment.\n\n</comment>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First bot comment."),
            createdTimeZone: defaultTimeZone,
        },
    ]);
});

test("creates comment without author on a document thread", async () => {
    await readDocumentThread({totalCommentCount: 0});
    mockCreateComments({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: "</blockquote>",
                    new: "</blockquote>\n\n<comment>\n\nFirst bot comment.\n\n</comment>",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First bot comment."),
            createdTimeZone: defaultTimeZone,
        },
    ]);
});

test("creates a document comment with an explicit timezone", async () => {
    await readDocumentThread({totalCommentCount: 0});
    mockCreateComments({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: "</blockquote>",
                    new: '</blockquote>\n\n<comment timezone="UTC">\n\nTimezone is explicit.\n\n</comment>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("Timezone is explicit."),
            createdTimeZone: assertTimeZone("UTC"),
        },
    ]);
});

test("rejects edits to the document preview content", async () => {
    await readDocumentThread({totalCommentCount: 0});

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [{old: "current", new: "changed", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/launch-spec/comments/1`. " +
            "You can\u2019t update the `<blockquote>` in document comment thread markdown. `<blockquote>` is a read-only preview of the document\u2019s content around the comment. Try again with a more specific update that only changes the content of comments from you or adds new comments. If you want to update the document\u2019s content then call the `update` tool on the document itself.",
    );
});

test("rejects edits to the document preview formatting", async () => {
    await readDocumentThread({totalCommentCount: 0});

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: "current",
                    new: "**current**",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/launch-spec/comments/1`. " +
            "You can\u2019t update the `<blockquote>` in document comment thread markdown. `<blockquote>` is a read-only preview of the document\u2019s content around the comment. Try again with a more specific update that only changes the content of comments from you or adds new comments. If you want to update the document\u2019s content then call the `update` tool on the document itself.",
    );
});

test("rejects edits to the document preview match attribute", async () => {
    await readDocumentThread({totalCommentCount: 0});

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: "<blockquote>",
                    new: '<blockquote match="2">',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/launch-spec/comments/1`. " +
            "You can\u2019t update the `<blockquote>` `match` attribute in document comment thread markdown. `<blockquote>` is a read-only preview of the document\u2019s content around the comment and `match` is added when content in a document is repeated multiple times so you know which instance of the content the comment is for. Try again with a more specific update that only changes the content of comments from you or adds new comments. If you want to update the document\u2019s content then call the `update` tool on the document itself.",
    );
});

test("rejects changing the document preview match attribute", async () => {
    await readDocumentThread({totalCommentCount: 0});
    await addMatchAttributeToStoredDocumentPreview();

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: '<blockquote match="2">',
                    new: '<blockquote match="3">',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/launch-spec/comments/1`. " +
            "You can\u2019t update the `<blockquote>` `match` attribute in document comment thread markdown. `<blockquote>` is a read-only preview of the document\u2019s content around the comment and `match` is added when content in a document is repeated multiple times so you know which instance of the content the comment is for. Try again with a more specific update that only changes the content of comments from you or adds new comments. If you want to update the document\u2019s content then call the `update` tool on the document itself.",
    );
});

test("rejects changing which document the document thread belongs to", async () => {
    await readDocumentThread({totalCommentCount: 0});

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: "Document comment thread on [Launch Spec](/document/launch-spec).",
                    new: "Document comment thread on [Roadmap](/document/roadmap).",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/document/launch-spec/comments/1`. " +
            "You can only update your `<comment>`s. You can\u2019t change which document the document comment thread belongs to on line 1. Try again with a more specific update that only changes the content of comments from you or adds new comments.",
    );
});

test.each(["- [x] Resolved", "- [x] Unresolved"])(
    "resolves a document thread with %s",
    async newState => {
        await readDocumentThread({totalCommentCount: 0});
        mockPatchDocumentThread(true);

        await expect(
            callAgentWebUpdateTool(context, {
                path: documentThreadPath,
                updates: [
                    {
                        old: "- [ ] Unresolved",
                        new: newState,
                        replaceAll: false,
                    },
                ],
            }),
        ).resolves.toEqual("Update was successful.");

        expect(getPatchDocumentThreadRequests().map(request => request.body)).toEqual([
            {patches: [{type: "Resolve"}]},
        ]);
    },
);

test.each(["- [ ] Resolved", "- [ ] Unresolved"])(
    "unresolves a document thread with %s",
    async newState => {
        await readDocumentThread({totalCommentCount: 0, isResolved: true});
        mockPatchDocumentThread(false);

        await expect(
            callAgentWebUpdateTool(context, {
                path: documentThreadPath,
                updates: [
                    {
                        old: "- [x] Resolved",
                        new: newState,
                        replaceAll: false,
                    },
                ],
            }),
        ).resolves.toEqual("Update was successful.");

        expect(getPatchDocumentThreadRequests().map(request => request.body)).toEqual([
            {patches: [{type: "Unresolve"}]},
        ]);
    },
);

test("resolves a legacy document thread without state", async () => {
    await writeDocumentThreadReadResponseWithoutResolvedState();
    mockPatchDocumentThread(true);

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: "<blockquote>",
                    new: "- [x] Resolved\n\n<blockquote>",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getPatchDocumentThreadRequests().map(request => request.body)).toEqual([
        {patches: [{type: "Resolve"}]},
    ]);
});

test("rejects creating comments before the end of document thread comments", async () => {
    const path = `${documentThreadPath}?start`;
    const response = await readDocumentThread({path, limit: "650b", totalCommentCount: 20});
    const lastCommentBlock = getLastCommentBlock(response);

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: lastCommentBlock,
                    new: `${lastCommentBlock}\n\n<comment from="[ChatGPT](/bot/chatgpt)">\n\nToo early.\n\n</comment>`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t update \`${path}\`. ` +
            "You can only add a `<comment>` after all other comments (comments are in chronological order). Look for \u201cEnd of comments\u201d to know when you\u2019re at the end of a comment section. Call the `read` tool with `/document/launch-spec/comments/1?end` to jump to the end of a comment section.",
    );
});

test("rejects creating comments from another account", async () => {
    await readDocumentThread({totalCommentCount: 0});

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [
                {
                    old: "</blockquote>",
                    new: '</blockquote>\n\n<comment from="[Alice](/human/alice)">\n\nNot from the bot.\n\n</comment>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/document/launch-spec/comments/1`. You can only add a `<comment>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    );
});

test("throws UnimplementedError when updating existing bot comment content", async () => {
    await readDocumentThread({
        totalCommentCount: 1,
        createComment: index =>
            createComment({index, author: botApiAccount, content: "Bot original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: documentThreadPath,
            updates: [{old: "Bot original", new: "Bot edited", replaceAll: false}],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/document/launch-spec/comments/1\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Message update API endpoint hasn\u2019t been implemented yet`);
});
