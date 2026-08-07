/* eslint-disable no-console */

import {APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Handler} from "aws-lambda";
import {parseFathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/parse_fathom_webhook_payload.js";
import {processFathomMeetingNotes} from "~/admin/lambda/fathom_meeting_notes/internal/process_fathom_meeting_notes.js";
import {verifyFathomWebhook} from "~/admin/lambda/fathom_meeting_notes/internal/verify_fathom_webhook.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export const handler: Handler<
    APIGatewayProxyEventV2,
    APIGatewayProxyStructuredResultV2
> = async event => {
    try {
        const responseHeaders = {"content-type": "application/json"};
        if (!event.body) {
            return {
                statusCode: 400,
                headers: responseHeaders,
                body: JSON.stringify({ok: false, error: "Request body is required"}),
            };
        }

        const webhookSecret = process.env.FATHOM_WEBHOOK_SECRET;
        if (!webhookSecret) {
            return {
                statusCode: 500,
                headers: responseHeaders,
                body: JSON.stringify({
                    ok: false,
                    error: "FATHOM_WEBHOOK_SECRET environment variable is not set",
                }),
            };
        }

        const headers = Object.fromEntries(
            Object.entries(event.headers).map(([name, value]) => [name.toLowerCase(), value]),
        );
        const webhookId = headers["webhook-id"];
        const webhookTimestamp = headers["webhook-timestamp"];
        const webhookSignature = headers["webhook-signature"];
        if (!webhookId || !webhookTimestamp || !webhookSignature) {
            return {
                statusCode: 400,
                headers: responseHeaders,
                body: JSON.stringify({
                    ok: false,
                    error: "Fathom webhook verification headers are required",
                }),
            };
        }

        const rawBody = event.isBase64Encoded
            ? Buffer.from(event.body, "base64").toString("utf8")
            : event.body;
        const verification = verifyFathomWebhook({
            secret: webhookSecret,
            webhookId,
            webhookTimestamp,
            webhookSignature,
            rawBody,
        });
        if (!verification.ok) {
            return {
                statusCode: verification.statusCode,
                headers: responseHeaders,
                body: JSON.stringify({ok: false, error: verification.error}),
            };
        }

        let parsedBody: unknown;
        try {
            parsedBody = JSON.parse(rawBody);
        } catch (error) {
            console.error("Invalid JSON in Fathom webhook", error);
            return {
                statusCode: 400,
                headers: responseHeaders,
                body: JSON.stringify({
                    ok: false,
                    error: "Invalid JSON in request body",
                }),
            };
        }

        const payloadResult = parseFathomWebhookPayload(parsedBody);
        if (!payloadResult.ok) {
            return {
                statusCode: 400,
                headers: responseHeaders,
                body: JSON.stringify({ok: false, error: payloadResult.error}),
            };
        }

        const result = await processFathomMeetingNotes(payloadResult.payload);
        if (!result.ok) {
            return {
                statusCode: result.statusCode,
                headers: responseHeaders,
                body: JSON.stringify({ok: false, error: result.error}),
            };
        }

        switch (result.outcome) {
            case "ignored":
                return {
                    statusCode: 200,
                    headers: responseHeaders,
                    body: JSON.stringify({ok: true, message: "Meeting notes skipped"}),
                };
            case "already_processed":
                return {
                    statusCode: 200,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        ok: true,
                        message: "Meeting notes already processed",
                        documentId: result.documentId,
                    }),
                };
            case "created":
                return {
                    statusCode: 200,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        ok: true,
                        message: "Meeting notes created",
                        documentId: result.documentId,
                    }),
                };
            default:
                throw exhaustive(result);
        }
    } catch (error) {
        console.error("Failed to process Fathom meeting notes", error);
        return {
            statusCode: 500,
            headers: {"content-type": "application/json"},
            body: JSON.stringify({ok: false, error: "Internal server error"}),
        };
    }
};
