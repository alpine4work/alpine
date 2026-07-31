import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {
    callAgentWebSearchTool,
    defaultAgentWebSearchResultLimit,
} from "~/server/agents/web/call_agent_web_search_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiSearchResultResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    BotId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SiteId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_search_tool.test.ts");
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

function mockSearch(query: string, results: Array<ApiSearchResultResponse>): void {
    api.mockGet("/spaces/{id}/search", {
        params: {
            path: {id: spaceId},
            query: {query, limit: defaultAgentWebSearchResultLimit},
        },
        data: {results},
    });
}

test("returns no results found for an empty search response", async () => {
    mockSearch("nothing", []);

    expect(await callAgentWebSearchTool(context, {query: "nothing"})).toBe("No results found.\n");
});

test("prints entity results as links", async () => {
    mockSearch("test", [
        {
            type: "Document",
            id: generateId<DocumentId>(),
            title: "Test Document",
            titleMatches: [],
            bodySnippet: null,
        },
        {
            type: "Post",
            id: generateId<PostId>(),
            title: "Test Post",
            titleMatches: [],
            bodySnippet: null,
            author: createApiAccountMock({name: "John Smith"}),
        },
        {
            type: "Task",
            id: generateId<TaskId>(),
            title: "Test Task Open active",
            titleMatches: [],
            bodySnippet: null,
            status: {type: "Open", isActive: true},
        },
        {
            type: "Task",
            id: generateId<TaskId>(),
            title: "Test Task Open inactive",
            titleMatches: [],
            bodySnippet: null,
            status: {type: "Open", isActive: false},
        },
        {
            type: "Task",
            id: generateId<TaskId>(),
            title: "Test Task Closed",
            titleMatches: [],
            bodySnippet: null,
            status: {type: "Closed"},
        },
        {
            type: "TaskCollection",
            id: generateId<TaskCollectionId>(),
            title: "Test Collection",
            titleMatches: [],
            bodySnippet: null,
        },
        {
            type: "Chat",
            id: generateId<ChatId>(),
            title: "Test Chat",
            titleMatches: [],
            bodySnippet: null,
        },
        {
            type: "Account",
            id: generateId<AccountId>(),
            title: "Alice Smith",
            titleMatches: [],
            bodySnippet: null,
            shortName: "Alice",
        },
        {
            type: "Account",
            id: generateId<AccountId>(),
            title: "Claude",
            titleMatches: [],
            bodySnippet: null,
            shortName: "Claude",
            bot: {id: generateId<BotId>()},
        },
        {
            type: "Channel",
            id: generateId<ChannelId>(),
            title: "Test Channel",
            titleMatches: [],
            bodySnippet: null,
        },
        {
            type: "Site",
            id: generateId<SiteId>(),
            title: "Test Site",
            titleMatches: [],
            bodySnippet: null,
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "test"})).toEqual(`\
1. [Test Document](/document/test-document)

2. [Test Post](/post/test-post)

3. [Test Task Open active (Open, active)](/task/test-task-open-active)

4. [Test Task Open inactive (Open)](/task/test-task-open-inactive)

5. [Test Task Closed (Closed)](/task/test-task-closed)

6. [Test Collection](/task-collection/test-collection)

7. [Test Chat](/chat/test-chat)

8. [Alice Smith](/human/alice-smith)

9. [Claude](/bot/claude)

10. [Test Channel](/channel/test-channel)

11. [Test Site](/site/test-site)`);
});

test("prints an API-merged title match", async () => {
    mockSearch("Direct chat setup", [
        {
            type: "Chat",
            id: generateId<ChatId>(),
            title: "Direct chat setup",
            titleMatches: [{index: 0, length: 17}],
            bodySnippet: null,
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "Direct chat setup"})).toEqual(
        "1. [**Direct chat setup**](/chat/direct-chat-setup)",
    );
});

test("prints body matches under entity results", async () => {
    mockSearch("test", [
        {
            type: "Document",
            id: generateId<DocumentId>(),
            title: "Test Document",
            titleMatches: [],
            bodySnippet: {
                text: "Test Document test document",
                matches: [{index: 0, length: 13}],
            },
        },
        {
            type: "Post",
            id: generateId<PostId>(),
            title: "Test Post",
            titleMatches: [],
            bodySnippet: {
                text: "Test Post not highlighted hello world test post",
                matches: [
                    {index: 0, length: 9},
                    {index: 26, length: 11},
                ],
            },
            author: createApiAccountMock({name: "John Smith"}),
        },
        {
            type: "Task",
            id: generateId<TaskId>(),
            title: "Test Task",
            titleMatches: [],
            bodySnippet: {
                text: "Test Task hello world test task",
                matches: [{index: 0, length: 21}],
            },
            status: {type: "Open", isActive: true},
        },
        {
            type: "Channel",
            id: generateId<ChannelId>(),
            title: "Test Channel",
            titleMatches: [],
            bodySnippet: {text: "", matches: []},
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "test"})).toEqual(`\
1. [Test Document](/document/test-document)

   **Test Document** test document

2. [Test Post](/post/test-post)

   **Test Post** not highlighted **hello world** test post

3. [Test Task (Open, active)](/task/test-task)

   **Test Task hello world** test task

4. [Test Channel](/channel/test-channel)`);
});

test("prints message results as links labeled with a preview of the match", async () => {
    mockSearch("test", [
        {
            type: "ChatMessage",
            id: generateId<ChatId>(),
            index: 5,
            title: null,
            titleMatches: null,
            bodySnippet: {
                text: "This is a short message",
                matches: [
                    {index: 0, length: 4},
                    {index: 10, length: 5},
                ],
            },
            author: createApiAccountMock({name: "John Smith"}),
        },
        {
            type: "DocumentMessage",
            id: generateId<DocumentId>(),
            threadId: generateId<DocumentCommentThreadId>(),
            index: 1,
            title: null,
            titleMatches: null,
            bodySnippet: {
                text: "An important comment",
                matches: [{index: 3, length: 9}],
            },
            author: createApiAccountMock({name: "Jane Doe"}),
        },
        {
            type: "PostMessage",
            id: generateId<PostId>(),
            index: 3,
            title: null,
            titleMatches: null,
            bodySnippet: {
                text: "A thoughtful reply",
                matches: [{index: 2, length: 10}],
            },
            author: createApiAccountMock({name: "Alice Johnson"}),
        },
        {
            type: "TaskMessage",
            id: generateId<TaskId>(),
            index: 7,
            title: null,
            titleMatches: null,
            bodySnippet: {
                text: "A helpful update",
                matches: [{index: 2, length: 7}],
            },
            author: createApiAccountMock({name: "Bob Wilson"}),
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "test"})).toEqual(`\
1. [John: **This** is a **short** message](/chat-message/john-this-is-a-short-message)

2. [Jane: An **important** comment](/document-comment/jane-an-important-comment)

3. [Alice: A **thoughtful** reply](/post-comment/alice-a-thoughtful-reply)

4. [Bob: A **helpful** update](/task-comment/bob-a-helpful-update)`);
});

test("prints the missing entity title for message results without a body match", async () => {
    mockSearch("test", [
        {
            type: "ChatMessage",
            id: generateId<ChatId>(),
            index: 5,
            title: null,
            titleMatches: null,
            bodySnippet: {text: "", matches: []},
            author: createApiAccountMock({name: "John Smith"}),
        },
        {
            type: "DocumentMessage",
            id: generateId<DocumentId>(),
            threadId: generateId<DocumentCommentThreadId>(),
            index: 1,
            title: null,
            titleMatches: null,
            bodySnippet: {text: "", matches: []},
            author: createApiAccountMock({name: "Jane Doe"}),
        },
        {
            type: "PostMessage",
            id: generateId<PostId>(),
            index: 3,
            title: null,
            titleMatches: null,
            bodySnippet: {text: "", matches: []},
            author: createApiAccountMock({name: "Alice Johnson"}),
        },
        {
            type: "TaskMessage",
            id: generateId<TaskId>(),
            index: 7,
            title: null,
            titleMatches: null,
            bodySnippet: {text: "", matches: []},
            author: createApiAccountMock({name: "Bob Wilson"}),
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "test"})).toEqual(`\
1. [John: Unknown chat message](/chat-message/john-unknown-chat-message)

2. [Jane: Unknown document comment](/document-comment/jane-unknown-document-comment)

3. [Alice: Unknown post comment](/post-comment/alice-unknown-post-comment)

4. [Bob: Unknown task comment](/task-comment/bob-unknown-task-comment)`);
});

test("truncates long message previews and prints the rest of the match after the link", async () => {
    mockSearch("test", [
        {
            type: "DocumentMessage",
            id: generateId<DocumentId>(),
            threadId: generateId<DocumentCommentThreadId>(),
            index: 1,
            title: null,
            titleMatches: null,
            bodySnippet: {
                text: "Important document comment keyword with a really long body match that will be displayed outside of the link itself",
                matches: [
                    {index: 0, length: 9},
                    {index: 27, length: 7},
                ],
            },
            author: createApiAccountMock({name: "Jane Doe"}),
        },
        {
            type: "TaskMessage",
            id: generateId<TaskId>(),
            index: 7,
            title: null,
            titleMatches: null,
            bodySnippet: {
                text: "We need to update the documentation with all the latest changes and improvements",
                matches: [],
            },
            author: createApiAccountMock({name: "Bob Wilson"}),
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "test"})).toEqual(`\
1. [Jane: **Important** document comment **keyword** with a really long](/document-comment/jane-important-document-comment-keyword-with-a-reall) body match that will be displayed outside of the link itself

2. [Bob: We need to update the documentation with all the latest](/task-comment/bob-we-need-to-update-the-documentation-with-all-th) changes and improvements`);
});

test("groups results under the parsed filter summary", async () => {
    mockSearch("test", [
        {
            type: "Document",
            id: generateId<DocumentId>(),
            title: "Matching Document 1",
            titleMatches: [],
            bodySnippet: {
                text: "content",
                matches: [{index: 0, length: 7}],
            },
            parsedFilter: {summary: "documents created yesterday"},
        },
        {
            type: "Document",
            id: generateId<DocumentId>(),
            title: "Matching Document 2",
            titleMatches: [],
            bodySnippet: null,
            parsedFilter: {summary: "documents created yesterday"},
        },
        {
            type: "Post",
            id: generateId<PostId>(),
            title: "Non-matching Post",
            titleMatches: [],
            bodySnippet: {text: "post content", matches: []},
            author: createApiAccountMock({name: "John Smith"}),
        },
        {
            type: "Task",
            id: generateId<TaskId>(),
            title: "Non-matching Task",
            titleMatches: [],
            bodySnippet: null,
            status: {type: "Open", isActive: true},
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "test"})).toEqual(`\
## Documents created yesterday

1. [Matching Document 1](/document/matching-document-1)

   **content**

2. [Matching Document 2](/document/matching-document-2)

## Other

The following results don\u2019t match any natural language filter but Alpine thought they might be relevant anyway. Use your best judgement when determining if they\u2019re actually useful for responding to the user\u2019s request.

1. [Non-matching Post](/post/non-matching-post)

   post content

2. [Non-matching Task (Open, active)](/task/non-matching-task)`);
});

test("prints a section for every parsed filter summary", async () => {
    mockSearch("test", [
        {
            type: "Document",
            id: generateId<DocumentId>(),
            title: "Matching Document",
            titleMatches: [],
            bodySnippet: null,
            parsedFilter: {summary: "documents created yesterday"},
        },
        {
            type: "Post",
            id: generateId<PostId>(),
            title: "Matching Post",
            titleMatches: [],
            bodySnippet: null,
            author: createApiAccountMock({name: "John Smith"}),
            parsedFilter: {summary: "posts created yesterday"},
        },
        {
            type: "Task",
            id: generateId<TaskId>(),
            title: "Matching Task",
            titleMatches: [],
            bodySnippet: null,
            status: {type: "Open", isActive: true},
            parsedFilter: {summary: "tasks assigned to Jane"},
        },
        {
            type: "Chat",
            id: generateId<ChatId>(),
            title: "Non-matching Chat",
            titleMatches: [],
            bodySnippet: null,
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "test"})).toEqual(`\
## Documents created yesterday

1. [Matching Document](/document/matching-document)

## Posts created yesterday

1. [Matching Post](/post/matching-post)

## Tasks assigned to Jane

1. [Matching Task (Open, active)](/task/matching-task)

## Other

The following results don\u2019t match any natural language filter but Alpine thought they might be relevant anyway. Use your best judgement when determining if they\u2019re actually useful for responding to the user\u2019s request.

1. [Non-matching Chat](/chat/non-matching-chat)`);
});

test("does not print an Other section when every result matched a filter", async () => {
    mockSearch("test", [
        {
            type: "Document",
            id: generateId<DocumentId>(),
            title: "Matching Document",
            titleMatches: [],
            bodySnippet: null,
            parsedFilter: {summary: "documents created yesterday"},
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "test"})).toEqual(`\
## Documents created yesterday

1. [Matching Document](/document/matching-document)`);
});

test("dedupes pathnames for two entities with the same title", async () => {
    mockSearch("roadmap", [
        {
            type: "Document",
            id: generateId<DocumentId>(),
            title: "Roadmap",
            titleMatches: [],
            bodySnippet: null,
        },
        {
            type: "Document",
            id: generateId<DocumentId>(),
            title: "Roadmap",
            titleMatches: [],
            bodySnippet: null,
        },
    ]);

    expect(await callAgentWebSearchTool(context, {query: "roadmap"})).toEqual(`\
1. [Roadmap](/document/roadmap)

2. [Roadmap](/document/roadmap-2)`);
});

test("reuses the pathname for the same entity across searches", async () => {
    const documentId = generateId<DocumentId>();
    const results: Array<ApiSearchResultResponse> = [
        {
            type: "Document",
            id: documentId,
            title: "Test Document",
            titleMatches: [],
            bodySnippet: null,
        },
    ];

    mockSearch("first", results);
    mockSearch("second", results);

    const firstResponse = await callAgentWebSearchTool(context, {query: "first"});
    const secondResponse = await callAgentWebSearchTool(context, {query: "second"});

    expect({firstResponse, secondResponse}).toEqual({
        firstResponse: "1. [Test Document](/document/test-document)",
        secondResponse: "1. [Test Document](/document/test-document)",
    });
});

test("search result links can be read with the read tool", async () => {
    const accountId = generateId<AccountId>();

    mockSearch("alice", [
        {
            type: "Account",
            id: accountId,
            title: "Alice Smith",
            titleMatches: [{index: 0, length: 5}],
            bodySnippet: null,
            shortName: "Alice",
        },
    ]);

    api.mockGet("/spaces/{id}/accounts/{accountId}", {
        params: {path: {id: spaceId, accountId}},
        data: {
            account: {
                id: accountId,
                name: "Alice Smith",
                shortName: "Alice",
                space: {
                    role: "Member",
                    addedTime: serializeDateString(new Date("2026-01-01T00:00:00.000Z")),
                },
            },
        },
    });

    await callAgentWebSearchTool(context, {query: "alice"});

    expect(
        await callAgentWebReadTool(context, {path: "/human/alice-smith", limit: "10kb"}),
    ).toEqual(
        `\
# Alice Smith

- Role: Member
- Short name: Alice`,
    );
});
