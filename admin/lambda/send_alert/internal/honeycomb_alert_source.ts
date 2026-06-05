/* eslint-disable cyberworlds/string-quotes */
/* eslint-disable no-console */

import {AlertSource} from "~/admin/lambda/send_alert/internal/alert_source.js";
import {
    AlertSourceAuthorizationResult,
    SendAlertResult,
} from "~/admin/lambda/send_alert/internal/alert_source_types.js";
import {createHeaderElements} from "~/admin/lambda/send_alert/internal/create_header_elements.js";
import {createUserElement} from "~/admin/lambda/send_alert/internal/create_user_element.js";
import {HoneycombEventPayload} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source_types.js";
import {
    SendAlertAvailableChannel,
    sendAlertAvailableChannels,
} from "~/admin/lambda/send_alert/internal/send_alert_available_channels.js";
import {nameToAlpineId} from "~/admin/lambda/send_alert/internal/send_alert_user_mappings.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";

type ApiContentElement = ApiContent["elements"][number];

export class HoneycombAlertSource extends AlertSource {
    override validateAuthorization(): AlertSourceAuthorizationResult {
        const honeycombWebhookSecret = process.env.HONEYCOMB_WEBHOOK_SECRET;
        if (!honeycombWebhookSecret) {
            return {
                ok: false,
                statusCode: 500,
                error: "HONEYCOMB_WEBHOOK_SECRET environment variable is not set",
            };
        }

        if (this.request.headers["x-honeycomb-webhook-token"] !== honeycombWebhookSecret) {
            return {
                ok: false,
                statusCode: 401,
                error: "Invalid token",
            };
        }

        return {ok: true};
    }

    override async handlePayload(payload: unknown): Promise<SendAlertResult> {
        const data = payload as HoneycombEventPayload;
        const channel: SendAlertAvailableChannel =
            data.channel in sendAlertAvailableChannels
                ? (data.channel as SendAlertAvailableChannel)
                : "honeycomb";

        console.log("Received Honeycomb event");
        console.debug(JSON.stringify(data, null, 2));

        const status = data.alert.status.toLowerCase();
        const statusEmojiMap = {
            triggered: "🚨",
            ok: "✅",
        };

        const isEvent = data.isEvent?.toLowerCase() === "true" || data.isEvent === "1";

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

        if (status !== "ok") {
            const groupsTriggered = data.groupsTriggered;

            if (groupsTriggered && groupsTriggered.length > 0) {
                const allColumnKeys = groupsTriggered[0]!.group.map(col => col.key);
                const hasUserColumn = allColumnKeys.includes("context.known_account.name");

                const userNames = new Set<string>();
                if (hasUserColumn) {
                    for (const row of groupsTriggered) {
                        const userCol = row.group.find(
                            col => col.key === "context.known_account.name",
                        );
                        if (userCol?.value && nameToAlpineId[userCol.value.toLowerCase()]) {
                            userNames.add(userCol.value);
                        }
                    }
                }

                const tableColumnKeys = allColumnKeys.filter(
                    k => k !== "context.known_account.name",
                );

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
                    const aggregatedRows = new Map<string, number>();
                    for (const row of groupsTriggered) {
                        const keyValues = row.group
                            .filter(col => col.key !== "context.known_account.name")
                            .map(col => col.value)
                            .join("\0");
                        aggregatedRows.set(
                            keyValues,
                            (aggregatedRows.get(keyValues) || 0) + row.result,
                        );
                    }

                    const maxResults = 5;
                    const allRows = Array.from(aggregatedRows.entries());
                    const displayRows = allRows.slice(0, maxResults);
                    const remainingCount = allRows.length - maxResults;
                    const columnCount = tableColumnKeys.length + 1;

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
                                            elements: [
                                                {type: "Text" as const, text: String(count)},
                                            ],
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

        return await this.postAlertToAlpine(channel, {elements});
    }
}
