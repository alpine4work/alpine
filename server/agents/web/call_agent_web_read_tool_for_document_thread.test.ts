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
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key.js";
import {
    ApiContentResponse,
    ApiDocumentReferenceResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
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

function contentFromText(text: string): ApiContentResponse {
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

function documentContentSnippet(): ApiContentResponse {
    return {
        elements: [
            {
                type: "Paragraph",
                key: new ApiContentKeyEncoder({entityId: "Test", version: 0}).encode({
                    pos: 0,
                    nodeSize: 35,
                }),
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
    };
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
}: {
    commentCount?: number;
    createdTime?: Date;
    content?: ApiContentResponse;
} = {}) {
    api.mockGet(
        "/documents/{id}/threads/{threadId}",
        {
            data: {
                spaceId,
                document: {
                    reference: {
                        title: documentReference.title,
                    },
                },
                thread: {
                    id: threadId,
                    createdTime: serializeDateString(createdTime),
                    isResolved: false,
                    commentCount,
                    firstCommentAuthor: aliceAccount,
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

test("reads a document thread with preview above comments", async () => {
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

<document-preview>\n\nKeep <comment>current</comment> and strip other.\n\n</document-preview>\n
<comment id="0" from="[Bob](/human/bob)">\n\nFirst comment.\n\n</comment>

End of comments.`);

    const documentPreview = response.slice(
        response.indexOf("<document-preview>"),
        response.indexOf("</document-preview>") + "</document-preview>".length,
    );

    expect(documentPreview.match(/<comment/g)).toHaveLength(1);
    expect(documentPreview).toContain("<comment>current</comment>");
    expect(documentPreview).not.toContain('id="');
    expect(documentPreview).not.toContain("other</comment>");
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
    mockGetDocumentThread({commentCount: 0, content: contentFromText("Preview only.")});
    mockMessages({totalMessageCount: 0});

    await expect(
        callAgentWebReadTool(context, {
            path: documentThreadPath,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Document comment thread on [Launch Spec](/document/launch-spec).

<document-preview>\n\nPreview only.\n\n</document-preview>

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

<document-preview>\n\nKeep <comment>current</comment> and strip other.\n\n</document-preview>\n
<comment id="0" from="[Bob](/human/bob)">\n\nNearby comment.\n\n</comment>\n
<comment id="1" from="[Alice](/human/alice)" time="5 minutes later">\n\nSecond comment.\n\n</comment>\n
<comment id="2" from="[Bob](/human/bob)" time="5 minutes later">\n\nNearby comment.\n\n</comment>

End of comments.`);
});
