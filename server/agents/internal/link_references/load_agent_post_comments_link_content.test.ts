/* eslint-disable cyberworlds/string-quotes */
import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentPostCommentsLink} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {loadAgentPostCommentsLinkContent as actuallyLoadAgentPostCommentsLinkContent} from "~/server/agents/internal/link_references/load_agent_post_comments_link_content.js";
import {printAgentContentMarkdownTree} from "~/server/agents/internal/print_api_content_to_agent_markdown.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {ApiContentResponse} from "~/shared/api/types/api_specification_convenience_types.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertDateString} from "~/shared/helpers/date/date_string.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

const tracer = new TracerContextModule(testTracer);
const tracerRoot = tracer.getRoot();

const postCreationDate = assertDateString("2025-11-20T13:05:00Z");

const conversationStartDate = new Date("2025-11-21T13:05:00Z");
const conversationState = {
    startTime: conversationStartDate,
    timeZone: defaultTimeZone,
} as const;

const losAngelesTimeZone = assertTimeZone("America/Los_Angeles");
const chicagoTimeZone = assertTimeZone("America/Chicago");

// Helper to create sample content
function createSampleContent(...texts: Array<string>): ApiContentResponse {
    return {
        elements: texts.map(text => ({
            type: "Paragraph",
            elements: [{type: "Text", text}],
        })),
    };
}

async function loadAgentPostCommentsLinkContent(
    options: Parameters<typeof actuallyLoadAgentPostCommentsLinkContent>[0],
) {
    const {messagesContent} = await actuallyLoadAgentPostCommentsLinkContent(options);
    return messagesContent;
}

describe("loadAgentPostCommentsLinkContent", () => {
    const spaceId = generateId<SpaceId>();
    const client = new ApiClientMock();
    const request = {
        apiClient: client,
        spaceId,
    };
    const aliceAccount = createApiAccountMock({
        name: "Alice",
    });
    const bobAccount = createApiAccountMock({
        name: "Bob",
    });

    afterEach(() => {
        client.reset();
    });

    test("loads post with comments after creating a link to a post", async () => {
        const postId = generateId<PostId>();
        const authorId = generateId<AccountId>();
        const channelId = generateId<ChannelId>();

        client.mockGetPost(spaceId, postId, {
            author: createApiAccountMock({id: authorId, name: "Alice Author"}),
            channel: {id: channelId, name: "Announcements"},
            content: createSampleContent("This is a post about quarterly results."),
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(
            spaceId,
            postId,
            {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({
                            name: "Bob commentor",
                        }),
                        createdTime: assertDateString("2025-11-20T13:10:00Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("This is a comment on the post."),
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            },
            {cursor: undefined, limit: 30},
        );
        const link = (await createAgentLink(storage, {
            type: "Post",
            post: {
                id: postId,
                contentPreview: "This is a post about quarterly results.",
            },
        })) as AgentPostCommentsLink;

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a post in [Announcements](/channel/announcements) and its comments.

<time>November 20th at 8:05am EST</time>

<human name="Alice Author">
This is a post about quarterly results.
</human>

<human name="Bob commentor">
This is a comment on the post.
</human>
`);
    });

    test("loads post with comments and link to next page after creating a link to a post", async () => {
        const postId = generateId<PostId>();
        const authorId = generateId<AccountId>();
        const channelId = generateId<ChannelId>();

        client.mockGetPost(spaceId, postId, {
            author: createApiAccountMock({id: authorId, name: "Alice Author"}),
            channel: {id: channelId, name: "Announcements"},
            content: createSampleContent("This is a post about quarterly results."),
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(
            spaceId,
            postId,
            {
                totalMessageCount: 2,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({
                            name: "Bob commentor",
                        }),
                        createdTime: assertDateString("2025-11-21T13:24:00Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent(
                                "This is a comment on the post.".repeat(200),
                            ),
                        },
                        createdTimeZone: losAngelesTimeZone,
                    },
                    {
                        index: 1,
                        author: createApiAccountMock({
                            name: "Charlie commentor",
                        }),
                        createdTime: assertDateString("2025-11-21T13:25:00Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("This is a second comment on the post."),
                        },
                        createdTimeZone: losAngelesTimeZone,
                    },
                ],
            },
            {cursor: undefined, limit: 30},
        );
        const link = (await createAgentLink(storage, {
            type: "Post",
            post: {
                id: postId,
                contentPreview: "This is a post about quarterly results.",
            },
        })) as AgentPostCommentsLink;

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState: {
                    startTime: new Date(),
                    timeZone: defaultTimeZone,
                },
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a post in [Announcements](/channel/announcements) and its comments.

<time>November 20th at 8:05am EST</time>

<human name="Alice Author">
This is a post about quarterly results.
</human>

<time>November 21st at 8:24am EST</time>

<human name="Bob commentor" timezone="PST">
${"This is a comment on the post.".repeat(200)}
</human>

[Next page »](/post/this-is-a-post-about-quarterly-results?page=2)
`);
    });

    test("loads post with comments if current chunk loads the first comment", async () => {
        const postId = generateId<PostId>();

        client.mockGetPost(spaceId, postId, {
            author: aliceAccount,
            channel: {id: generateId(), name: "Announcements"},
            content: createSampleContent("This is a post about quarterly results."),
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 1,
            nextCursor: null,
            messages: [
                {
                    index: 0,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:24:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Hello Bob!"),
                    },
                    createdTimeZone: losAngelesTimeZone,
                },
            ],
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 2,
            nextCursor: null,
            messages: [
                {
                    index: 1,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:25:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Hi Alice, how are you?".repeat(200)),
                    },
                    createdTimeZone: defaultTimeZone,
                },
                {
                    index: 2,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:41:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("I'm doing great, thanks!"),
                    },
                    createdTimeZone: losAngelesTimeZone,
                },
            ],
        });

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link: {
                    type: "PostComments",
                    postId,
                    paginationType: "chunk",
                    pageNumber: 0,
                    pageInfo: {from: "Middle", index: 1},
                    rootMessage: null,
                    label: "Hi Alice, how are you?",
                    tokenLimitForPage: 1000,
                },
                conversationState,
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a [post](/post/test-post-content-preview) in [Announcements](/channel/announcements) and its comments.

<time>November 20th at 8:05am EST</time>

<human name="Alice">
This is a post about quarterly results.
</human>

<human name="Alice" time="19 minutes later" timezone="PST">
Hello Bob!
</human>

<human name="Alice">
${"Hi Alice, how are you?".repeat(200)}
</human>

[Next chunk »](/post/hi-alice-how-are-you?chunk=1)
`);
    });

    test("loads post with comments for first page of comments", async () => {
        const postId = generateId<PostId>();

        client.mockGetPost(spaceId, postId, {
            author: aliceAccount,
            channel: {id: generateId(), name: "General"},
            content: createSampleContent("Post content."),
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 1,
            nextCursor: null,
            messages: [
                {
                    index: 0,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:24:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Nice post!"),
                    },
                    createdTimeZone: chicagoTimeZone,
                },
                {
                    index: 0,
                    author: bobAccount,
                    createdTime: assertDateString("2025-11-20T13:25:00Z"),
                    payload: {
                        type: "Content",
                        content: parseApiContentFromMarkdown(
                            `
## This is a heading
- with
- a bulleted
- list
    - with a nested list
    - item
`,
                            {spaceId},
                        ) as ApiContentResponse,
                    },
                    createdTimeZone: losAngelesTimeZone,
                },
            ],
        });

        const link: AgentPostCommentsLink = {
            type: "PostComments",
            postId,
            paginationType: "page",
            pageNumber: 0,
            label: "Nice post!",
            pageInfo: {from: "Start", cursor: null},
            rootMessage: null,
            tokenLimitForPage: 1000,
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a post in [General](/channel/general) and its comments.

<time>November 20th at 8:05am EST</time>

<human name="Alice">
Post content.
</human>

<human name="Alice" time="19 minutes later" timezone="CST">
Nice post!
</human>

<human name="Bob" timezone="PST">
### This is a heading

- with

- a bulleted

- list

  - with a nested list

  - item
</human>
`);
    });

    test("loads post with comments if first comment is loaded when paginating from the end", async () => {
        const postId = generateId<PostId>();

        client.mockGetPost(spaceId, postId, {
            author: aliceAccount,
            channel: {id: generateId(), name: "General"},
            content: createSampleContent("Post content."),
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 3,
            nextCursor: null,
            messages: [
                {
                    index: 0,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:24:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("First comment!"),
                    },
                    createdTimeZone: chicagoTimeZone,
                },
                {
                    index: 1,
                    author: bobAccount,
                    createdTime: assertDateString("2025-11-20T13:25:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Second comment!"),
                    },
                    createdTimeZone: losAngelesTimeZone,
                },
                {
                    index: 2,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:41:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Third comment!"),
                    },
                    createdTimeZone: defaultTimeZone,
                },
            ],
        });

        const link: AgentPostCommentsLink = {
            type: "PostComments",
            postId,
            paginationType: "chunk",
            pageNumber: 0,
            label: "Third comment!",
            pageInfo: {from: "End", cursor: 3},
            rootMessage: null,
            tokenLimitForPage: 1000,
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a [post](/post/test-post-content-preview) in [General](/channel/general) and its comments.

<time>November 20th at 8:05am EST</time>

<human name="Alice">
Post content.
</human>

<human name="Alice" time="19 minutes later" timezone="CST">
First comment!
</human>

<human name="Bob" timezone="PST">
Second comment!
</human>

<human name="Alice" time="16 minutes later">
Third comment!
</human>
`);
    });

    test("doesn't load original post if middle chunk doesn't load the first comment", async () => {
        const postId = generateId<PostId>();

        client.mockGetPost(spaceId, postId, {
            author: aliceAccount,
            channel: {id: generateId(), name: "Announcements"},
            content: createSampleContent("Big news!"),
            contentPreview: "Alice in Announcements: Big news!",
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 2,
            nextCursor: 1,
            messages: [
                {
                    index: 2,
                    author: bobAccount,
                    createdTime: assertDateString("2025-11-20T13:10:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Second comment!".repeat(200)),
                    },
                    createdTimeZone: defaultTimeZone,
                },
            ],
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 2,
            nextCursor: 4,
            messages: [
                {
                    index: 3,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:11:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Third comment!"),
                    },
                    createdTimeZone: defaultTimeZone,
                },
                {
                    index: 4,
                    author: bobAccount,
                    createdTime: assertDateString("2025-11-20T13:12:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Fourth comment!".repeat(200)),
                    },
                    createdTimeZone: defaultTimeZone,
                },
            ],
        });

        const link: AgentPostCommentsLink = {
            type: "PostComments",
            postId,
            paginationType: "chunk",
            pageNumber: 0,
            label: "Third comment!",
            pageInfo: {from: "Middle", index: 3},
            rootMessage: null,
            tokenLimitForPage: 1000,
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are comments on a [post](/post/alice-in-announcements-big-news) in [Announcements](/channel/announcements).

[« Previous chunk](/post/third-comment?chunk=-1)

<time>November 20th at 8:10am EST</time>

<human name="Bob">
${"Second comment!".repeat(200)}
</human>

<human name="Alice">
Third comment!
</human>

<human name="Bob">
${"Fourth comment!".repeat(200)}
</human>

[Next chunk »](/post/third-comment?chunk=1)
`);
    });

    test("doesn't load original post when paginating from end if first comment isn't loaded", async () => {
        const postId = generateId<PostId>();

        client.mockGetPost(spaceId, postId, {
            author: aliceAccount,
            channel: {id: generateId(), name: "Announcements"},
            content: createSampleContent("Big news!"),
            contentPreview: "Alice in Announcements: Big news!",
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 1,
            nextCursor: 2,
            messages: [
                {
                    index: 3,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:13:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Exciting stuff!".repeat(400)),
                    },
                    createdTimeZone: defaultTimeZone,
                },
                {
                    index: 4,
                    author: bobAccount,
                    createdTime: assertDateString("2025-11-20T13:14:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Thanks Alice!"),
                    },
                    createdTimeZone: defaultTimeZone,
                },
            ],
        });

        const link: AgentPostCommentsLink = {
            type: "PostComments",
            postId,
            paginationType: "chunk",
            pageNumber: 0,
            label: "Exciting stuff!",
            pageInfo: {from: "End", cursor: 5},
            rootMessage: null,
            tokenLimitForPage: 1000,
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are comments on a [post](/post/alice-in-announcements-big-news) in [Announcements](/channel/announcements).

[« Previous chunk](/post/exciting-stuff?chunk=-1)

<time>November 20th at 8:13am EST</time>

<human name="Alice">
${"Exciting stuff!".repeat(400)}
</human>

<human name="Bob">
Thanks Alice!
</human>
`);
    });

    test("doesn't show link to next page if there are no more comments", async () => {
        const postId = generateId<PostId>();

        client.mockGetPost(spaceId, postId, {
            author: aliceAccount,
            channel: {id: generateId(), name: "General"},
            content: createSampleContent("Post content."),
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 2,
            nextCursor: null,
            messages: [
                {
                    index: 0,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-20T13:14:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("First comment!"),
                    },
                    createdTimeZone: defaultTimeZone,
                },
                {
                    index: 1,
                    author: bobAccount,
                    createdTime: assertDateString("2025-11-20T13:15:00Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Second comment!"),
                    },
                    createdTimeZone: defaultTimeZone,
                },
            ],
        });

        const link: AgentPostCommentsLink = {
            type: "PostComments",
            postId,
            paginationType: "page",
            pageNumber: 0,
            label: "First comment!",
            pageInfo: {from: "Start", cursor: null},
            rootMessage: null,
            tokenLimitForPage: 1000,
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a post in [General](/channel/general) and its comments.

<time>November 20th at 8:05am EST</time>

<human name="Alice">
Post content.
</human>

<human name="Alice">
First comment!
</human>

<human name="Bob">
Second comment!
</human>
`);
    });

    test("loads post without comments if there are no comments.", async () => {
        const postId = generateId<PostId>();
        const channelId = generateId<ChannelId>();

        const aliceAccount = createApiAccountMock({
            name: "Alice Author",
        });

        client.mockGetPost(spaceId, postId, {
            author: aliceAccount,
            channel: {id: channelId, name: "Announcements"},
            content: createSampleContent("This is a post about quarterly results."),
            createdTime: postCreationDate,
        });

        client.mockGetPostCommentsList(spaceId, postId, {
            totalMessageCount: 0,
            nextCursor: null,
            messages: [],
        });

        const link = (await createAgentLink(storage, {
            type: "Post",
            post: {
                id: postId,
                contentPreview: "This is a post about quarterly results.",
            },
        })) as AgentPostCommentsLink;

        const result = await storage.transaction(async transaction => {
            return loadAgentPostCommentsLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a post in [Announcements](/channel/announcements).

<time>November 20th at 8:05am EST</time>

<human name="Alice Author">
This is a post about quarterly results.
</human>
`);
    });
});
