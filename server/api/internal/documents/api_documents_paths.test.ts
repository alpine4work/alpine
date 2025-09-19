import request from "supertest";
import {apiDocumentsPaths} from "~/server/api/internal/documents/api_documents_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext({
    documentsInjection,
});

const server = createTestApiServer(context, apiDocumentsPaths);

test("can read message in document comment thread", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document = await TestDocument.create(session);
    await document.type(session, "Hello, ");
    const {range} = await document.type(session, "world");
    await document.type(session, "!");
    const commentThread = await document.createCommentThread(session, range);

    const response = await request(server)
        .get(`/documents/${document.id}/threads/${commentThread.id}/messages/0`)
        .set("authorization", `bearer ${apiKey}`)
        .expect("content-type", "application/json")
        .expect(200);

    expect(response.body).toEqual(
        expect.objectContaining({
            roomPath: `/documents/${document.id}/threads/${commentThread.id}`,
            index: 0,
            payload: expect.objectContaining({type: "Content"}),
        }),
    );
});
