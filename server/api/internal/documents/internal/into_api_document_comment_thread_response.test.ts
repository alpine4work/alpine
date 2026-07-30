import {intoApiDocumentCommentThreadResponse} from "~/server/api/internal/documents/internal/into_api_document_comment_thread_response.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    getDocumentCommentPayload,
    getDocumentCommentThreadContent,
    getDocumentContent,
} from "~/server/documents/data/documents_actions.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

const context = createTestContext({
    chatInjection,
    documentsInjection,
});

test("builds the document comment thread response with the first message", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const document = await TestDocument.create(session);
    const {range} = await document.type(session, "Hello");
    await document.type(session, ", world!");

    const commentThreadReference = await document.createCommentThread(
        session,
        range,
        "Initial comment",
    );

    const [commentThread, documentContent, firstMessage] = await runAllPromises([
        getDocumentCommentThreadContent(session.action(), {
            documentId: document.id,
            commentThreadId: commentThreadReference.id,
        }),
        getDocumentContent(session.action(), document.id),
        getDocumentCommentPayload(session.action(), {
            documentId: document.id,
            commentThreadId: commentThreadReference.id,
            commentIndex: 0,
        }),
    ]);

    const bot = await TestBot.createAndInstantiate(session);
    const response = await intoApiDocumentCommentThreadResponse(
        bot.action({type: "Document", documentId: document.id}),
        {
            documentId: document.id,
            commentThread,
            documentContent: {type: "Document", content: documentContent.content},
            documentVersion: documentContent.version,
            message: firstMessage,
        },
    );

    expect(response).toMatchObject({
        thread: {
            id: commentThreadReference.id,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: {id: session.account.id},
            documentContentSnippet: {
                elements: [
                    {
                        type: "Paragraph",
                        key: expect.any(String),
                        elements: [
                            {
                                type: "Text",
                                text: "Hello",
                                marks: [{type: "Comment", threadId: commentThreadReference.id}],
                            },
                            {type: "Text", text: ", world!"},
                        ],
                    },
                ],
            },
        },
        message: {
            index: 0,
            author: {id: session.account.id},
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            key: expect.any(String),
                            elements: [{type: "Text", text: "Initial comment"}],
                        },
                    ],
                },
            },
        },
    });
});
