/* eslint-disable no-console */

import {AlertSourceRequest} from "~/admin/lambda/send_alert/internal/alert_source_request_types.js";
import {
    AlertSourceAuthorizationResult,
    SendAlertResult,
} from "~/admin/lambda/send_alert/internal/alert_source_types.js";
import {
    SendAlertAvailableChannel,
    sendAlertAvailableChannels,
} from "~/admin/lambda/send_alert/internal/send_alert_available_channels.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";

type FetchAlpineApiResult<T> =
    | {ok: true; value: T}
    | {ok: false; error: string; statusCode: number};

/**
 * Base class for an external service that can send alert webhook payloads into
 * Alpine.
 *
 * Subclasses own both request authorization and source-specific payload handling.
 * Shared posting to Alpine lives here so each source can build content and submit
 * it through the same path.
 */
export abstract class AlertSource {
    protected readonly request: AlertSourceRequest;

    /**
     * Creates an alert source with the original Lambda function URL request.
     */
    constructor(request: AlertSourceRequest) {
        this.request = request;
    }

    /**
     * Validates that the source-specific authorization headers are present and valid
     * for the raw request body.
     */
    abstract validateAuthorization(): AlertSourceAuthorizationResult;

    /**
     * Converts a parsed webhook payload into Alpine content and posts it, or returns
     * successfully when the source event should be ignored.
     */
    abstract handlePayload(payload: unknown): Promise<SendAlertResult>;

    /**
     * Sends rendered alert content to the configured Alpine channel.
     */
    protected async postAlertToAlpine(
        channel: SendAlertAvailableChannel,
        content: ApiContent,
    ): Promise<SendAlertResult> {
        const channelId = sendAlertAvailableChannels[channel];
        const body = {
            channelId,
            content,
        };

        console.log(`Sending to ${channel}`);
        console.log(JSON.stringify(body, null, 2));

        const result = await this.fetchAlpineApi<unknown>("/posts", {
            method: "POST",
            body,
        });

        if (!result.ok) {
            return result;
        }

        return {ok: true};
    }

    /**
     * Sends a JSON request to the Alpine API using the same edge URL convention as
     * production alert posts.
     */
    protected async fetchAlpineApi<T>(
        path: string,
        options: {
            method: "GET" | "POST" | "PATCH";
            body?: unknown;
        },
    ): Promise<FetchAlpineApiResult<T>> {
        const alpineAPIKey = process.env.ALPINE_API_KEY;

        if (!alpineAPIKey) {
            console.error("ALPINE_API_KEY is not set in environment variables");
            return {
                ok: false,
                error: "ALPINE_API_KEY is not set in environment variables",
                statusCode: 500,
            };
        }

        const edgeServiceUrl = process.env.EDGE_SERVICE_URL;
        if (!edgeServiceUrl) {
            console.error("EDGE_SERVICE_URL is not set in environment variables");
            return {
                ok: false,
                error: "EDGE_SERVICE_URL is not set in environment variables",
                statusCode: 500,
            };
        }

        const apiUrl = edgeServiceUrl.replace("://", "://api.") + path;
        console.log(`${options.method} ${apiUrl}`);

        try {
            // eslint-disable-next-line cyberworlds/no-global-fetch
            const response = await fetch(apiUrl, {
                method: options.method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${alpineAPIKey}`,
                },
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(
                    `Alpine API request failed: ${response.status} ${response.statusText}`,
                );
                console.error(`Response: ${errorText}`);
                return {
                    ok: false,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                    statusCode: response.status,
                };
            }

            const responseText = await response.text();
            const value = responseText ? (JSON.parse(responseText) as T) : (undefined as T);
            return {ok: true, value};
        } catch (error) {
            console.error("Error sending alert:", error);
            return {
                ok: false,
                error: error instanceof Error ? error.message : "Unknown error",
                statusCode: 500,
            };
        }
    }
}
