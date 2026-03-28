import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetDocumentThreadMessages} from "~/server/agents/api/test_helpers/mock_api_get_document_thread_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageDocumentThreadRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/markdown/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiContentBlockElementResponseWithoutKeys,
    ApiContentFileBlockElementResponseWithoutKeys,
    ApiContentParagraphBlockElementResponseWithoutKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentResponse,
    ApiDocumentReferenceResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    BotId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const documentId = generateId<DocumentId>();
const threadId = generateId<DocumentCommentThreadId>();
const otherThreadId = generateId<DocumentCommentThreadId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});

const documentReference: ApiDocumentReferenceResponse = {
    type: "Document",
    id: documentId,
    title: "Launch Spec",
};

const documentThreadReference: AgentWebPageDocumentThreadRoutedLink = {
    type: "DocumentThread",
    document: documentReference,
    threadId,
};
const documentThreadPath = "/document/launch-spec/comments/1";

const {span} = testTracer.startSpan("call_agent_web_read_tool_for_document_thread.test.ts");
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
        id: generateId<AccountId>(),
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: generateId<BotId>()},
        pathname: "/bot/chatgpt",
    },
};

beforeEach(async () => {
    await storage.deleteAll();

    await createAgentWebPageLinkPathname(storage, context.botAccount);
    await createAgentWebPageLinkPathname(storage, documentReference);
    await createAgentWebPageLinkPathname(storage, documentThreadReference);
});

function contentFromBlockElements(
    elements: ReadonlyArray<ApiContentBlockElementResponseWithoutKeys>,
): ApiContentResponse {
    return addKeysToApiContentForTest({elements});
}

function paragraph(
    elements: ReadonlyArray<ApiContentInlineElementResponse>,
): ApiContentParagraphBlockElementResponseWithoutKeys {
    return {type: "Paragraph", elements};
}

function text(
    text: string,
    marks?: ReadonlyArray<ApiContentInlineElementMark>,
): ApiContentInlineElementResponse {
    return marks ? {type: "Text", text, marks} : {type: "Text", text};
}

function commentMark(id: DocumentCommentThreadId = threadId) {
    return {type: "Comment" as const, thread: {id}};
}

function commentedText(
    text: string,
    {
        id = threadId,
        marks = [],
    }: {
        id?: DocumentCommentThreadId;
        marks?: ReadonlyArray<ApiContentInlineElementMark>;
    } = {},
): ApiContentInlineElementResponse {
    return {type: "Text", text, marks: [commentMark(id), ...marks]};
}

function contentFromCommentedText(text: string): ApiContentResponse {
    return contentFromBlockElements([paragraph([commentedText(text)])]);
}

function commentedFile(contentType: ApiContentFileBlockElementResponseWithoutKeys["contentType"]) {
    return {
        type: "File" as const,
        id: generateChronologicalId<FileId>(),
        contentType,
        contentLength: 100,
        marks: [commentMark()],
    };
}

function documentContentSnippet(): ApiContentResponse {
    return contentFromBlockElements([
        paragraph([
            text("Keep "),
            commentedText("current"),
            text(" and strip "),
            commentedText("other", {id: otherThreadId}),
            text("."),
        ]),
    ]);
}

function mockGetDocumentReference() {
    api.mockGet(
        "/documents/{id}/reference",
        {data: {spaceId, reference: documentReference}},
        {path: {id: documentId}},
    );
}

function mockGetDocumentThread({
    commentCount = 1,
    createdTime = new Date("2026-05-14T15:00:00.000Z"),
    content = documentContentSnippet(),
    isResolved = false,
}: {
    commentCount?: number;
    createdTime?: Date;
    content?: ApiContentResponse;
    isResolved?: boolean;
} = {}) {
    api.mockGet(
        "/documents/{id}/threads/{threadId}",
        {
            data: {
                spaceId,
                thread: {
                    id: threadId,
                    document: {
                        id: documentId,
                        reference: {
                            title: documentReference.title,
                        },
                    },
                    isResolved,
                    totalMessageCount: commentCount,
                    firstMessage: {
                        author: aliceAccount,
                        createdTime: serializeDateString(createdTime),
                        createdTimeZone: defaultTimeZone,
                    },
                    documentContentSnippet: content,
                },
            },
        },
        {path: {id: documentId, threadId}},
    );
}

function mockMessages({
    totalMessageCount,
    cursor,
    from,
    createMessage,
}: {
    totalMessageCount: number;
    cursor?: number;
    from?: "Start" | "End";
    createMessage?: (index: number) => ApiMessageResponse;
}) {
    mockApiGetDocumentThreadMessages(api, {
        spaceId,
        documentId,
        threadId,
        cursor,
        from,
        totalMessageCount,
        limit: 30,
        createMessage:
            createMessage ??
            (index =>
                createApiMessageMock({
                    index,
                    author: index % 2 === 0 ? bobAccount : aliceAccount,
                    content: `Comment ${index}.`,
                })),
    });
}

test("reads a document thread with quoted commented content above comments", async () => {
    mockGetDocumentThread();
    mockMessages({
        totalMessageCount: 1,
        createMessage: index =>
            createApiMessageMock({index, author: bobAccount, content: "First comment."}),
    });

    const response = await callAgentWebReadTool(context, {
        path: documentThreadPath,
        limit: "10kb",
    });

    expect(response).toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>\n\ncurrent\n\n</blockquote>\n
<comment id="0" from="[Bob](/human/bob)">\n\nFirst comment.\n\n</comment>

End of comments.`);
});

test("reads a document thread pagination link for the next page", async () => {
    const totalMessageCount = 12;
    const createMessage = (index: number) =>
        createApiMessageMock({
            index,
            author: index % 2 === 0 ? bobAccount : aliceAccount,
            content:
                `Paginated comment ${index}. ` +
                "This comment has enough detail to make the response require pagination.",
        });

    mockGetDocumentThread();
    mockMessages({totalMessageCount, createMessage});

    const firstResponse = await callAgentWebReadTool(context, {
        path: documentThreadPath,
        limit: "1kb",
    });
    expect(firstResponse).toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec). [Next page »](/document/launch-spec/comments/1?after=3)

- [ ] Unresolved

<blockquote>

current

</blockquote>

<comment id="0" from="[Bob](/human/bob)">

Paginated comment 0. This comment has enough detail to make the response require pagination.

</comment>

<comment id="1" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 1. This comment has enough detail to make the response require pagination.

</comment>

<comment id="2" from="[Bob](/human/bob)" time="5 minutes later">

Paginated comment 2. This comment has enough detail to make the response require pagination.

</comment>

<comment id="3" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 3. This comment has enough detail to make the response require pagination.

</comment>`);

    mockGetDocumentReference();
    mockMessages({totalMessageCount, cursor: 3, createMessage});

    const nextResponse = await callAgentWebReadTool(context, {
        path: `${documentThreadPath}?after=3`,
        limit: "10kb",
    });
    expect(nextResponse).toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

<time>May 14th at 11:20am EDT</time>

<comment id="4" from="[Bob](/human/bob)">

Paginated comment 4. This comment has enough detail to make the response require pagination.

</comment>

<comment id="5" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 5. This comment has enough detail to make the response require pagination.

</comment>

<comment id="6" from="[Bob](/human/bob)" time="5 minutes later">

Paginated comment 6. This comment has enough detail to make the response require pagination.

</comment>

<comment id="7" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 7. This comment has enough detail to make the response require pagination.

</comment>

<comment id="8" from="[Bob](/human/bob)" time="5 minutes later">

Paginated comment 8. This comment has enough detail to make the response require pagination.

</comment>

<comment id="9" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 9. This comment has enough detail to make the response require pagination.

</comment>

<comment id="10" from="[Bob](/human/bob)" time="5 minutes later">

Paginated comment 10. This comment has enough detail to make the response require pagination.

</comment>

<comment id="11" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 11. This comment has enough detail to make the response require pagination.

</comment>

End of comments.`);
});

test("reads later document thread comment pages without the preview", async () => {
    mockGetDocumentReference();
    mockMessages({
        cursor: 2,
        totalMessageCount: 5,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: index === 3 ? bobAccount : aliceAccount,
                content: index === 3 ? "Third comment." : "Fourth comment.",
            }),
    });

    await expect(
        callAgentWebReadTool(context, {
            path: `${documentThreadPath}?after=2`,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

<time>May 14th at 11:15am EDT</time>

<comment id="3" from="[Bob](/human/bob)">\n\nThird comment.\n\n</comment>\n
<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nFourth comment.\n\n</comment>

End of comments.`);
});

test("reads a document thread with no comments", async () => {
    mockGetDocumentThread({commentCount: 0, content: contentFromCommentedText("Preview only.")});
    mockMessages({totalMessageCount: 0});

    await expect(
        callAgentWebReadTool(context, {
            path: documentThreadPath,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>\n\nPreview only.\n\n</blockquote>

End of comments.`);
});

test("reads a resolved document thread", async () => {
    mockGetDocumentThread({
        commentCount: 0,
        content: contentFromCommentedText("Preview only."),
        isResolved: true,
    });
    mockMessages({totalMessageCount: 0});

    await expect(
        callAgentWebReadTool(context, {
            path: documentThreadPath,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [x] Resolved

<blockquote>\n\nPreview only.\n\n</blockquote>

End of comments.`);
});

test("reads formatted quoted commented text", async () => {
    mockGetDocumentThread({
        commentCount: 0,
        content: contentFromBlockElements([
            paragraph([
                text("Before "),
                commentedText("bold", {marks: [{type: "Bold"}]}),
                commentedText(" and "),
                commentedText("italic", {marks: [{type: "Italic"}]}),
                text(" after."),
            ]),
        ]),
    });
    mockMessages({totalMessageCount: 0});

    await expect(
        callAgentWebReadTool(context, {
            path: documentThreadPath,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>\n\n**bold** and _italic_\n\n</blockquote>

End of comments.`);
});

test("reads quoted commented content with multiple paragraphs", async () => {
    mockGetDocumentThread({
        commentCount: 0,
        content: contentFromBlockElements([
            paragraph([text("Before paragraph.")]),
            paragraph([commentedText("First paragraph.")]),
            paragraph([commentedText("Second paragraph.")]),
            paragraph([text("After paragraph.")]),
        ]),
    });
    mockMessages({totalMessageCount: 0});

    await expect(
        callAgentWebReadTool(context, {
            path: documentThreadPath,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>\n\nFirst paragraph.\n\nSecond paragraph.\n\n</blockquote>

End of comments.`);
});

test("reads quoted commented list items with partial start and end items", async () => {
    mockGetDocumentThread({
        commentCount: 0,
        content: contentFromBlockElements([
            {
                type: "UnorderedList",
                items: [
                    {elements: [paragraph([text("Before item.")])]},
                    {elements: [paragraph([text("Start skip "), commentedText("first tail")])]},
                    {elements: [paragraph([commentedText("middle item")])]},
                    {elements: [paragraph([commentedText("last head"), text(" end skip")])]},
                    {elements: [paragraph([text("After item.")])]},
                ],
            },
        ]),
    });
    mockMessages({totalMessageCount: 0});

    await expect(
        callAgentWebReadTool(context, {
            path: documentThreadPath,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>\n\n- first tail\n\n- middle item\n\n- last head\n\n</blockquote>

End of comments.`);
});

test("reads only the first disjoint quoted commented range", async () => {
    mockGetDocumentThread({
        commentCount: 0,
        content: contentFromBlockElements([
            paragraph([
                text("Before "),
                commentedText("first"),
                text(" gap "),
                commentedText("second"),
                text(" after."),
            ]),
        ]),
    });
    mockMessages({totalMessageCount: 0});

    await expect(
        callAgentWebReadTool(context, {
            path: documentThreadPath,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>\n\nfirst\n\n</blockquote>

End of comments.`);
});

test("reads quoted commented text through a fully commented file gallery", async () => {
    mockGetDocumentThread({
        commentCount: 0,
        content: contentFromBlockElements([
            paragraph([text("Before "), commentedText("Selected text.")]),
            {
                type: "FileGallery",
                rows: [
                    {
                        items: [
                            {width: 0.5, element: commentedFile("image/png")},
                            {width: 0.5, element: commentedFile("video/mp4")},
                        ],
                    },
                ],
            },
            paragraph([text("After gallery.")]),
        ]),
    });
    mockMessages({totalMessageCount: 0});

    await expect(
        callAgentWebReadTool(context, {
            path: documentThreadPath,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>

Selected text.

<div style="display: flex">
<img src="/file/image.png" />
<video src="/file/video.mp4"></video>
</div>

</blockquote>

End of comments.`);
});

test("reads a document thread comment link around the comment", async () => {
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "DocumentMessage",
        id: documentId,
        threadId,
        index: 1,
        authorShortName: "Alice",
        bodySnippet: "Second comment",
    });

    mockGetDocumentThread();
    mockMessages({
        cursor: -14,
        totalMessageCount: 3,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: index === 1 ? aliceAccount : bobAccount,
                content: `${index === 1 ? "Second" : "Nearby"} comment.`,
            }),
    });

    await expect(
        callAgentWebReadTool(context, {
            path: "/document-comment/alice-second-comment",
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>\n\ncurrent\n\n</blockquote>\n
<comment id="0" from="[Bob](/human/bob)">\n\nNearby comment.\n\n</comment>\n
<comment id="1" from="[Alice](/human/alice)" time="5 minutes later">\n\nSecond comment.\n\n</comment>\n
<comment id="2" from="[Bob](/human/bob)" time="5 minutes later">\n\nNearby comment.\n\n</comment>

End of comments.`);
});
