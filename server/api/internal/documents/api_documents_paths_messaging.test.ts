import {apiDocumentsPaths} from "~/server/api/internal/documents/api_documents_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {
    testMessagingApiImplementation,
    testMessagingApiImplementationSearchInjection,
} from "~/server/api/internal/test_helpers/test_messaging_api_implementation.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    documentsInjection,
    searchInjection: testMessagingApiImplementationSearchInjection,
});

const server = createTestApiServer(context, apiDocumentsPaths);

testMessagingApiImplementation(context, server, {
    generateMissingRoomPath: () =>
        `/documents/${generateId<DocumentId>()}/threads/${generateId<DocumentCommentThreadId>()}`,
    createPrivateRoom: async session => {
        const document = await TestDocument.create(session, {access: "Private"});

        await document.type(session, "Hello, ");
        const {range} = await document.type(session, "world");
        await document.type(session, "!");

        const commentThread = await document.createCommentThread(session, range);

        return {
            roomPath: `/documents/${document.id}/threads/${commentThread.id}`,
            room: commentThread,
            initialMessageCount: 1,
        };
    },
});
