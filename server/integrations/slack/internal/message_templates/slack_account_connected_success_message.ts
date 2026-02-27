export function slackAccountConnectedSuccessMessage({
    spaceName,
    spaceId,
    edgeServiceUrl,
}: {
    spaceName: string;
    spaceId: string;
    edgeServiceUrl: string;
}) {
    return {
        text: "🏔️ Your Alpine account has been connected to Slack!",
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "🏔️ Your Alpine account has been connected to Slack!",
                },
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `> Connected space: *${spaceName}*`,
                },
                accessory: {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "Open Alpine settings",
                        emoji: true,
                    },
                    value: "open_alpine_integration_settings",
                    url: `${edgeServiceUrl}/s/${spaceId}/settings/integrations/slack`,
                    action_id: "open_alpine_integration_settings",
                },
            },
        ],
    };
}
