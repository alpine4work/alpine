import {slackWorkspaceConnectedSuccessMessage} from "~/server/integrations/slack/internal/message_templates/slack_workspace_connected_success_message.js";

test("returns Alpine connection success text", () => {
    const result = slackWorkspaceConnectedSuccessMessage({
        spaceName: "My Team",
        spaceId: "space-123",
        edgeServiceUrl: "https://app.alpine.dev",
    });

    expect(result.text).toBe("🏔️ Your Alpine space has been connected to Slack!");
});

test("includes connection success text in first section block", () => {
    const result = slackWorkspaceConnectedSuccessMessage({
        spaceName: "My Team",
        spaceId: "space-123",
        edgeServiceUrl: "https://app.alpine.dev",
    });

    expect(result.blocks[0]).toMatchObject({
        type: "section",
        text: {
            type: "mrkdwn",
            text: "🏔️ Your Alpine space has been connected to Slack!",
        },
    });
});

test("includes connected space name in bold in second section block", () => {
    const result = slackWorkspaceConnectedSuccessMessage({
        spaceName: "My Team",
        spaceId: "space-123",
        edgeServiceUrl: "https://app.alpine.dev",
    });

    expect(result.blocks[1]).toMatchObject({
        type: "section",
        text: {
            type: "mrkdwn",
            text: "> Connected space: *My Team*",
        },
    });
});

test("builds settings URL from edgeServiceUrl and spaceId", () => {
    const result = slackWorkspaceConnectedSuccessMessage({
        spaceName: "My Team",
        spaceId: "space-abc",
        edgeServiceUrl: "https://app.alpine.dev",
    });

    expect(result.blocks[1]).toMatchObject({
        accessory: expect.objectContaining({
            url: "https://app.alpine.dev/settings/space-abc/integrations/slack",
        }),
    });
});

test("settings button has correct action ID", () => {
    const result = slackWorkspaceConnectedSuccessMessage({
        spaceName: "My Team",
        spaceId: "space-123",
        edgeServiceUrl: "https://app.alpine.dev",
    });

    expect(result.blocks[1]).toMatchObject({
        accessory: expect.objectContaining({
            action_id: "open_alpine_integration_settings",
        }),
    });
});

test("returns two blocks total", () => {
    const result = slackWorkspaceConnectedSuccessMessage({
        spaceName: "My Team",
        spaceId: "space-123",
        edgeServiceUrl: "https://app.alpine.dev",
    });

    expect(result.blocks).toHaveLength(2);
});
