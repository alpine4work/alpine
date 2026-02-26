import {slackAlpineNotificationMessage} from "~/server/integrations/slack/internal/message_templates/slack_alpine_notification_message.js";

test("returns title as plain text when no subtitle is given", () => {
    const result = slackAlpineNotificationMessage({
        title: "New comment",
        body: "Hello world",
        entryUrl: "https://example.com/entry",
    });

    expect(result.text).toBe("New comment");
});

test("returns title and subtitle concatenated as plain text when subtitle is given", () => {
    const result = slackAlpineNotificationMessage({
        title: "New comment",
        subtitle: "In document",
        body: "Hello world",
        entryUrl: "https://example.com/entry",
    });

    expect(result.text).toBe("New comment In document");
});

test("formats title block as bold markdown when no subtitle", () => {
    const result = slackAlpineNotificationMessage({
        title: "New comment",
        body: "Hello world",
        entryUrl: "https://example.com/entry",
    });

    expect(result.blocks[0]).toMatchObject({
        type: "section",
        text: {type: "mrkdwn", text: "*New comment*"},
    });
});

test("formats title block as bold markdown with subtitle on new line when subtitle is given", () => {
    const result = slackAlpineNotificationMessage({
        title: "New comment",
        subtitle: "In document",
        body: "Hello world",
        entryUrl: "https://example.com/entry",
    });

    expect(result.blocks[0]).toMatchObject({
        type: "section",
        text: {type: "mrkdwn", text: "*New comment*\nIn document"},
    });
});

test("formats body as a blockquote section", () => {
    const result = slackAlpineNotificationMessage({
        title: "New comment",
        body: "Hello world",
        entryUrl: "https://example.com/entry",
    });

    expect(result.blocks[1]).toMatchObject({
        type: "section",
        text: {type: "mrkdwn", text: "> Hello world"},
    });
});

test("includes Open in Alpine button with the given entry URL", () => {
    const result = slackAlpineNotificationMessage({
        title: "New comment",
        body: "Hello world",
        entryUrl: "https://example.com/entry/123",
    });

    expect(result.blocks[2]).toMatchObject({
        type: "actions",
        elements: [
            expect.objectContaining({
                type: "button",
                url: "https://example.com/entry/123",
                action_id: "open_in_alpine",
            }),
        ],
    });
});

test("returns three blocks total", () => {
    const result = slackAlpineNotificationMessage({
        title: "Test",
        body: "Body",
        entryUrl: "https://example.com",
    });

    expect(result.blocks).toHaveLength(3);
});
