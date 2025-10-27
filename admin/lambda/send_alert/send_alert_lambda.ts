/* eslint-disable no-console */
import {Handler} from "aws-lambda";
import {createHmac, timingSafeEqual} from "crypto";
import {HoneycombEventPayload} from "~/admin/lambda/send_alert/send_alert_honeycomb.js";
import {PagerDutyEventPayload} from "~/admin/lambda/send_alert/send_alert_pagerduty.js";

// This file implements a Lambda function that processes incoming alert events
// from PagerDuty and Honeycomb. It parses the event data and makes posts within
// Alpine for alerting purposes.
//
// This is purposefullly very scrappy. We do not want to build out a full-fledged
// webhook/alerting system at this time. We just want to be able to receive alerts
// from these two services for now, with the intention of building out more robust
// alerting capabilities in the future. Once we build out that feature, this should
// be removed.

type SendAlertLambdaInputEvent = PagerDutyEventPayload | HoneycombEventPayload;

interface LambdaFunctionUrlEvent {
    body?: string;
    headers: Record<string, string>;
    httpMethod: string;
    isBase64Encoded: boolean;
    queryStringParameters?: Record<string, string>;
    requestContext: {
        http: {
            method: string;
            path: string;
            sourceIp: string;
        };
    };
}

interface LambdaFunctionUrlResult {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
}

function verifyPagerDutySignature(
    rawBody: string,
    signatureHeader: string,
    webhookSecret: string,
): boolean {
    const parts = signatureHeader.split(",");
    const timestampPart = parts.find(p => p.startsWith("t="));
    const signaturePart = parts.find(p => p.startsWith("v1="));

    if (!timestampPart || !signaturePart) {
        return false;
    }

    const timestamp = timestampPart.substring(2);
    const receivedSignature = signaturePart.substring(3);

    const stringToSign = `v1:${timestamp}:${rawBody}`;
    const hmac = createHmac("sha256", webhookSecret);
    hmac.update(stringToSign);
    const expectedSignature = hmac.digest("hex");

    return timingSafeEqual(
        new Uint8Array(Buffer.from(receivedSignature, "hex")),
        new Uint8Array(Buffer.from(expectedSignature, "hex")),
    );
}

function validateHeaders(
    headers: Record<string, string>,
    body: string,
): {valid: true} | {valid: false; statusCode: number; error: string} {
    // Check if this is a PagerDuty webhook and verify signature
    const pagerDutySignature = headers["x-pagerduty-signature"];
    const honeycombToken = headers["x-honeycomb-webhook-token"];

    if (pagerDutySignature) {
        const pagerDutySecret = process.env.PAGERDUTY_WEBHOOK_SECRET;
        if (!pagerDutySecret) {
            return {
                valid: false,
                statusCode: 500,
                error: "PAGERDUTY_WEBHOOK_SECRET environment variable is not set",
            };
        }

        if (!verifyPagerDutySignature(body, pagerDutySignature, pagerDutySecret)) {
            return {
                valid: false,
                statusCode: 401,
                error: "Invalid signature",
            };
        }
    } else if (honeycombToken) {
        // Check if this is a Honeycomb webhook and verify token
        const honeycombSecret = process.env.HONEYCOMB_WEBHOOK_SECRET;
        if (!honeycombSecret) {
            return {
                valid: false,
                statusCode: 500,
                error: "HONEYCOMB_WEBHOOK_SECRET environment variable is not set",
            };
        }

        if (honeycombToken !== honeycombSecret) {
            return {
                valid: false,
                statusCode: 401,
                error: "Invalid token",
            };
        }
    } else {
        return {valid: false, statusCode: 400, error: "Invalid headers"};
    }

    return {valid: true};
}

function sendPagerDutyToAlpine(data: PagerDutyEventPayload) {
    console.log("Received PagerDuty event:");
    console.log(JSON.stringify(data, null, 2));
    // TODO: Implement actual sending to Alpine
}

function sendHoneycombToAlpine(data: HoneycombEventPayload) {
    console.log("Received Honeycomb event:");
    console.log(JSON.stringify(data, null, 2));
    // TODO: Implement actual sending to Alpine
}

export const handler: Handler<LambdaFunctionUrlEvent, LambdaFunctionUrlResult> = async (
    event: LambdaFunctionUrlEvent,
): Promise<LambdaFunctionUrlResult> => {
    try {
        const edgeServiceUrl = process.env.EDGE_SERVICE_URL;
        if (!edgeServiceUrl) {
            console.error("EDGE_SERVICE_URL environment variable is not set");
            return {
                statusCode: 500,
                headers: {"content-type": "application/json"},
                body: JSON.stringify({
                    ok: false,
                    error: "EDGE_SERVICE_URL environment variable is not set",
                }),
            };
        }

        const body = event.body;

        if (!body) {
            console.error("Request body is required");

            return {
                statusCode: 400,
                headers: {"content-type": "application/json"},
                body: JSON.stringify({ok: false, error: "Request body is required"}),
            };
        }

        // Validate headers and signatures
        const validation = validateHeaders(event.headers, body);
        if (!validation.valid) {
            console.error(validation.error);
            return {
                statusCode: validation.statusCode,
                headers: {"content-type": "application/json"},
                body: JSON.stringify({ok: false, error: validation.error}),
            };
        }

        let alertEvent: SendAlertLambdaInputEvent;

        try {
            alertEvent = JSON.parse(body);
        } catch (error) {
            console.error("Invalid JSON in request body");
            console.error(error);

            return {
                statusCode: 400,
                headers: {"content-type": "application/json"},
                body: JSON.stringify({ok: false, error: "Invalid JSON in request body"}),
            };
        }

        // Actually process the event data
        if ("event" in alertEvent) {
            sendPagerDutyToAlpine(alertEvent);
        } else {
            sendHoneycombToAlpine(alertEvent);
        }

        return {
            statusCode: 200,
            headers: {"content-type": "application/json"},
            body: JSON.stringify({ok: true, message: "Alert processed successfully"}),
        };
    } catch (error) {
        console.error("Failed to send alert");
        console.error(error);

        return {
            statusCode: 500,
            headers: {"content-type": "application/json"},
            body: JSON.stringify({ok: false, error: "Internal server error"}),
        };
    }
};
