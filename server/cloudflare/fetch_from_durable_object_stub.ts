import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {DurableObjectServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Send a request to a Cloudflare Durable Object created with
 * `createDurableObject()` from a Cloudflare Worker. Makes sure the session, tracer
 * data, and ID is correctly propagated.
 */
export async function fetchFromDurableObjectStub({
    durableObjectNamespace,
    serviceName,
    tokenAgent,
    cookieNameSuffix,
    request,
    pathname,
    idName,
    span,
}: {
    durableObjectNamespace: DurableObjectNamespace;
    serviceName: DurableObjectServiceName;
    tokenAgent: TokenAgent;
    cookieNameSuffix: string;
    request: Request;
    pathname: string;
    idName: string;
    span: TracerSpan;
}): Promise<Response> {
    const durableObjectId = durableObjectNamespace.idFromName(idName);

    const durableObjectStub = durableObjectNamespace.get(durableObjectId, {
        // Currently, we only have data in the AWS region `us-east-1`. So place Durable
        // Objects in the Eastern North America region so Durable Objects get low latency
        // when making RPC calls to `AppService` in AWS.
        //
        // Long term, ideally we'll put space data in the nearest AWS region to the
        // customer and our Durable Objects should be created near that data center as
        // well. Or we'll have DynamoDB replicas in multiple regions.
        locationHint: "enam",
    });

    const newUrl = new URL(request.url);
    newUrl.pathname = pathname;
    const newRequest = new Request(newUrl.toString(), request);
    newRequest.headers.set("cyberworlds-durable-object-id-name", idName);
    addTracerPropagationContextHeader(newRequest.headers, span);

    // We authenticate with an `Authorization` not a `Cookie` header.
    newRequest.headers.delete("cookie");

    if (!newRequest.headers.has("authorization")) {
        const sessionCookieToken = await getSessionCookieIfExists({
            tokenAgent,
            cookieNameSuffix,
            request,
        });
        if (!sessionCookieToken) throw unauthenticatedSessionError();

        const requestToken = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
            serviceName,
            sessionCookieToken,
        );
        newRequest.headers.set("authorization", `bearer ${requestToken}`);
    }

    return await durableObjectStub.fetch(newRequest);
}
