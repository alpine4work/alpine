import {generateSlackMessageBodyFromTemplate} from "~/server/integrations/slack/internal/message_templates/slack_message_templates.js";

test("generates SlackAlpineNotification message body", () => {
    const result = generateSlackMessageBodyFromTemplate("SlackAlpineNotification", {
        title: "Task assigned",
        body: "You have a new task",
        plainText: "Task assigned",
        entryUrl: "https://test.cyberworlds.dev/task/1",
    });

    expect(result.blocks).not.toBeNull();
});

test("generates SlackWorkspaceConnectedSuccess message body", () => {
    const result = generateSlackMessageBodyFromTemplate("SlackWorkspaceConnectedSuccess", {
        spaceName: "My Space",
        spaceId: "space-abc",
        edgeServiceUrl: "https://test.cyberworlds.dev",
    });

    expect(result.blocks).not.toBeNull();
});

test("generates SlackAccountConnectedSuccess message body", () => {
    const result = generateSlackMessageBodyFromTemplate("SlackAccountConnectedSuccess", {
        spaceName: "My Space",
        spaceId: "space-abc",
        edgeServiceUrl: "https://test.cyberworlds.dev",
    });

    expect(result.blocks).not.toBeNull();
});
