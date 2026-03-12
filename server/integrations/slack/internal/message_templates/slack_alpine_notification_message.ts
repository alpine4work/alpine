export function slackAlpineNotificationMessage({
    title,
    body,
    plainText,
    entryUrl,
}: {
    title: string;
    body: string;
    plainText: string;
    entryUrl: string;
}) {
    return {
        text: plainText,
        blocks: [
            {
                type: "section",
                text: {type: "mrkdwn", text: title},
            },
            {
                type: "section",
                text: {type: "mrkdwn", text: `> ${body}`},
                accessory: {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "Open in Alpine",
                        emoji: true,
                    },
                    value: entryUrl,
                    url: entryUrl,
                    action_id: "open_in_alpine",
                },
            },
        ],
    };
}
