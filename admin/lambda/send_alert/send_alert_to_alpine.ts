/* eslint-disable string-quotes */
/* eslint-disable no-console */

import {
    SendAlertAvailableChannel,
    sendAlertAvailableChannels,
} from "~/admin/lambda/send_alert/send_alert_available_channels.js";
import {GitHubActionsEventPayload} from "~/admin/lambda/send_alert/send_alert_github_actions.js";
import {HoneycombEventPayload} from "~/admin/lambda/send_alert/send_alert_honeycomb.js";
import {PagerDutyEventPayload} from "~/admin/lambda/send_alert/send_alert_pagerduty.js";
import {
    gitHubUsernameToAlpineId,
    pagerDutyIdToAlpineId,
} from "~/admin/lambda/send_alert/send_alert_user_mappings.js";
import {
    ApiContent,
    ApiContentMentionInlineElement,
    ApiContentParagraphBlockElement,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/types/api_specification_types.js";

type ApiContentElement = ApiContent["elements"][number];
type SendAlertResult = {ok: true} | {ok: false; error: string; statusCode?: number};

// Create a user mention or link element based on available mappings
function createUserElement(
    displayName: string,
    url: string,
    id: string,
): ApiSpecification.components["schemas"]["ContentInlineElement"] {
    const alpineId =
        pagerDutyIdToAlpineId[id.toLowerCase()] || gitHubUsernameToAlpineId[id.toLowerCase()];

    if (alpineId) {
        const mention: ApiContentMentionInlineElement = {
            type: "Mention",
            targetPath: `/accounts/${alpineId}`,
            isAccountShortName: true,
        };

        return mention;
    }

    return {
        type: "Text",
        text: displayName,
        marks: [
            {
                type: "Link",
                url: url,
            },
        ],
    };
}

function createHeaderElements(
    title: string,
    actions?: Array<{label: string; url: string}>,
): Array<ApiContentElement> {
    const elements: Array<ApiContentElement> = [
        {
            type: "Heading",
            level: 2,
            elements: [
                {
                    type: "Text",
                    text: title,
                },
            ],
        },
    ];

    if (actions && actions.length > 0) {
        const actionElements: Array<ApiContentParagraphBlockElement["elements"][number]> = [];

        actions.forEach((action, index) => {
            if (index > 0) {
                actionElements.push({
                    type: "Text",
                    text: " • ",
                });
            }

            actionElements.push({
                type: "Text",
                text: action.label,
                marks: [
                    {
                        type: "Link",
                        url: action.url,
                    },
                ],
            });
        });

        elements.push({
            type: "Paragraph",
            elements: actionElements,
        });
    }

    return elements;
}

async function sendAlertToAlpine(
    channel: string,
    channelId: string,
    content: ApiContent,
): Promise<SendAlertResult> {
    const alpineAPIKey = process.env.ALPINE_API_KEY;
    if (!alpineAPIKey) {
        console.error("ALPINE_API_KEY is not set in environment variables");
        return {
            ok: false,
            error: "ALPINE_API_KEY is not set in environment variables",
            statusCode: 500,
        };
    }

    // Get base URL and construct API endpoint
    const edgeServiceUrl = process.env.EDGE_SERVICE_URL;
    if (!edgeServiceUrl) {
        console.error("EDGE_SERVICE_URL is not set in environment variables");
        return {
            ok: false,
            error: "EDGE_SERVICE_URL is not set in environment variables",
            statusCode: 500,
        };
    }

    // Insert api. before the domain name
    const apiUrl = edgeServiceUrl.replace("://", "://api.") + "/posts";
    const body = {
        channelId,
        content,
    };

    console.log(`Sending to ${channel}`);
    console.log(JSON.stringify(body, null, 2));

    try {
        // eslint-disable-next-line no-global-fetch
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${alpineAPIKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to send alert: ${response.status} ${response.statusText}`);
            console.error(`Response: ${errorText}`);
            return {
                ok: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                statusCode: response.status,
            };
        }

        return {ok: true};
    } catch (error) {
        console.error("Error sending alert:", error);
        return {
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
            statusCode: 500,
        };
    }
}

export async function sendPagerDutyAlertToAlpine(
    data: PagerDutyEventPayload,
): Promise<SendAlertResult> {
    const channel: SendAlertAvailableChannel = "alerts";
    const channelId = sendAlertAvailableChannels[channel];

    console.log("Received PagerDuty event");
    console.log(JSON.stringify(data, null, 2));

    // Only send incident events
    if (data.event.data.type !== "incident") {
        console.debug(`Ignoring PagerDuty event of type '${data.event.data.type}'`);
        return {ok: true};
    }

    const incidentData = data.event.data;

    const elements: Array<ApiContentElement> = [
        ...createHeaderElements(`🚨 Incident: ${incidentData.title}`, [
            {label: "View Incident", url: incidentData.html_url},
            {label: "Escalation Policy", url: incidentData.escalation_policy.html_url},
        ]),
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Incident #",
                },
                {
                    type: "Text",
                    text: incidentData.number.toString(),
                    marks: [
                        {
                            type: "Link",
                            url: incidentData.html_url,
                        },
                        {
                            type: "Code",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • Status: ",
                },
                {
                    type: "Text",
                    text: incidentData.status,
                    marks: [
                        {
                            type: "Code",
                        },
                        {
                            type: "Highlight",
                            color: "Red",
                        },
                    ],
                },
            ],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Service: ",
                },
                {
                    type: "Text",
                    text: incidentData.service?.summary || incidentData.service?.id || "Unknown",
                    marks: incidentData.service
                        ? [
                              {
                                  type: "Link",
                                  url: incidentData.service.html_url,
                              },
                          ]
                        : undefined,
                },
            ],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Priority: ",
                },
                {
                    type: "Text",
                    text: incidentData.priority?.summary || "Unknown",
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • Urgency: ",
                },
                {
                    type: "Text",
                    text: incidentData.urgency,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
            ],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Incident Type: ",
                },
                {
                    type: "Text",
                    text: incidentData.incident_type?.name || "Unknown",
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
            ],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Created: ",
                },
                {
                    type: "Text",
                    text: incidentData.created_at,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
            ],
        },
    ];

    if (incidentData.assignees.length > 0) {
        elements.push({
            type: "Paragraph" as const,
            elements: [
                {
                    type: "Text" as const,
                    text: "Assignees: ",
                },
                ...incidentData.assignees.flatMap((assignee, index) => [
                    ...(index > 0
                        ? [
                              {
                                  type: "Text" as const,
                                  text: ", ",
                              },
                          ]
                        : []),
                    createUserElement(
                        assignee.summary || assignee.id,
                        assignee.html_url,
                        assignee.id,
                    ),
                ]),
            ],
        });
    }

    return await sendAlertToAlpine(channel, channelId, {elements});
}

export async function sendHoneycombAlertToAlpine(
    data: HoneycombEventPayload,
): Promise<SendAlertResult> {
    const channel: SendAlertAvailableChannel =
        data.channel in sendAlertAvailableChannels
            ? (data.channel as SendAlertAvailableChannel)
            : "honeycomb";

    const channelId = sendAlertAvailableChannels[channel];

    console.log("Received Honeycomb event");
    console.debug(JSON.stringify(data, null, 2));

    const emoji =
        {
            triggered: "🚨",
            ok: "✅",
        }[data.alert.status] || "ℹ️";

    const elements: Array<ApiContentElement> = createHeaderElements(
        `${emoji} Alert: ${data.name}`,
        [
            {label: "View Trigger", url: data.links.trigger},
            {label: "View Result", url: data.links.result},
        ],
    );

    if (data.alert.status === "ok") {
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Measurement has returned to normal status.",
                    marks: [
                        {
                            type: "Bold",
                        },
                    ],
                },
            ],
        });
    }

    if (data.description) {
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: data.description,
                    marks: [
                        {
                            type: "Italic",
                        },
                    ],
                },
            ],
        });
    }

    elements.push({
        type: "Paragraph",
        elements: [
            {
                type: "Text",
                text: "Environment: ",
            },
            {
                type: "Text",
                text: data.environment,
                marks: [
                    {
                        type: "Code",
                    },
                ],
            },
        ],
    });

    if (data.alert.status !== "ok") {
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Threshold: ",
                },
                {
                    type: "Text",
                    text: `${data.threshold.op} ${data.threshold.value}`,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
            ],
        });
    }

    return await sendAlertToAlpine(channel, channelId, {elements});
}

export async function sendGitHubActionsAlertToAlpine(
    data: GitHubActionsEventPayload,
): Promise<SendAlertResult> {
    const channel: SendAlertAvailableChannel = "builds";
    const channelId = sendAlertAvailableChannels[channel];

    console.log("Received GitHub Actions event");
    console.log(JSON.stringify(data, null, 2));

    if (data.type !== "workflow_run") {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.debug(`Ignoring GitHub Actions event of type '${data.type}'`);
        return {ok: true};
    }

    if (data.workflow_run.head_branch !== "main") {
        console.debug(`Ignoring GitHub Actions event on branch '${data.workflow_run.head_branch}'`);
        return {ok: true};
    }

    if (data.action !== "completed") {
        console.debug(`Ignoring GitHub Actions workflow_run action '${data.action}'`);
        return {ok: true};
    }

    if (data.workflow_run.conclusion !== "failure") {
        console.debug(
            `Ignoring GitHub Actions workflow_run with conclusion '${data.workflow_run.conclusion}'`,
        );
        return {ok: true};
    }

    const elements: Array<ApiContentElement> = [
        ...createHeaderElements(`🚨 Build Failed: ${data.workflow_run.name}`, [
            {label: "View Run", url: data.workflow_run.html_url},
        ]),
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Repository: ",
                },
                {
                    type: "Text",
                    text: data.repository.full_name,
                    marks: [
                        {
                            type: "Link",
                            url: data.repository.html_url,
                        },
                    ],
                },
            ],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Author: ",
                },
                createUserElement(
                    data.workflow_run.actor.login,
                    data.workflow_run.actor.html_url,
                    data.workflow_run.actor.login,
                ),
                {
                    type: "Text",
                    text: " • Triggered by: ",
                },
                createUserElement(
                    data.workflow_run.triggering_actor.login,
                    data.workflow_run.triggering_actor.html_url,
                    data.workflow_run.triggering_actor.login,
                ),
            ],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Commit: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.head_sha.substring(0, 7),
                    marks: [
                        {
                            type: "Code",
                        },
                        {
                            type: "Link",
                            url: `${data.repository.html_url}/commit/${data.workflow_run.head_sha}`,
                        },
                    ],
                },
            ],
        },
    ];

    return await sendAlertToAlpine(channel, channelId, {elements});
}
