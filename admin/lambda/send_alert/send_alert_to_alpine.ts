/* eslint-disable cyberworlds/string-quotes */
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
    nameToAlpineId,
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
        pagerDutyIdToAlpineId[id.toLowerCase()] ||
        gitHubUsernameToAlpineId[id.toLowerCase()] ||
        nameToAlpineId[displayName.toLowerCase()];

    if (alpineId) {
        const mention: ApiContentMentionInlineElement = {
            type: "Mention",
            target: {type: "Account", id: alpineId},
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

// Create elements for commit message with PR links
function createCommitMessageElements(
    commitMessage: string,
    repositoryFullName: string,
): Array<ApiSpecification.components["schemas"]["ContentInlineElement"]> {
    const elements: Array<ApiSpecification.components["schemas"]["ContentInlineElement"]> = [];

    // Regex to match PR references like (#123)
    const prRegex = /\(#(\d+)\)/g;
    let lastIndex = 0;
    let match;

    while ((match = prRegex.exec(commitMessage)) !== null) {
        // Add text before the PR reference
        if (match.index > lastIndex) {
            elements.push({
                type: "Text",
                text: commitMessage.substring(lastIndex, match.index),
            });
        }

        // Add the PR link
        const prNumber = match[1];
        elements.push({
            type: "Text",
            text: `(#${prNumber})`,
            marks: [
                {
                    type: "Link",
                    url: `https://app.graphite.com/github/pr/${repositoryFullName}/${prNumber}`,
                },
            ],
        });

        lastIndex = match.index + match[0].length;
    }

    // Add any remaining text after the last PR reference
    if (lastIndex < commitMessage.length) {
        elements.push({
            type: "Text",
            text: commitMessage.substring(lastIndex),
        });
    }

    // If no PR references were found, just return the original text
    if (elements.length === 0) {
        elements.push({
            type: "Text",
            text: commitMessage,
        });
    }

    return elements;
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
        // eslint-disable-next-line cyberworlds/no-global-fetch
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

    const status = incidentData.status.toLowerCase();

    const emoji =
        {
            triggered: "🚨",
            acknowledged: "⚠️",
            resolved: "✅",
        }[status] || "ℹ️";

    const elements: Array<ApiContentElement> = [
        ...createHeaderElements(`${emoji} Incident: ${incidentData.title}`, [
            {label: "View Incident", url: incidentData.html_url},
            {label: "Escalation Policy", url: incidentData.escalation_policy.html_url},
        ]),
        {
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: `Incident #${incidentData.number}`,
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
    ];

    if (status === "resolved") {
        elements.push({type: "Divider"});
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "The incident has been resolved.",
                    marks: [
                        {
                            type: "Bold",
                        },
                    ],
                },
            ],
        });

        if (incidentData.resolve_reason) {
            elements.push({
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: incidentData.resolve_reason,
                    },
                ],
            });
        }

        elements.push({type: "Divider"});
    }

    elements.push(
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
    );

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

    const status = data.alert.status.toLowerCase();
    const statusEmojiMap = {
        triggered: "🚨",
        ok: "✅",
    };

    // Event alerts are useful for just knowing when events happen.
    // We don't care when they go back to 'normal'.
    const isEvent = data.isEvent?.toLowerCase() === "true" || data.isEvent === "1";

    // When 'event' type alert goes back to 'ok', ignore it. We only care when they trigger.
    if (status === "ok" && isEvent) {
        console.debug("Ignoring Honeycomb event alert with status 'ok'");
        return {ok: true};
    }

    let emoji = "ℹ️";
    if (isEvent) {
        if (data.emoji?.trim().length) {
            emoji = data.emoji.trim();
        }
    } else if (status in statusEmojiMap) {
        emoji = statusEmojiMap[status as keyof typeof statusEmojiMap];
    }

    const header = `${emoji} ${isEvent ? "Event" : "Trigger"}: ${data.name}`;
    const elements: Array<ApiContentElement> = createHeaderElements(header, [
        {label: "View Result", url: data.links.result},
    ]);

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

    if (status === "ok") {
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

    if (data.environment !== "production") {
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
                },
            ],
        });
    }

    // Display query results in a table for triggered alerts
    if (status !== "ok") {
        const groupsTriggered = data.groupsTriggered;

        // Render a table using group keys as column headers
        if (groupsTriggered && groupsTriggered.length > 0) {
            // Extract all column keys from the first row (all rows have same keys)
            const allColumnKeys = groupsTriggered[0]!.group.map(col => col.key);
            const hasUserColumn = allColumnKeys.includes("context.known_account.name");

            // Collect unique user names for mentions
            const userNames = new Set<string>();
            if (hasUserColumn) {
                for (const row of groupsTriggered) {
                    const userCol = row.group.find(col => col.key === "context.known_account.name");
                    if (userCol?.value && nameToAlpineId[userCol.value.toLowerCase()]) {
                        userNames.add(userCol.value);
                    }
                }
            }

            // Filter out the user column from table display
            const tableColumnKeys = allColumnKeys.filter(k => k !== "context.known_account.name");

            // If user column is the only column, just show user mentions without a table
            if (tableColumnKeys.length === 0) {
                if (userNames.size > 0) {
                    const userElements: Array<
                        ApiSpecification.components["schemas"]["ContentInlineElement"]
                    > = [];
                    Array.from(userNames).forEach((userName, index) => {
                        if (index > 0) {
                            userElements.push({type: "Text", text: " "});
                        }
                        userElements.push(createUserElement(userName, "", userName));
                    });
                    elements.push({
                        type: "Paragraph",
                        elements: userElements,
                    });
                }
            } else {
                // Aggregate rows by non-user columns, summing up counts
                const aggregatedRows = new Map<string, number>();
                for (const row of groupsTriggered) {
                    const keyValues = row.group
                        .filter(col => col.key !== "context.known_account.name")
                        .map(col => col.value)
                        .join("\0"); // Use null char as separator
                    aggregatedRows.set(
                        keyValues,
                        (aggregatedRows.get(keyValues) || 0) + row.result,
                    );
                }

                const maxResults = 5;
                const allRows = Array.from(aggregatedRows.entries());
                const displayRows = allRows.slice(0, maxResults);
                const remainingCount = allRows.length - maxResults;

                const columnCount = tableColumnKeys.length + 1; // +1 for Count column

                // Build header row using the keys (excluding user column)
                const headerRow = {
                    cells: [
                        ...tableColumnKeys.map(key => ({
                            elements: [
                                {
                                    type: "Paragraph" as const,
                                    elements: [{type: "Text" as const, text: key}],
                                },
                            ],
                        })),
                        {
                            elements: [
                                {
                                    type: "Paragraph" as const,
                                    elements: [{type: "Text" as const, text: "Count"}],
                                },
                            ],
                        },
                    ],
                };

                // Build data rows from aggregated data
                const dataRows = displayRows.map(([keyValues, count]) => {
                    const values = keyValues.split("\0");
                    return {
                        cells: [
                            ...values.map((value, index) => ({
                                elements: [
                                    {
                                        type: "Paragraph" as const,
                                        elements: [
                                            {
                                                type: "Text" as const,
                                                text: value || "",
                                                ...(tableColumnKeys[index]?.startsWith(
                                                    "exception.",
                                                ) && {
                                                    marks: [{type: "Code" as const}],
                                                }),
                                            },
                                        ],
                                    },
                                ],
                            })),
                            {
                                elements: [
                                    {
                                        type: "Paragraph" as const,
                                        elements: [{type: "Text" as const, text: String(count)}],
                                    },
                                ],
                            },
                        ],
                    };
                });

                elements.push({
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    columns: [...Array(columnCount - 1).fill({width: 1}), {width: 0.000001}],
                    rows: [headerRow, ...dataRows],
                });

                if (remainingCount > 0) {
                    elements.push({
                        type: "Paragraph",
                        elements: [
                            {
                                type: "Text",
                                text: `(${remainingCount} more result${remainingCount === 1 ? "" : "s"}...)`,
                                marks: [{type: "Italic"}],
                            },
                        ],
                    });
                }

                // Add user mentions at the bottom if we have any
                if (userNames.size > 0) {
                    const userElements: Array<
                        ApiSpecification.components["schemas"]["ContentInlineElement"]
                    > = [];
                    Array.from(userNames).forEach((userName, index) => {
                        if (index > 0) {
                            userElements.push({type: "Text", text: " "});
                        }
                        userElements.push(createUserElement(userName, "", userName));
                    });
                    elements.push({
                        type: "Paragraph",
                        elements: userElements,
                    });
                }
            }
        }
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
        ...createHeaderElements(`🚨 Build failed: ${data.workflow_run.name}`, [
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
                    text: data.repository.name,
                    marks: [
                        {
                            type: "Link",
                            url: data.repository.html_url,
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
                        {
                            type: "Link",
                            url: `${data.repository.html_url}/commit/${data.workflow_run.head_sha}`,
                        },
                    ],
                },
            ],
        },
        {
            type: "Quote",
            elements: [
                {
                    type: "Paragraph",
                    elements: createCommitMessageElements(
                        data.workflow_run.head_commit.message,
                        data.repository.full_name,
                    ),
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
                    data.workflow_run.head_commit.author.name,
                    `https://github.com/${data.workflow_run.head_commit.author.name}`,
                    data.workflow_run.head_commit.author.name,
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
    ];

    return await sendAlertToAlpine(channel, channelId, {elements});
}
