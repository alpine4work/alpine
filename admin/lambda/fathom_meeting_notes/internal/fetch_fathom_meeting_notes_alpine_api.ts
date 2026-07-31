/* eslint-disable no-console */

export type FetchFathomMeetingNotesAlpineApiResult<T> =
    | {readonly ok: true; readonly value: T}
    | {
          readonly ok: false;
          readonly error: string;
          readonly statusCode: number;
          readonly responseText?: string;
      };

type FetchFathomMeetingNotesAlpineApiOptions = {
    readonly method: "GET" | "POST" | "PATCH";
    readonly body?: unknown;
};

/**
 * Sends a request directly to the Alpine REST API.
 */
export async function fetchFathomMeetingNotesAlpineApi<T>(
    path: string,
    options: FetchFathomMeetingNotesAlpineApiOptions,
): Promise<FetchFathomMeetingNotesAlpineApiResult<T>> {
    const alpineAPIKey = process.env.ALPINE_API_KEY;
    if (!alpineAPIKey) {
        return {
            ok: false,
            error: "ALPINE_API_KEY environment variable is not set",
            statusCode: 500,
        };
    }

    const edgeServiceUrl = process.env.EDGE_SERVICE_URL;
    if (!edgeServiceUrl) {
        return {
            ok: false,
            error: "EDGE_SERVICE_URL environment variable is not set",
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
                "Alpine-Version": "2026-07-29",
                "Content-Type": "application/json",
                Authorization: `Bearer ${alpineAPIKey}`,
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        const responseText = await response.text();

        if (!response.ok) {
            console.error(`Alpine API request failed: ${response.status} ${response.statusText}`);
            console.error(`Response: ${responseText}`);
            return {
                ok: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                statusCode: response.status,
                responseText,
            };
        }

        return {
            ok: true,
            value: responseText ? (JSON.parse(responseText) as T) : (undefined as T),
        };
    } catch (error) {
        console.error("Alpine API request failed", error);
        return {
            ok: false,
            error: error instanceof Error ? error.message : "Unknown Alpine API error",
            statusCode: 500,
        };
    }
}
