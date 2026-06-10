/* eslint-disable no-console */
import {Handler} from "aws-lambda";
import {AlertSourceFactory} from "~/admin/lambda/send_alert/internal/alert_source_factory.js";
import {AlertSourceRequest} from "~/admin/lambda/send_alert/internal/alert_source_request_types.js";
import {SendAlertResult} from "~/admin/lambda/send_alert/internal/alert_source_types.js";

// This file implements a Lambda function that processes incoming alert events from
// PagerDuty, Honeycomb, and GitHub. It parses the event data and makes posts
// within Alpine for alerting purposes.
//
// This is purposefully very scrappy. We do not want to build out a full-fledged
// webhook/alerting system at this time. We just want to be able to receive alerts
// from these services for now, with the intention of building out more robust
// alerting capabilities in the future. Once we build out that feature, this should
// be removed.

interface LambdaFunctionUrlResult {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
}

export const handler: Handler<AlertSourceRequest, LambdaFunctionUrlResult> = async (
    event: AlertSourceRequest,
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

        const alertSource = AlertSourceFactory.create(event);
        const authorization = alertSource.validateAuthorization();
        if (!authorization.ok) {
            console.error(authorization.error);
            return {
                statusCode: authorization.statusCode,
                headers: {"content-type": "application/json"},
                body: JSON.stringify({ok: false, error: authorization.error}),
            };
        }

        let alertEvent;
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

        const result: SendAlertResult = await alertSource.handlePayload(alertEvent);

        if (!result.ok) {
            console.error("Failed to process alert");
            console.error(result.error);
            return {
                statusCode: result.statusCode || 400,
                headers: {"content-type": "application/json"},
                body: JSON.stringify({ok: false, error: result.error}),
            };
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
