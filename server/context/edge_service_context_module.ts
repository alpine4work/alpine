import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenPayload} from "~/server/tokens/token_payload.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

/**
 * Allow communication with our edge service family. Importantly, this allows us to
 * send requests to our durable objects which live on the edge in Cloudflare. For
 * instance, we may need to broadcast realtime events to durable objects.
 */
export interface EdgeServiceContextModuleBase extends ContextModuleBase, ForkableContextModuleBase {
    broadcastToDurableObject(
        url: `/api/durable-objects/${string}`,
        options: {
            serviceName: TokenServiceName;
            route: `/api/durable-objects/${string}`;
            body?: SchemaSerializedValue | null;
        },
    ): Promise<void>;
    sendRequestToDurableObject(
        url: `/api/durable-objects/${string}`,
        options: {
            serviceName: TokenServiceName;
            route: `/api/durable-objects/${string}`;
            body?: SchemaSerializedValue | null;
        },
    ): Promise<SchemaSerializedValue>;
}

export class EdgeServiceContextModule
    extends ContextModuleBase<{tracer: TracerContextModule}>
    implements EdgeServiceContextModuleBase
{
    private readonly _edgeServiceUrl: string;
    private readonly _tokenAgent: TokenAgent;

    constructor({edgeServiceUrl, tokenAgent}: {edgeServiceUrl: string; tokenAgent: TokenAgent}) {
        super();
        this._edgeServiceUrl = edgeServiceUrl;
        this._tokenAgent = tokenAgent;
    }

    /**
     * Send a broadcast HTTP request to a durable object. For a broadcast, we don't
     * care about the response returned by the durable object and if there's no live
     * durable object then the broadcast won't wake it up.
     *
     * We'll include a token signed by our service's private key.
     */
    public async broadcastToDurableObject(
        this: EdgeServiceContextModule &
            ContextModuleBase<{actor: ContextModuleBase & {getTokenPayload(): TokenPayload}}>,
        url: `/api/durable-objects/${string}`,
        {
            serviceName,
            route,
            body,
        }: {
            serviceName: TokenServiceName;
            route: `/api/durable-objects/${string}`;
            body?: SchemaSerializedValue | null;
        },
    ): Promise<void> {
        // Double-check that we're sending a request to our durable object.
        assert(url.startsWith("/api/durable-objects/"));

        // Include a token showing this request is from `AppService`.
        const token = await this._tokenAgent.privateSide.dangerouslySignShortLivedToken(
            serviceName,
            this._context.actor.getTokenPayload(),
        );

        const headers: {[key: string]: string} = {
            authorization: `bearer ${token}`,
            // If the durable object is not initialized, this request will fail with a 412. If
            // there are no realtime subscribers on the durable object, we don't need to send
            // our event transaction. We can drop this request on the floor.
            "cyberworlds-durable-object-if-initialized": "true",
        };

        if (body != null) {
            headers["content-type"] = "application/json";
        }

        await fetchWithTracer(
            this._context.tracer.getTracer(),
            new URL(url, this._edgeServiceUrl),
            {
                serviceName,
                route,
                method: "POST",
                headers,
                body: body != null ? JSON.stringify(body) : body,
            },
            async response => {
                if (response.status !== 200 && response.status !== 412) {
                    throw new InternalError(
                        quote`Fetch to ${route} failed with status code ${response.status}`,
                    );
                }
            },
        );
    }

    /**
     * Send an HTTP request to a durable object. Unlike `broadcastToDurableObject()`,
     * if the durable object is not currently running, we will wake it up for the
     * request and also return the response.
     *
     * We'll include a token signed by our service's private key.
     */
    public async sendRequestToDurableObject(
        this: EdgeServiceContextModule &
            ContextModuleBase<{actor: ContextModuleBase & {getTokenPayload(): TokenPayload}}>,
        url: `/api/durable-objects/${string}`,
        {
            serviceName,
            route,
            body,
        }: {
            serviceName: TokenServiceName;
            route: `/api/durable-objects/${string}`;
            body?: SchemaSerializedValue | null;
        },
    ) {
        // Double-check that we're sending a request to our durable object.
        assert(url.startsWith("/api/durable-objects/"));

        // Include a token showing this request is from `AppService`.
        const token = await this._tokenAgent.privateSide.dangerouslySignShortLivedToken(
            serviceName,
            this._context.actor.getTokenPayload(),
        );

        const headers: {[key: string]: string} = {
            authorization: `bearer ${token}`,
        };

        if (body != null) {
            headers["content-type"] = "application/json";
        }

        return await fetchWithTracer(
            this._context.tracer.getTracer(),
            new URL(url, this._edgeServiceUrl),
            {
                serviceName,
                route,
                method: "POST",
                headers,
                body: body != null ? JSON.stringify(body) : body,
            },
            async response => {
                if (response.status !== 200) {
                    throw new InternalError(
                        quote`Fetch to ${route} failed with status code ${response.status}`,
                    );
                }
                return await response.json();
            },
        );
    }

    public fork() {
        return new EdgeServiceContextModule({
            edgeServiceUrl: this._edgeServiceUrl,
            tokenAgent: this._tokenAgent,
        });
    }
}
