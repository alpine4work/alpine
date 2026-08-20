/* eslint-disable cyberworlds/string-quotes */
/* eslint-disable no-console */

import {createHmac, timingSafeEqual} from "crypto";
import {AlertSource} from "~/admin/lambda/send_alert/internal/alert_source.js";
import {
    AlertSourceAuthorizationResult,
    SendAlertResult,
} from "~/admin/lambda/send_alert/internal/alert_source_types.js";
import {createHeaderElements} from "~/admin/lambda/send_alert/internal/create_header_elements.js";
import {createUserElement} from "~/admin/lambda/send_alert/internal/create_user_element.js";
import {PagerDutyEventPayload} from "~/admin/lambda/send_alert/internal/pagerduty_alert_source_types.js";
import {ApiContentRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

type ApiContentElement = ApiContentRequest["elements"][number];

export class PagerDutyAlertSource extends AlertSource {
    override validateAuthorization(): AlertSourceAuthorizationResult {
        const pagerDutyWebhookSecret = process.env.PAGERDUTY_WEBHOOK_SECRET;
        if (!pagerDutyWebhookSecret) {
            return {
                ok: false,
                statusCode: 500,
                error: "PAGERDUTY_WEBHOOK_SECRET environment variable is not set",
            };
        }

        const pagerDutySignature = this.request.headers["x-pagerduty-signature"];
        const body = this.request.body;
        if (
            !body ||
            !pagerDutySignature ||
            !this.verifySignature(body, pagerDutySignature, pagerDutyWebhookSecret)
        ) {
            return {
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            };
        }

        return {ok: true};
    }

    override async handlePayload(payload: unknown): Promise<SendAlertResult> {
        const data = payload as PagerDutyEventPayload;
        const channel = "alerts";

        console.log("Received PagerDuty event");
        console.log(JSON.stringify(data, null, 2));

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
                        text:
                            incidentData.service?.summary || incidentData.service?.id || "Unknown",
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

        return await this.postAlertToAlpine(channel, {elements});
    }

    private verifySignature(
        rawBody: string,
        signatureHeader: string,
        webhookSecret: string,
    ): boolean {
        const signatures = signatureHeader
            .split(",")
            .map(sig => sig.trim())
            .filter(sig => sig.startsWith("v1="))
            .map(sig => sig.substring(3));

        if (signatures.length === 0) {
            return false;
        }

        const hmac = createHmac("sha256", webhookSecret);
        hmac.update(rawBody);
        const expectedSignatureBytes = new Uint8Array(Buffer.from(hmac.digest("hex"), "hex"));

        return signatures.some(receivedSignature => {
            const receivedSignatureBytes = new Uint8Array(Buffer.from(receivedSignature, "hex"));

            if (expectedSignatureBytes.length !== receivedSignatureBytes.length) {
                return false;
            }

            return timingSafeEqual(expectedSignatureBytes, receivedSignatureBytes);
        });
    }
}
