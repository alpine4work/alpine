import {CursorCloudAgentsApiSpecification} from "~/server/agents/internal/cursor/cursor_cloud_agents_api_specification_types.js";
import {
    InternalError,
    NotFoundError,
    PermissionDeniedError,
    ResourceExhaustedError,
    UnauthenticatedError,
    UnknownError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.js";
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
        return retryWithExponentialBackoff(retry => {
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
                response => {
                    // Implements classification for common Cursor API errors.
                    // https://cursor.com/docs/api#common-error-responses
                    switch (response.status) {
                        case 429: {
                            throw retry(new ResourceExhaustedError("Cursor rate limit exceeded"));
                        }
                        case 401: {
                            throw new UnauthenticatedError("Cursor authentication failed", {
                                displayMessage: errorDisplayMessage`Cursor didn’t accept your API key. Make sure you have a valid Cloud Agents API key in ${errorDisplayMessage.link("settings", `${this._edgeServiceUrl}/s/${this._spaceId}/settings/bots/${this._botId}`)}.`,
                            });
                        }
                        case 403: {
                            throw new PermissionDeniedError("Cursor paid access required", {
                                displayMessage: errorDisplayMessage`Cursor Cloud Agents aren’t available on Cursor’s free plan. Please ${errorDisplayMessage.link("upgrade your Cursor plan", "https://cursor.com/pricing")} to use the Cursor bot in Alpine.`,
                            });
                        }
                        case 404: {
                            throw new NotFoundError("Cursor resource not found");
                        }
                        case 500: {
                            throw new InternalError("Cursor unexpected error");
                        }
                        default: {
                            if (!response.ok)
                                throw new UnknownError(`Cursor API error: ${response.status}`);
                            break;
                        }
                    }

                    return response.json();
                },
            );
        });
    }
}
