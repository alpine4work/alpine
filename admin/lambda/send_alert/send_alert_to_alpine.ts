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

async function sendAlertToAlpine(
    channel: string,
    channelId: string,
    postContent: ApiContent,
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

    console.log(`Sending to ${channel} (${channelId}):`);
    const body = {content: postContent};
    console.log(JSON.stringify(body, null, 2));
    // TODO: Implement actual sending to Alpine

    return {ok: true};
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
        {
            type: "Heading",
            level: 2,
            elements: [
                {
                    type: "Text",
                    text: "🚨 PagerDuty Incident: ",
                    marks: [
                        {
                            type: "Bold",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: incidentData.title,
                    marks: [
                        {
                            type: "Bold",
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
                    text: incidentData.service.summary || incidentData.service.id,
                    marks: [
                        {
                            type: "Link",
                            url: incidentData.service.html_url,
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
                    text: "Priority: ",
                },
                {
                    type: "Text",
                    text: incidentData.priority.summary || "Unknown",
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
                    text: incidentData.incident_type.name,
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

    elements.push({
        type: "Divider",
    });

    elements.push({
        type: "Paragraph",
        elements: [
            {
                type: "Text",
                text: "🔗 Actions: ",
            },
            {
                type: "Text",
                text: "View Incident",
                marks: [
                    {
                        type: "Link",
                        url: incidentData.html_url,
                    },
                ],
            },
            {
                type: "Text",
                text: " • ",
            },
            {
                type: "Text",
                text: "Escalation Policy",
                marks: [
                    {
                        type: "Link",
                        url: incidentData.escalation_policy.html_url,
                    },
                ],
            },
        ],
    });

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

    const elements: Array<ApiContentElement> = [
        {
            type: "Heading",
            level: 2,
            elements: [
                {
                    type: "Text",
                    text: data.name,
                    marks: [
                        {
                            type: "Bold",
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
                    text: "Alert ID: ",
                },
                {
                    type: "Text",
                    text: data.id,
                    marks: [
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
                    text: data.alert.status,
                    marks: [
                        {
                            type: "Code",
                        },
                        {
                            type: "Highlight",
                            color: "Orange",
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
        },
        {
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
        },
    ];

    if (data.description) {
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Description: ",
                },
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

    if (data.alert.summary) {
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Summary: ",
                },
                {
                    type: "Text",
                    text: data.alert.summary,
                    marks: [
                        {
                            type: "Italic",
                        },
                    ],
                },
            ],
        });
    }

    if (data.alert.description && data.alert.description !== data.description) {
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Alert Description: ",
                },
                {
                    type: "Text",
                    text: data.alert.description,
                    marks: [
                        {
                            type: "Italic",
                        },
                    ],
                },
            ],
        });
    }

    elements.push(
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Instance ID: ",
                },
                {
                    type: "Text",
                    text: data.alert.instanceId,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
            ],
        },
        {
            type: "Divider",
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "🔗 Actions: ",
                },
                {
                    type: "Text",
                    text: "View Trigger",
                    marks: [
                        {
                            type: "Link",
                            url: data.links.trigger,
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • ",
                },
                {
                    type: "Text",
                    text: "View Result",
                    marks: [
                        {
                            type: "Link",
                            url: data.links.result,
                        },
                    ],
                },
            ],
        },
    );

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
        {
            type: "Heading",
            level: 2,
            elements: [
                {
                    type: "Text",
                    text: "🚨 Build Failed: ",
                    marks: [
                        {
                            type: "Bold",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: data.workflow_run.name,
                    marks: [
                        {
                            type: "Bold",
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
                    text: "Workflow: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.name,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: ` • Run #${data.workflow_run.run_number}`,
                },
            ],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Branch: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.head_branch,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • Commit: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.head_sha.substring(0, 7),
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
                    text: "Commit Message: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.head_commit.message,
                    marks: [
                        {
                            type: "Link",
                            url: `${data.repository.html_url}/commit/${data.workflow_run.head_sha}`,
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
                    text: "Status: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.status,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • Conclusion: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.conclusion,
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
                    text: "Event: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.event,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: ` • Attempt: #${data.workflow_run.run_attempt}`,
                },
            ],
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "Started: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.run_started_at,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • Updated: ",
                },
                {
                    type: "Text",
                    text: data.workflow_run.updated_at,
                    marks: [
                        {
                            type: "Code",
                        },
                    ],
                },
            ],
        },
        {
            type: "Divider",
        },
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "🔗 Actions: ",
                },
                {
                    type: "Text",
                    text: "View Run",
                    marks: [
                        {
                            type: "Link",
                            url: data.workflow_run.html_url,
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • ",
                },
                {
                    type: "Text",
                    text: "View Jobs",
                    marks: [
                        {
                            type: "Link",
                            url: data.workflow_run.jobs_url,
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • ",
                },
                {
                    type: "Text",
                    text: "View Logs",
                    marks: [
                        {
                            type: "Link",
                            url: data.workflow_run.logs_url,
                        },
                    ],
                },
                {
                    type: "Text",
                    text: " • ",
                },
                {
                    type: "Text",
                    text: "Rerun",
                    marks: [
                        {
                            type: "Link",
                            url: data.workflow_run.rerun_url,
                        },
                    ],
                },
            ],
        },
    ];

    return await sendAlertToAlpine(channel, channelId, {elements});
}
