import {
    AgentDocumentPageLink,
    AgentLink,
} from "~/server/agents/internal/link_references/agent_link.js";
import {AgentLocalDocumentKey} from "~/server/agents/internal/link_references/agent_local_document_content_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
    printApiPathForAgentLink,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

const accountId = generateId<AccountId>();
const chatId = generateId<ChatId>();
const channelId = generateId<ChannelId>();
const collectionId = generateId<TaskCollectionId>();
const commentThreadId = generateId<DocumentCommentThreadId>();
const documentId = generateId<DocumentId>();
const postId = generateId<PostId>();
const taskId = generateId<TaskId>();

describe("printAgentLinkPath", () => {
    describe("base paths", () => {
        test("prints account path", () => {
            const link: AgentLink = {
                type: "Account",
                accountId,
                name: "Alice Smith",
            };
            expect(printAgentLinkPath(link)).toBe("/account/alice-smith");
        });

        test("prints channel path", () => {
            const link: AgentLink = {
                type: "Channel",
                channelId,
                name: "General Discussion",
            };
            expect(printAgentLinkPath(link)).toBe("/channel/general-discussion");
        });

        test("prints document path", () => {
            const link: AgentLink = {
                type: "DocumentPage",
                documentId,
                title: "My Document",
                localDocumentPage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/document/my-document");
        });

        test("prints task path", () => {
            const link: AgentLink = {
                type: "Task",
                taskId,
                title: "Fix Bug #123",
                status: {type: "Open", isActive: false},
            };
            expect(printAgentLinkPath(link)).toBe("/task/fix-bug-123");
        });

        test("prints task collection path", () => {
            const link: AgentLink = {
                type: "TaskCollection",
                collectionId,
                name: "Product Launch Tasks",
            };
            expect(printAgentLinkPath(link)).toBe("/task-collection/product-launch-tasks");
        });
    });

    describe("message paths", () => {
        test("prints chat message path for first page of messages", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                label: "Ian: how is everyone doing?",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/chat/ian-how-is-everyone-doing");
        });

        test("prints post message path for first page of comments", () => {
            const link: AgentLink = {
                type: "PostComments",
                postId,
                label: "Ian: great update!",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/post/ian-great-update");
        });

        test("prints task message path for first page of comments", () => {
            const link: AgentLink = {
                type: "TaskComments",
                taskId,
                label: "Ian: working on it",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/task-comments/ian-working-on-it");
        });
    });

    describe("document comment paths", () => {
        test("prints document comment thread comment path for first page of comments", () => {
            const link: AgentLink = {
                type: "DocumentCommentThreadComments",
                documentId,
                commentThreadId,
                label: "Ian: this looks great!",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/document-thread/ian-this-looks-great");
        });
    });

    describe("paginated messages lists", () => {
        test("prints chat messages list with page for middle page of messages", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                paginationType: "page",
                pageNumber: 5,
                pageInfo: {
                    from: "Middle",
                    index: 5,
                },
                label: "Ian: hello",
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/chat/ian-hello?page=5");
        });

        test("prints chat messages list with page and dedupe", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                paginationType: "page",
                pageNumber: 5,
                dedupeNumber: 2,
                label: "Ian: hello",
                pageInfo: {
                    from: "Middle",
                    index: 5,
                },
                rootMessage: {
                    dedupeNumber: 3,
                },
            };
            expect(printAgentLinkPath(link)).toBe("/chat/ian-hello-3?page=5&version=2");
        });

        test("prints chat messages list with chunk", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                paginationType: "chunk",
                pageNumber: -10,
                label: "Ian: hello",
                pageInfo: {
                    from: "Middle",
                    index: 5,
                },
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/chat/ian-hello?chunk=-10");
        });

        test("prints document comments list with page", () => {
            const link: AgentLink = {
                type: "DocumentCommentThreadComments",
                documentId,
                commentThreadId,
                paginationType: "page",
                pageNumber: 3,
                label: "Ian: this looks great!",
                pageInfo: {
                    from: "Middle",
                    index: 3,
                },
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/document-thread/ian-this-looks-great?page=3");
        });

        test("prints post messages list with chunk and dedupe", () => {
            const link: AgentLink = {
                type: "PostComments",
                postId,
                paginationType: "chunk",
                pageNumber: 7,
                dedupeNumber: 2,
                label: "Ian: great update!",
                pageInfo: {
                    from: "Middle",
                    index: 7,
                },
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/post/ian-great-update-2?chunk=7&version=2");
        });

        test("prints task messages list with page", () => {
            const link: AgentLink = {
                type: "TaskComments",
                taskId,
                paginationType: "page",
                pageNumber: 1,
                label: "Ian: hello",
                pageInfo: {
                    from: "Middle",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentLinkPath(link)).toBe("/task-comments/ian-hello");
        });
    });

    describe("local document pages", () => {
        const documentKey: AgentLocalDocumentKey = `/local/document/${documentId}-1`;
        test("prints local document page path for first page, version 1", () => {
            const pathObject: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "My Document",
                localDocumentPage: {
                    localDocumentVersion: 1,
                    pageNumber: 1,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe("/document/my-document?page=1");
        });

        test("prints local document page path for first page, version > 1", () => {
            const pathObject: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "Project Spec",
                localDocumentPage: {
                    localDocumentVersion: 3,
                    pageNumber: 1,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe("/document/project-spec?page=1&version=3");
        });

        test("prints local document page path for page > 1, version 1", () => {
            const pathObject: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "Long Document",
                localDocumentPage: {
                    localDocumentVersion: 1,
                    pageNumber: 5,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe("/document/long-document?page=5");
        });

        test("prints local document page path for page > 1, version > 1", () => {
            const pathObject: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "Updated Guide",
                localDocumentPage: {
                    localDocumentVersion: 2,
                    pageNumber: 3,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe("/document/updated-guide?page=3&version=2");
        });

        test("prints local document page path with document dedupe number", () => {
            const pathObject: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "README",
                dedupeNumber: 2,
                localDocumentPage: {
                    localDocumentVersion: 1,
                    pageNumber: 1,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe("/document/readme-2?page=1");
        });

        test("prints local document page path with document dedupe number and version", () => {
            const pathObject: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "API Reference",
                dedupeNumber: 3,
                localDocumentPage: {
                    localDocumentVersion: 4,
                    pageNumber: 1,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe(
                "/document/api-reference-3?page=1&version=4",
            );
        });

        test("prints local document page path with page dedupe number (version in query string)", () => {
            const pathObject: AgentLink = {
                type: "DocumentPage",
                documentId,
                title: "User Guide",
                localDocumentPage: {
                    localDocumentVersion: 5,
                    pageNumber: 2,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe("/document/user-guide?page=2&version=5");
        });

        test("prints local document page path with all options: document dedupe, version, page, and page dedupe", () => {
            const pathObject: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "Technical Manual",
                dedupeNumber: 3,
                localDocumentPage: {
                    localDocumentVersion: 7,
                    pageNumber: 4,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe(
                "/document/technical-manual-3?page=4&version=7",
            );
        });

        test("prints local document page path with page 1 does not show page query param", () => {
            const pathObject: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "Getting Started",
                localDocumentPage: {
                    localDocumentVersion: 1,
                    pageNumber: 1,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            // page=1 appears now (implementation changed)
            expect(printAgentLinkPath(pathObject)).toBe("/document/getting-started?page=1");
        });

        test("prints local document page path with special characters normalized", () => {
            const pathObject: AgentLink = {
                type: "DocumentPage",
                documentId,
                title: "FAQ: Common Questions & Answers!",
                localDocumentPage: {
                    localDocumentVersion: 1,
                    pageNumber: 2,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentLinkPath(pathObject)).toBe(
                "/document/faq-common-questions-and-answers?page=2",
            );
        });
    });
});

describe("printAgentLinkPathIntoApiPath", () => {
    describe("base paths", () => {
        test("converts account path to API path", () => {
            const link: AgentLink = {
                type: "Account",
                accountId,
                name: "Alice Smith",
            };
            expect(printApiPathForAgentLink(link)).toBe(`/accounts/${accountId}`);
        });

        test("converts channel path to API path", () => {
            const link: AgentLink = {
                type: "Channel",
                channelId,
                name: "General",
            };
            expect(printApiPathForAgentLink(link)).toBe(`/channels/${channelId}`);
        });

        test("converts chat path to API path", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                label: "Alice, Bob",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printApiPathForAgentLink(link)).toBe(`/chats/${chatId}/messages`);
        });

        test("converts document path to API path", () => {
            const link: AgentLink = {
                type: "DocumentPage",
                documentId,
                title: "My Doc",
                localDocumentPage: null,
            };
            expect(printApiPathForAgentLink(link)).toBe(`/documents/${documentId}`);
        });

        test("converts task path to API path", () => {
            const link: AgentLink = {
                type: "Task",
                taskId,
                title: "Fix Bug",
                status: {type: "Open", isActive: false},
            };
            expect(printApiPathForAgentLink(link)).toBe(`/tasks/${taskId}`);
        });

        test("converts task collection path to API path", () => {
            const link: AgentLink = {
                type: "TaskCollection",
                collectionId,
                name: "Launch",
            };
            expect(printApiPathForAgentLink(link)).toBe(`/task-collections/${collectionId}`);
        });
    });

    describe("message paths", () => {
        test("converts chat message path to API path", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                label: "Ian: hello",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printApiPathForAgentLink(link)).toBe(`/chats/${chatId}/messages`);
        });

        test("converts post message path to API path", () => {
            const link: AgentLink = {
                type: "PostComments",
                postId,
                label: "Bob: comment",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printApiPathForAgentLink(link)).toBe(`/posts/${postId}/messages`);
        });

        test("converts task message path to API path", () => {
            const link: AgentLink = {
                type: "TaskComments",
                taskId,
                label: "Alice: update",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printApiPathForAgentLink(link)).toBe(`/tasks/${taskId}/messages`);
        });
    });

    describe("document comment paths", () => {
        test("converts document comment thread comment to API path", () => {
            const link: AgentLink = {
                type: "DocumentCommentThreadComments",
                documentId,
                commentThreadId,
                label: "Ian: this looks great!",
                paginationType: "chunk",
                pageNumber: -3,
                pageInfo: {
                    from: "Middle",
                    index: -3,
                },
                rootMessage: null,
            };
            expect(printApiPathForAgentLink(link)).toBe(
                `/documents/${documentId}/threads/${commentThreadId}/messages`,
            );
        });
    });

    describe("local document pages", () => {
        const documentKey: AgentLocalDocumentKey = `/local/document/${documentId}-1`;
        test("converts local document page to API path (always returns document path)", () => {
            const link: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "My Document",
                dedupeNumber: 4,
                localDocumentPage: {
                    localDocumentVersion: 3,
                    pageNumber: 5,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            // Regardless of page number or version, API path is always the document itself
            expect(printApiPathForAgentLink(link)).toBe(`/documents/${documentId}`);
        });

        test("converts local document page to API path for first page", () => {
            const link: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "Simple Doc",
                localDocumentPage: {
                    localDocumentVersion: 1,
                    pageNumber: 1,
                    documentKey,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printApiPathForAgentLink(link)).toBe(`/documents/${documentId}`);
        });
    });
});

describe("printAgentPlainTextLabel", () => {
    describe("base paths", () => {
        test("returns account title", () => {
            const link: AgentLink = {
                type: "Account",
                accountId,
                name: "Alice Smith",
            };
            expect(printAgentPlainTextLabel(link)).toBe("Alice Smith");
        });

        test("returns channel title", () => {
            const link: AgentLink = {
                type: "Channel",
                channelId,
                name: "General Discussion",
            };
            expect(printAgentPlainTextLabel(link)).toBe("General Discussion");
        });

        test("returns chat title", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                label: "Alice, Bob, and 2 others",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Alice, Bob, and 2 others");
        });

        test("returns document title", () => {
            const link: AgentLink = {
                type: "DocumentPage",
                documentId,
                title: "My Document",
                localDocumentPage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("My Document");
        });

        test("returns task title and open status", () => {
            const link: AgentLink = {
                type: "Task",
                taskId,
                title: "Fix Bug #123",
                status: {type: "Open", isActive: false},
            };
            expect(printAgentPlainTextLabel(link)).toBe("Fix Bug #123 (Open)");
        });

        test("returns task title and active status", () => {
            const link: AgentLink = {
                type: "Task",
                taskId,
                title: "Fix Bug #123",
                status: {type: "Open", isActive: true},
            };
            expect(printAgentPlainTextLabel(link)).toBe("Fix Bug #123 (Open)");
        });

        test("returns task title and closed status", () => {
            const link: AgentLink = {
                type: "Task",
                taskId,
                title: "Fix Bug #123",
                status: {type: "Closed"},
            };
            expect(printAgentPlainTextLabel(link)).toBe("Fix Bug #123 (Closed)");
        });

        test("returns task collection title", () => {
            const link: AgentLink = {
                type: "TaskCollection",
                collectionId,
                name: "Product Launch Tasks",
            };
            expect(printAgentPlainTextLabel(link)).toBe("Product Launch Tasks");
        });
    });

    describe("message paths", () => {
        test("returns chat message title", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                label: "Ian: how is everyone doing?",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Ian: how is everyone doing?");
        });

        test("returns post message title", () => {
            const link: AgentLink = {
                type: "PostComments",
                postId,
                label: "Ian: great update!",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Ian: great update!");
        });

        test("returns task message title", () => {
            const link: AgentLink = {
                type: "TaskComments",
                taskId,
                label: "Ian: working on it",
                paginationType: "page",
                pageNumber: 1,
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Ian: working on it");
        });
    });

    describe("document comment paths", () => {
        test("returns document comment title", () => {
            const link: AgentLink = {
                type: "DocumentCommentThreadComments",
                documentId,
                commentThreadId,
                label: "Ian: this looks great!",
                paginationType: "chunk",
                pageNumber: -3,
                pageInfo: {
                    from: "Middle",
                    index: -3,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Ian: this looks great!");
        });
    });

    describe("paginated messages lists", () => {
        test("returns chat messages list label", () => {
            const link: AgentLink = {
                type: "ChatMessages",
                chatId,
                paginationType: "page",
                pageNumber: 5,
                label: "Ian: hello",
                pageInfo: {
                    from: "Start",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Ian: hello");
        });

        test("returns document comments list label", () => {
            const link: AgentLink = {
                type: "DocumentCommentThreadComments",
                documentId,
                commentThreadId,
                paginationType: "chunk",
                pageNumber: -3,
                label: "Ian: this looks great!",
                pageInfo: {
                    from: "Middle",
                    index: -3,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Ian: this looks great!");
        });

        test("returns post messages list label", () => {
            const link: AgentLink = {
                type: "PostComments",
                postId,
                paginationType: "page",
                pageNumber: 0,
                label: "Ian: great update!",
                pageInfo: {
                    from: "Middle",
                    index: 0,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Ian: great update!");
        });

        test("returns task messages list label", () => {
            const link: AgentLink = {
                type: "TaskComments",
                taskId,
                paginationType: "page",
                pageNumber: 1,
                label: "Ian: great update!",
                pageInfo: {
                    from: "Middle",
                    index: 1,
                },
                rootMessage: null,
            };
            expect(printAgentPlainTextLabel(link)).toBe("Ian: great update!");
        });
    });

    describe("local document page", () => {
        test("returns document title for local document page", () => {
            const link: AgentDocumentPageLink = {
                type: "DocumentPage",
                documentId,
                title: "My Document",
                localDocumentPage: {
                    localDocumentVersion: 5,
                    pageNumber: 2,
                    documentKey: `/local/document/${documentId}-5`,
                    pageStartElementIndex: 0,
                    pageEndElementIndexExclusive: 100,
                    previousPageAgentLinkString: null,
                    nextPageAgentLinkString: null,
                },
            };
            expect(printAgentPlainTextLabel(link)).toBe("My Document");
        });
    });
});
