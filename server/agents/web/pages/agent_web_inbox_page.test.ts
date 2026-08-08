import {fromDate, toCalendarDate} from "@internationalized/date";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {
    AgentWebInboxPage,
    intoAgentWebInboxPageEntry,
    normalizeAgentWebInboxPage,
    parseAgentWebInboxPage,
    printAgentWebInboxPage,
} from "~/server/agents/web/pages/agent_web_inbox_page.open_source.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiAccountReferenceResponse,
    ApiChannelReferenceResponse,
    ApiChatReferenceResponse,
    ApiDocumentReferenceResponse,
    ApiInboxEntryResponse,
    ApiPostReferenceResponse,
    ApiTaskReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

const calebId = generateId<AccountId>();
const engineeringChannelId = generateId<ChannelId>();
const generalChannelId = generateId<ChannelId>();
const designChannelId = generateId<ChannelId>();
const marketingChannelId = generateId<ChannelId>();
const launchPostId = generateId<PostId>();
const planningPostId = generateId<PostId>();
const recapPostId = generateId<PostId>();
const commentPostId = generateId<PostId>();
const roadmapDocumentId = generateId<DocumentId>();
const specDocumentId = generateId<DocumentId>();
const specThreadId = generateId<DocumentCommentThreadId>();
const standupChatId = generateId<ChatId>();
const reviewTaskId = generateId<TaskId>();

const calebReference: ApiAccountReferenceResponse = {
    type: "Account",
    id: calebId,
    title: "Caleb",
    shortName: "Caleb",
};

runAgentWebPageTests<AccountId, AgentWebInboxPage>({
    print: printAgentWebInboxPage,
    parse: parseAgentWebInboxPage,
    normalize: normalizeAgentWebInboxPage,
    tests: [
        {
            name: "new notifications inbox with single page",
            pageLink: calebId,
            markdown: `\
Showing new notifications for [Caleb](/human/caleb). ([See done notifications](/human/caleb/inbox?status=done))

- <badge>2</badge> [New posts in Engineering](/channel/engineering) (May 14th at 2:34pm EDT)

  Alice: Take a look at our new launch video!

- [New posts in General](/channel/general) (May 14th at 9:00am EDT)

  Bob: This is great!

End of new notifications.
`,
            page: {
                type: "Inbox",
                account: calebReference,
                status: "New",
                pagination: null,
                entries: [
                    {
                        link: {type: "Channel", id: engineeringChannelId, title: "Engineering"},
                        title: "New posts in Engineering",
                        preview: "Alice: Take a look at our new launch video!",
                        timeAttribute: "May 14th at 2:34pm EDT",
                        loudNotificationCount: 2,
                    },
                    {
                        link: {type: "Channel", id: generalChannelId, title: "General"},
                        title: "New posts in General",
                        preview: "Bob: This is great!",
                        timeAttribute: "May 14th at 9:00am EDT",
                        loudNotificationCount: 0,
                    },
                ],
                isEndOfEntries: true,
            },
        },
        {
            name: "done notifications inbox page",
            pageLink: calebId,
            markdown: `\
Showing done notifications for [Caleb](/human/caleb). ([See new notifications](/human/caleb/inbox))

- <badge>1</badge> [New comment on your post](/post/launch-notes) (May 14th at 10:55am EDT)

  Bob: This is great!

End of done notifications.
`,
            page: {
                type: "Inbox",
                account: calebReference,
                status: "Done",
                pagination: null,
                entries: [
                    {
                        link: {type: "Post", id: launchPostId, title: "Launch notes"},
                        title: "New comment on your post",
                        preview: "Bob: This is great!",
                        timeAttribute: "May 14th at 10:55am EDT",
                        loudNotificationCount: 1,
                    },
                ],
                isEndOfEntries: true,
            },
        },
        {
            name: "new notifications inbox with more pages",
            pageLink: calebId,
            markdown: `\
Showing new notifications for [Caleb](/human/caleb). ([See done notifications](/human/caleb/inbox?status=done))

- <badge>3</badge> [New posts in Design](/channel/design) (May 14th at 2:34pm EDT)

  Alice: New mockups are ready

[Next page »](/human/caleb/inbox?after=page2cursor)
`,
            page: {
                type: "Inbox",
                account: calebReference,
                status: "New",
                pagination: {nextCursor: "page2cursor"},
                entries: [
                    {
                        link: {type: "Channel", id: designChannelId, title: "Design"},
                        title: "New posts in Design",
                        preview: "Alice: New mockups are ready",
                        timeAttribute: "May 14th at 2:34pm EDT",
                        loudNotificationCount: 3,
                    },
                ],
                isEndOfEntries: false,
            },
        },
        {
            name: "done notifications inbox with more pages",
            pageLink: calebId,
            markdown: `\
Showing done notifications for [Caleb](/human/caleb). ([See new notifications](/human/caleb/inbox))

- [New comment on your post](/post/q3-planning) (May 14th at 10:55am EDT)

  Bob: Thanks for the fix!

[Next page »](/human/caleb/inbox?after=page2cursor&status=Done)
`,
            page: {
                type: "Inbox",
                account: calebReference,
                status: "Done",
                pagination: {nextCursor: "page2cursor"},
                entries: [
                    {
                        link: {type: "Post", id: planningPostId, title: "Q3 planning"},
                        title: "New comment on your post",
                        preview: "Bob: Thanks for the fix!",
                        timeAttribute: "May 14th at 10:55am EDT",
                        loudNotificationCount: 0,
                    },
                ],
                isEndOfEntries: false,
            },
        },
        {
            // Covers the markdown for every entry link type in a single page: the message
            // deep-links (`ChatMessage`, `PostMessage`, `DocumentMessage`, `TaskMessage`), the
            // entity links (`Document`, `Channel`, `Post`), and a private/deleted entry that
            // has no link and renders its title as plain text.
            name: "new notifications inbox with every entry type",
            pageLink: calebId,
            markdown: `\
Showing new notifications for [Caleb](/human/caleb). ([See done notifications](/human/caleb/inbox?status=done))

- <badge>1</badge> [Caleb sent you a message](/chat-message/caleb-are-you-free-at-3) (May 14th at 2:34pm EDT)

  Caleb: Are you free at 3?

- [New comment on your post](/post-comment/bob-nice-work) (May 14th at 9:00am EDT)

  Bob: Nice work

- [New threads in Product Roadmap](/document/product-roadmap) (May 14th at 9:05am EDT)

  Dana: Please take a look

- [New comment in Design Spec](/document-comment/dana-what-do-you-think) (May 14th at 9:10am EDT)

  Dana: What do you think?

- [New comment on your task](/task-comment/evan-can-you-take-this) (May 14th at 9:15am EDT)

  Evan: Can you take this?

- [New posts in Marketing](/channel/marketing) (May 14th at 9:20am EDT)

  Fran: Campaign is live

- <badge>1</badge> [You were mentioned in a post](/post/launch-recap) (May 14th at 9:25am EDT)

- <badge>1</badge> New comment in a private channel (May 14th at 9:30am EDT)

End of new notifications.
`,
            page: {
                type: "Inbox",
                account: calebReference,
                status: "New",
                pagination: null,
                entries: [
                    {
                        link: {
                            type: "ChatMessage",
                            id: standupChatId,
                            index: 7,
                            authorShortName: "Caleb",
                            preview: "Are you free at 3?",
                        },
                        title: "Caleb sent you a message",
                        preview: "Caleb: Are you free at 3?",
                        timeAttribute: "May 14th at 2:34pm EDT",
                        loudNotificationCount: 1,
                    },
                    {
                        link: {
                            type: "PostMessage",
                            id: commentPostId,
                            index: 2,
                            authorShortName: "Bob",
                            preview: "Nice work",
                        },
                        title: "New comment on your post",
                        preview: "Bob: Nice work",
                        timeAttribute: "May 14th at 9:00am EDT",
                        loudNotificationCount: 0,
                    },
                    {
                        link: {type: "Document", id: roadmapDocumentId, title: "Product Roadmap"},
                        title: "New threads in Product Roadmap",
                        preview: "Dana: Please take a look",
                        timeAttribute: "May 14th at 9:05am EDT",
                        loudNotificationCount: 0,
                    },
                    {
                        link: {
                            type: "DocumentMessage",
                            id: specDocumentId,
                            threadId: specThreadId,
                            index: 1,
                            authorShortName: "Dana",
                            preview: "What do you think?",
                        },
                        title: "New comment in Design Spec",
                        preview: "Dana: What do you think?",
                        timeAttribute: "May 14th at 9:10am EDT",
                        loudNotificationCount: 0,
                    },
                    {
                        link: {
                            type: "TaskMessage",
                            id: reviewTaskId,
                            index: 5,
                            authorShortName: "Evan",
                            preview: "Can you take this?",
                        },
                        title: "New comment on your task",
                        preview: "Evan: Can you take this?",
                        timeAttribute: "May 14th at 9:15am EDT",
                        loudNotificationCount: 0,
                    },
                    {
                        link: {type: "Channel", id: marketingChannelId, title: "Marketing"},
                        title: "New posts in Marketing",
                        preview: "Fran: Campaign is live",
                        timeAttribute: "May 14th at 9:20am EDT",
                        loudNotificationCount: 0,
                    },
                    {
                        link: {type: "Post", id: recapPostId, title: "Launch Recap"},
                        title: "You were mentioned in a post",
                        preview: null,
                        timeAttribute: "May 14th at 9:25am EDT",
                        loudNotificationCount: 1,
                    },
                    {
                        link: null,
                        title: "New comment in a private channel",
                        preview: null,
                        timeAttribute: "May 14th at 9:30am EDT",
                        loudNotificationCount: 1,
                    },
                ],
                isEndOfEntries: true,
            },
        },
    ],
});

// `intoAgentWebInboxPageEntry` picks the link target per entry type and drops the
// link (rendering the title as plain text) when the referenced entity is private
// or deleted. It also derives the message link's author and preview, falling back
// to the featured account and the notification title when the entry has no
// message. These tests cover link selection for each entry type in the accessible,
// deleted, and inaccessible (private) states, plus the preview/author fallbacks.
describe("intoAgentWebInboxPageEntry()", () => {
    const alice = createApiAccountMock({name: "Alice"});

    const conversionContext = {
        timeZone: defaultTimeZone,
        contextTime: new Date("2026-05-14T18:00:00Z"),
        contextDate: toCalendarDate(fromDate(new Date("2026-05-14T18:00:00Z"), defaultTimeZone)),
    };

    // Shared across every entry type: the preview's `Account` item drives the
    // message-link `authorShortName` and its `Text` item drives the message-link
    // `preview`. Derived from the response union so the title/featured account types
    // match the strict response `Account` (not the looser request `Account`).
    type InboxEntrySharedResponseFields = Pick<
        Extract<ApiInboxEntryResponse, {type: "Chat"}>,
        "title" | "preview" | "time" | "loudNotificationCount" | "status" | "featured"
    >;
    const sharedFields: InboxEntrySharedResponseFields = {
        title: [{type: "Text", text: "New notification"}],
        preview: [
            {type: "Account", account: alice},
            {type: "Text", text: "Take a look"},
        ],
        time: serializeDateString(new Date("2026-05-14T14:34:00Z")),
        loudNotificationCount: 0,
        status: "New",
        featured: {type: "Account", account: alice},
    };

    const chatId = generateId<ChatId>();
    const taskId = generateId<TaskId>();
    const channelId = generateId<ChannelId>();
    const channelPostId = generateId<PostId>();
    const postId = generateId<PostId>();
    const documentId = generateId<DocumentId>();
    const documentThreadId = generateId<DocumentCommentThreadId>();

    function link(entry: ApiInboxEntryResponse) {
        return intoAgentWebInboxPageEntry(entry, conversionContext).link;
    }

    describe("Chat entry", () => {
        function chatEntry(chat: ApiChatReferenceResponse): ApiInboxEntryResponse {
            return {...sharedFields, type: "Chat", chat, previewMessage: {index: 4}};
        }

        test("links to the message when the chat is accessible", () => {
            expect(link(chatEntry({type: "Chat", id: chatId, title: "Design room"}))).toEqual({
                type: "ChatMessage",
                id: chatId,
                index: 4,
                authorShortName: "Alice",
                preview: "Take a look",
            });
        });

        test.each<[string, ApiChatReferenceResponse]>([
            ["deleted", {type: "Chat", id: chatId, title: "Deleted chat", deleted: true}],
            ["inaccessible", {type: "Chat", id: chatId, title: "Private chat", private: true}],
        ])("has no link when the chat is %s", (_state, chat) => {
            expect(link(chatEntry(chat))).toBeNull();
        });
    });

    describe("CreatedChannelPosts entry", () => {
        function channelPostsEntry(channel: ApiChannelReferenceResponse): ApiInboxEntryResponse {
            return {
                ...sharedFields,
                type: "CreatedChannelPosts",
                channel,
                posts: [{id: channelPostId}],
            };
        }

        test("links to the channel when it is accessible", () => {
            expect(
                link(channelPostsEntry({type: "Channel", id: channelId, title: "Engineering"})),
            ).toEqual({type: "Channel", id: channelId, title: "Engineering"});
        });

        test.each<[string, ApiChannelReferenceResponse]>([
            ["deleted", {type: "Channel", id: channelId, title: "Deleted channel", deleted: true}],
            [
                "inaccessible",
                {type: "Channel", id: channelId, title: "Private channel", private: true},
            ],
        ])("has no link when the channel is %s", (_state, channel) => {
            expect(link(channelPostsEntry(channel))).toBeNull();
        });
    });

    describe("Post entry", () => {
        function postEntry(
            post: ApiPostReferenceResponse,
            previewMessage?: {index: number},
        ): ApiInboxEntryResponse {
            return {...sharedFields, type: "Post", post, previewMessage};
        }

        test("links to the comment when a comment is surfaced", () => {
            expect(
                link(postEntry({type: "Post", id: postId, title: "Launch notes"}, {index: 2})),
            ).toEqual({
                type: "PostMessage",
                id: postId,
                index: 2,
                authorShortName: "Alice",
                preview: "Take a look",
            });
        });

        test("links to the post itself for a body mention", () => {
            expect(link(postEntry({type: "Post", id: postId, title: "Launch notes"}))).toEqual({
                type: "Post",
                id: postId,
                title: "Launch notes",
            });
        });

        test.each<[string, ApiPostReferenceResponse]>([
            ["deleted", {type: "Post", id: postId, title: "Deleted post", deleted: true}],
            ["inaccessible", {type: "Post", id: postId, title: "Private post", private: true}],
        ])("has no link when the post is %s", (_state, post) => {
            expect(link(postEntry(post, {index: 2}))).toBeNull();
        });
    });

    describe("CreatedDocumentThreads entry", () => {
        function documentThreadsEntry(
            document: ApiDocumentReferenceResponse,
        ): ApiInboxEntryResponse {
            return {
                ...sharedFields,
                type: "CreatedDocumentThreads",
                document,
                threads: [{id: documentThreadId}],
            };
        }

        test("links to the document when it is accessible", () => {
            expect(
                link(documentThreadsEntry({type: "Document", id: documentId, title: "Roadmap"})),
            ).toEqual({type: "Document", id: documentId, title: "Roadmap"});
        });

        test.each<[string, ApiDocumentReferenceResponse]>([
            [
                "deleted",
                {type: "Document", id: documentId, title: "Deleted document", deleted: true},
            ],
            [
                "inaccessible",
                {type: "Document", id: documentId, title: "Private document", private: true},
            ],
        ])("has no link when the document is %s", (_state, document) => {
            expect(link(documentThreadsEntry(document))).toBeNull();
        });
    });

    describe("DocumentThread entry", () => {
        function documentThreadEntry(
            document: ApiDocumentReferenceResponse,
        ): ApiInboxEntryResponse {
            return {
                ...sharedFields,
                type: "DocumentThread",
                document,
                thread: {id: documentThreadId},
                previewMessage: {index: 1},
            };
        }

        test("links to the message when the document is accessible", () => {
            expect(
                link(documentThreadEntry({type: "Document", id: documentId, title: "Roadmap"})),
            ).toEqual({
                type: "DocumentMessage",
                id: documentId,
                threadId: documentThreadId,
                index: 1,
                authorShortName: "Alice",
                preview: "Take a look",
            });
        });

        test.each<[string, ApiDocumentReferenceResponse]>([
            [
                "deleted",
                {type: "Document", id: documentId, title: "Deleted document", deleted: true},
            ],
            [
                "inaccessible",
                {type: "Document", id: documentId, title: "Private document", private: true},
            ],
        ])("has no link when the document is %s", (_state, document) => {
            expect(link(documentThreadEntry(document))).toBeNull();
        });
    });

    describe("TaskMessages entry", () => {
        function taskEntry(task: ApiTaskReferenceResponse): ApiInboxEntryResponse {
            return {...sharedFields, type: "TaskMessages", task, previewMessage: {index: 5}};
        }

        test("links to the comment when the task is accessible", () => {
            expect(
                link(
                    taskEntry({
                        type: "Task",
                        id: taskId,
                        title: "Fix login bug",
                        status: {type: "Open", isActive: true},
                    }),
                ),
            ).toEqual({
                type: "TaskMessage",
                id: taskId,
                index: 5,
                authorShortName: "Alice",
                preview: "Take a look",
            });
        });

        test.each<[string, ApiTaskReferenceResponse]>([
            [
                "deleted",
                {
                    type: "Task",
                    id: taskId,
                    title: "Deleted task",
                    status: {type: "Closed"},
                    deleted: true,
                },
            ],
            [
                "inaccessible",
                {
                    type: "Task",
                    id: taskId,
                    title: "Private task",
                    status: {type: "Closed"},
                    private: true,
                },
            ],
        ])("has no link when the task is %s", (_state, task) => {
            expect(link(taskEntry(task))).toBeNull();
        });
    });

    // An entry can arrive without a preview (e.g. an attachment-only message whose
    // text snippet is empty). The message link then takes its author from the
    // `featured` account and its preview slug from the notification title, and the
    // entry's own preview is `null`. `featured` here is a different account than the
    // preview author used elsewhere so the fallback source is observable.
    describe("preview and author fallbacks", () => {
        function noMessageChatEntry(): ApiInboxEntryResponse {
            return {
                ...sharedFields,
                preview: undefined,
                featured: {type: "Account", account: createApiAccountMock({name: "Zoe"})},
                type: "Chat",
                chat: {type: "Chat", id: chatId, title: "Design room"},
                previewMessage: {index: 4},
            };
        }

        test("takes the message link author from featured and its preview from the title", () => {
            expect(link(noMessageChatEntry())).toEqual({
                type: "ChatMessage",
                id: chatId,
                index: 4,
                authorShortName: "Zoe",
                preview: "New notification",
            });
        });

        test("has a null entry preview when there is no message", () => {
            expect(
                intoAgentWebInboxPageEntry(noMessageChatEntry(), conversionContext).preview,
            ).toBeNull();
        });
    });
});
