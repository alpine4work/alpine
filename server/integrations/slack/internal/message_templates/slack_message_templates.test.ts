import {generateSlackMessageBodyFromTemplate} from "~/server/integrations/slack/internal/message_templates/slack_message_templates.js";

test("generates SlackAlpineNotification message body with correct text", () => {
    const result = generateSlackMessageBodyFromTemplate("SlackAlpineNotification", {
        title: "Task assigned",
        body: "You have a new task",
        entryUrl: "https://example.com/task/1",
    });

    expect(result.text).toBe("Task assigned");
});

test("generates SlackAlpineNotification message body with blocks", () => {
    const result = generateSlackMessageBodyFromTemplate("SlackAlpineNotification", {
        title: "Task assigned",
        body: "You have a new task",
        entryUrl: "https://example.com/task/1",
    });

    expect(result.blocks).toHaveLength(3);
});

test("generates SlackAlpineNotification message with subtitle concatenated into text", () => {
    const result = generateSlackMessageBodyFromTemplate("SlackAlpineNotification", {
        title: "Task assigned",
        subtitle: "Bug: login fails",
        body: "You have a new task",
        entryUrl: "https://example.com/task/1",
    });

    expect(result.text).toBe("Task assigned Bug: login fails");
});

test("generates SlackWorkspaceConnectedSuccess message body with correct text", () => {
    const result = generateSlackMessageBodyFromTemplate("SlackWorkspaceConnectedSuccess", {
        spaceName: "My Space",
        spaceId: "space-abc",
        edgeServiceUrl: "https://alpine.dev",
    });

    expect(result.text).toBe("🏔️ Your Alpine space has been connected to Slack!");
});

test("generates SlackWorkspaceConnectedSuccess message body with blocks", () => {
    const result = generateSlackMessageBodyFromTemplate("SlackWorkspaceConnectedSuccess", {
        spaceName: "My Space",
        spaceId: "space-abc",
        edgeServiceUrl: "https://alpine.dev",
    });

    expect(result.blocks).toHaveLength(2);
});
