import {printInboxEntryDisplayContentLatestMessageAsText} from "~/server/notifications/data/print_inbox_entry_display_content_latest_message_as_text.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

const alice = createTestAccountModel({name: "Alice"});

describe("printInboxEntryDisplayContentLatestMessageAsText", () => {
    test("excludes the author when their account is present in the title", () => {
        const result = printInboxEntryDisplayContentLatestMessageAsText(
            {
                time: new Date("2026-01-01T00:00:00Z"),
                brandIconType: "Chat",
                featuredAccount: alice,
                otherAccount: null,
                latestMessage: {author: alice, contentTextSnippet: "Hello"},
                title: [alice, " sent you a message"],
            },
            {excludeAuthorWhenPresentInTitle: true},
        );

        expect(result).toBe("Hello");
    });

    test("does not match an author name embedded in title text", () => {
        const result = printInboxEntryDisplayContentLatestMessageAsText(
            {
                time: new Date("2026-01-01T00:00:00Z"),
                brandIconType: "Post",
                featuredAccount: alice,
                otherAccount: null,
                latestMessage: {author: alice, contentTextSnippet: "Hello"},
                title: ["Alice project has new comments"],
            },
            {excludeAuthorWhenPresentInTitle: true},
        );

        expect(result).toBe("Alice: Hello");
    });
});
