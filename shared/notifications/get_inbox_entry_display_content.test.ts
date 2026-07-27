import {DocumentPreviewModel} from "~/shared/documents/document_model.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    InboxEntryDisplayContentTitleItem,
    getInboxEntryDisplayContent,
} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

function titleToString(title: ReadonlyArray<InboxEntryDisplayContentTitleItem>): string {
    return title.map(item => (typeof item === "string" ? item : item.initialData.name)).join("");
}

function createTestDocumentPreview({title}: {title: string}) {
    return new DocumentPreviewModel({
        id: generateId<DocumentId>(),
        createdTime: new Date("2025-01-01T00:00:00Z"),
        spaceId: generateId<SpaceId>(),
        version: 1,
        isDeleted: false,
        titleWithoutFallback: title,
        accessPolicy: {
            type: "Local",
            defaultGrant: {level: "View"},
            urlGrant: null,
            accountGrantById: new Map(),
        },
    });
}

const alice = createTestAccountModel({name: "Alice"});
const bob = createTestAccountModel({name: "Bob"});
const time = new Date("2025-06-01T00:00:00Z");

describe("getInboxEntryDisplayContent", () => {
    describe("DocumentCommentThread", () => {
        test("does not show document title when document is deleted", () => {
            const entry = new InboxDocumentCommentThreadEntryModel({
                spaceId: generateId<SpaceId>(),
                accountId: alice.id,
                loudNotificationCount: 1,
                isArchived: false,
                document: {isPrivate: true, isDeleted: true, documentId: generateId<DocumentId>()},
                commentThreadId: generateId<DocumentCommentThreadId>(),
                firstCommentAuthor: bob,
                latestComment: {
                    author: bob,
                    createdTime: time,
                    index: 0,
                    contentTextSnippet: "Hello",
                    isStickyMention: false,
                },
                otherCommentAuthor: null,
                isFromNewCommentThread: false,
            });

            const display = getInboxEntryDisplayContent({
                entry,
                locale: defaultLocale,
                currentAccount: alice,
            });

            const text = titleToString(display.title);
            expect(text).toContain("a deleted document");
            expect(text).not.toContain("a private document");
        });

        test("shows private document when not deleted", () => {
            const entry = new InboxDocumentCommentThreadEntryModel({
                spaceId: generateId<SpaceId>(),
                accountId: alice.id,
                loudNotificationCount: 1,
                isArchived: false,
                document: {isPrivate: true, isDeleted: false, documentId: generateId<DocumentId>()},
                commentThreadId: generateId<DocumentCommentThreadId>(),
                firstCommentAuthor: bob,
                latestComment: {
                    author: bob,
                    createdTime: time,
                    index: 0,
                    contentTextSnippet: "Hello",
                    isStickyMention: false,
                },
                otherCommentAuthor: null,
                isFromNewCommentThread: false,
            });

            const display = getInboxEntryDisplayContent({
                entry,
                locale: defaultLocale,
                currentAccount: alice,
            });

            const text = titleToString(display.title);
            expect(text).toContain("a private document");
            expect(text).not.toContain("a deleted document");
        });

        test("shows document title when document is accessible", () => {
            const docPreview = createTestDocumentPreview({title: "My Secret Plan"});

            const entry = new InboxDocumentCommentThreadEntryModel({
                spaceId: generateId<SpaceId>(),
                accountId: alice.id,
                loudNotificationCount: 1,
                isArchived: false,
                document: {isPrivate: false, document: docPreview},
                commentThreadId: generateId<DocumentCommentThreadId>(),
                firstCommentAuthor: bob,
                latestComment: {
                    author: bob,
                    createdTime: time,
                    index: 0,
                    contentTextSnippet: "Hello",
                    isStickyMention: false,
                },
                otherCommentAuthor: null,
                isFromNewCommentThread: false,
            });

            const display = getInboxEntryDisplayContent({
                entry,
                locale: defaultLocale,
                currentAccount: alice,
            });

            const text = titleToString(display.title);
            expect(text).toContain("My Secret Plan");
            expect(text).not.toContain("a deleted document");
        });

        test("does not leak document title in mention summary for deleted document", () => {
            const entry = new InboxDocumentCommentThreadEntryModel({
                spaceId: generateId<SpaceId>(),
                accountId: alice.id,
                loudNotificationCount: 1,
                isArchived: false,
                document: {isPrivate: true, isDeleted: true, documentId: generateId<DocumentId>()},
                commentThreadId: generateId<DocumentCommentThreadId>(),
                firstCommentAuthor: bob,
                latestComment: {
                    author: bob,
                    createdTime: time,
                    index: 0,
                    contentTextSnippet: "Hey check this out",
                    isStickyMention: true,
                },
                otherCommentAuthor: null,
                isFromNewCommentThread: false,
            });

            const display = getInboxEntryDisplayContent({
                entry,
                locale: defaultLocale,
                currentAccount: alice,
            });

            const text = titleToString(display.title);
            expect(text).toContain("a deleted document");
            expect(text).not.toContain("a private document");
        });
    });

    describe("DocumentNewCommentThreads", () => {
        test("does not show document title when document is deleted", () => {
            const entry = new InboxDocumentNewCommentThreadsEntryModel({
                spaceId: generateId<SpaceId>(),
                accountId: alice.id,
                loudNotificationCount: 0,
                isArchived: false,
                document: {isPrivate: true, isDeleted: true, documentId: generateId<DocumentId>()},
                bucketGeneration: 0,
                commentThreadAuthorCount: 1,
                commentThreadIds: new Set([generateId<DocumentCommentThreadId>()]),
                firstCommentThread: {
                    author: bob,
                    createdTime: time,
                    contentTextSnippet: "Hello",
                },
                otherCommentThreadAuthor: null,
            });

            const display = getInboxEntryDisplayContent({
                entry,
                locale: defaultLocale,
                currentAccount: alice,
            });

            const text = titleToString(display.title);
            expect(text).toContain("a deleted document");
            expect(text).not.toContain("a private document");
        });

        test("shows private document when not deleted", () => {
            const entry = new InboxDocumentNewCommentThreadsEntryModel({
                spaceId: generateId<SpaceId>(),
                accountId: alice.id,
                loudNotificationCount: 0,
                isArchived: false,
                document: {isPrivate: true, isDeleted: false, documentId: generateId<DocumentId>()},
                bucketGeneration: 0,
                commentThreadAuthorCount: 1,
                commentThreadIds: new Set([generateId<DocumentCommentThreadId>()]),
                firstCommentThread: {
                    author: bob,
                    createdTime: time,
                    contentTextSnippet: "Hello",
                },
                otherCommentThreadAuthor: null,
            });

            const display = getInboxEntryDisplayContent({
                entry,
                locale: defaultLocale,
                currentAccount: alice,
            });

            const text = titleToString(display.title);
            expect(text).toContain("a private document");
            expect(text).not.toContain("a deleted document");
        });

        test("shows document title when document is accessible", () => {
            const docPreview = createTestDocumentPreview({title: "Budget Report"});

            const entry = new InboxDocumentNewCommentThreadsEntryModel({
                spaceId: generateId<SpaceId>(),
                accountId: alice.id,
                loudNotificationCount: 0,
                isArchived: false,
                document: {isPrivate: false, document: docPreview},
                bucketGeneration: 0,
                commentThreadAuthorCount: 1,
                commentThreadIds: new Set([generateId<DocumentCommentThreadId>()]),
                firstCommentThread: {
                    author: bob,
                    createdTime: time,
                    contentTextSnippet: "Hello",
                },
                otherCommentThreadAuthor: null,
            });

            const display = getInboxEntryDisplayContent({
                entry,
                locale: defaultLocale,
                currentAccount: alice,
            });

            const text = titleToString(display.title);
            expect(text).toContain("Budget Report");
            expect(text).not.toContain("a deleted document");
        });
    });
});
