import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentAppServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenPayload} from "~/server/tokens/token_payload.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

/**
 * Sends an HTTP request to a durable object running in the spawned edge service,
 * the integration-test counterpart to
 * `EdgeServiceContextModule.sendRequestToDurableObject()`.
 *
 * The integration test environment applies document content writes directly to the
 * database rather than going through the durable object (see
 * `with_integration_test_environment.ts`). It uses this helper to reach the edge
 * service's durable objects when an in-process database write isn't enough — for
 * example, to evict a document's collaboration durable object via
 * `/reset-for-test` after a direct write so it reinitializes fresh instead of
 * serving a stale in-memory version.
 *
 * This mirrors the few lines of
 * `EdgeServiceContextModule.sendRequestToDurableObject()`: sign a short-lived
 * service token for the actor and `POST` the request to the spawned edge service.
 */
export async function forwardDurableObjectRequestToEdgeServiceForTest(
    // `sendRequestToDurableObject()` is always called from an account action context,
    // which has the `actor` and `tracer` modules this function needs.
    context: Context<{}>,
    {
        edgeServiceUrl,
        tokenAgent,
        serviceName,
        url,
        route,
        body,
    }: {
        edgeServiceUrl: string;
        tokenAgent: TokenAgent<TokenAgentAppServicePrivateSide>;
        serviceName: TokenServiceName;
        url: `/api/durable-objects/${string}`;
        route: `/api/durable-objects/${string}`;
        body?: SchemaSerializedValue | null;
    },
): Promise<SchemaSerializedValue> {
    const actionContext = context as Context<{
        actor: ContextModuleBase & {getTokenPayload(): TokenPayload};
        tracer: TracerContextModule;
    }>;

    // Include a token showing this request is from `AppService`, just like
    // `EdgeServiceContextModule` does in production.
    const token = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
        serviceName,
        actionContext.actor.getTokenPayload(),
    );

    const headers: {[key: string]: string} = {
        authorization: `bearer ${token}`,
    };

    if (body != null) {
        headers["content-type"] = "application/json";
    }

    return await fetchWithTracer(
        actionContext.tracer.getTracer(),
        new URL(url, edgeServiceUrl),
        {
            serviceName,
            route,
            method: "POST",
            headers,
            body: body != null ? JSON.stringify(body) : body,
        },
        async response => {
            if (response.status !== 200) {
                const responseText = await response.text();
                throw new InternalError(
                    quote`Fetch to ${route} failed with status code ${response.status}: ${responseText}`,
                );
            }
            return await response.json();
        },
    );
}
