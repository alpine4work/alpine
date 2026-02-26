export function slackAlpineNotificationMessage({
    title,
    subtitle,
    body,
    entryUrl,
}: {
    title: string;
    subtitle?: string;
    body: string;
    entryUrl: string;
}) {
    const markdownTitleText = subtitle ? `*${title}*\n${subtitle}` : `*${title}*`;
    return {
        text: subtitle ? `${title} ${subtitle}` : title,
        blocks: [
            {
                type: "section",
                text: {type: "mrkdwn", text: markdownTitleText},
            },
            {
                type: "section",
                text: {type: "mrkdwn", text: `> ${body}`},
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: {type: "plain_text", text: "Open in Alpine", emoji: true},
                        style: "primary",
                        url: entryUrl,
                        action_id: "open_in_alpine",
                    },
                ],
            },
        ],
    };
}
