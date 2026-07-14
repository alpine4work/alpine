import {CursorCloudAgentsApiSpecification} from "~/server/agents/bots/deprecated/internal/cursor/cursor_cloud_agents_api_specification_types.js";
import {
    NotFoundError,
    PermissionDeniedError,
    ResourceExhaustedError,
    UnauthenticatedError,
    UnknownError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {
    ErrorDisplayMessage,
    ErrorDisplayMessageSegment,
} from "~/shared/error/types/error_display_message_type.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {getUrlRegExp} from "~/shared/helpers/string/url_reg_exp.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export class CursorClient {
    private readonly _cloudAgentApiKey: string;
    private readonly _edgeServiceUrl: string;
    private readonly _spaceId: SpaceId;
    private readonly _botId: BotId;

    constructor({
        cloudAgentApiKey,
        edgeServiceUrl,
        spaceId,
        botId,
    }: {
        cloudAgentApiKey: string;
        edgeServiceUrl: string;
        spaceId: SpaceId;
        botId: BotId;
    }) {
        this._cloudAgentApiKey = cloudAgentApiKey;
        this._edgeServiceUrl = edgeServiceUrl;
        this._spaceId = spaceId;
        this._botId = botId;
    }

    /**
     * Launch a Cursor Cloud Agent.
     *
     * https://cursor.com/docs/cloud-agent/api/endpoints#launch-an-agent
     */
    public async launchCloudAgent(
        tracer: TracerBase,
        input: CursorCloudAgentsApiSpecification.paths["/v0/agents"]["post"]["requestBody"]["content"]["application/json"],
    ) {
        const output: CursorCloudAgentsApiSpecification.paths["/v0/agents"]["post"]["responses"]["201"]["content"]["application/json"] =
            await this._fetch(tracer, "/v0/agents", {
                route: "/v0/agents",
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify(input),
            });

        return output;
    }

    /**
     * Add follow-up to a Cursor Cloud Agent.
     *
     * https://cursor.com/docs/cloud-agent/api/endpoints#launch-an-agent
     */
    public async addCloudAgentFollowUp(
        tracer: TracerBase,
        id: string,
        input: CursorCloudAgentsApiSpecification.paths["/v0/agents/{id}/followup"]["post"]["requestBody"]["content"]["application/json"],
    ) {
        const output: CursorCloudAgentsApiSpecification.paths["/v0/agents/{id}/followup"]["post"]["responses"]["200"]["content"]["application/json"] =
            await this._fetch(tracer, `/v0/agents/${encodeURIComponent(id)}/followup`, {
                route: "/v0/agents/:id/followup",
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify(input),
            });

        return output;
    }

    private async _fetch(
        tracer: TracerBase,
        path: string,
        {route, ...requestInit}: RequestInit & {route: string},
    ) {
        assert(path.startsWith("/"));

        // Cursor recommends retrying with exponential backoff on 429s.
        return await retryWithExponentialBackoff(retry => {
            const requestHeaders = new Headers(requestInit?.headers);
            requestHeaders.set("authorization", `basic ${btoa(`${this._cloudAgentApiKey}:`)}`);

            return fetchWithTracer(
                tracer,
                `https://api.cursor.com${path}`,
                {
                    ...requestInit,
                    serviceName: "Cursor",
                    route,
                    headers: requestHeaders,
                },
                async response => {
                    // Implements classification for common Cursor API errors.
                    // https://cursor.com/docs/api#common-error-responses
                    switch (response.status) {
                        case 429: {
                            throw retry(new ResourceExhaustedError("Cursor rate limit exceeded"));
                        }
                        case 401: {
                            throw new UnauthenticatedError("Cursor authentication failed", {
                                displayMessage: errorDisplayMessage`Cursor didn\u2019t accept your API key. Make sure you have a valid Cloud Agents API key in ${errorDisplayMessage.link("settings", `${this._edgeServiceUrl}/settings/${this._spaceId}/bots/${this._botId}`)}.`,
                            });
                        }
                        case 403: {
                            throw new PermissionDeniedError("Cursor paid access required", {
                                displayMessage: errorDisplayMessage`Cursor Cloud Agents aren\u2019t available on Cursor\u2019s free plan. Please ${errorDisplayMessage.link("upgrade your Cursor plan", "https://cursor.com/pricing")} to use the Cursor bot in Alpine.`,
                            });
                        }
                        case 404: {
                            throw new NotFoundError("Cursor resource not found");
                        }
                        default: {
                            if (!response.ok) {
                                const body: SchemaSerializedValue = await response.json();

                                let displayMessage: ErrorDisplayMessage | undefined;

                                // When Cursor requires usage based pricing to be turned on they return status code
                                // 400 with the message:
                                //
                                // > Usage-based pricing required. Background Agent requires at least $2 remaining
                                // > until your hard limit. Enable usage-based pricing and set a Spend Limit at
                                // > https://www.cursor.com/dashboard?tab=settings.
                                //
                                // Look for a string `error` property from Cursor and linkify it.
                                if (isObject(body) && typeof body.error === "string") {
                                    const urlRegExp = getUrlRegExp({global: true});

                                    const workingDisplayMessage: Array<ErrorDisplayMessageSegment> =
                                        [];

                                    let index = 0;

                                    for (const match of body.error.matchAll(urlRegExp)) {
                                        workingDisplayMessage.push({
                                            type: "SensitiveText",
                                            text: body.error.slice(index, match.index),
                                        });

                                        const length =
                                            match[0].length - (match[0].endsWith(".") ? 1 : 0);

                                        workingDisplayMessage.push({
                                            type: "Link",
                                            text: body.error.slice(
                                                match.index,
                                                match.index + length,
                                            ),
                                            url: body.error.slice(
                                                match.index,
                                                match.index + length,
                                            ),
                                        });

                                        index = match.index + length;
                                    }

                                    if (index < body.error.length) {
                                        workingDisplayMessage.push({
                                            type: "SensitiveText",
                                            text: body.error.slice(index),
                                        });
                                    }

                                    displayMessage =
                                        workingDisplayMessage as any as ErrorDisplayMessage;
                                }

                                throw new UnknownError(
                                    // In Cursor's documentation they have a `body.error.code` property (look at their
                                    // OpenAPI types) but we haven't seen an error with this in practice.
                                    `Cursor unknown error (HTTP status: ${response.status}${isObject(body) && isObject(body.error) && typeof body.error.code === "string" ? `, code: ${body.error.code}` : ""})`,
                                    {displayMessage},
                                );
                            }
                            break;
                        }
                    }

                    return await response.json();
                },
            );
        });
    }
}
