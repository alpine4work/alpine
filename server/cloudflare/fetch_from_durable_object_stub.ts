import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgentBase} from "~/server/tokens/token_agent.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {DurableObjectServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Send a request to a Cloudflare Durable Object created with
 * `createDurableObject()` from a Cloudflare Worker. Makes sure the session,
 * tracer data, and ID is correctly propagated.
 */
export async function fetchFromDurableObjectStub({
    durableObjectNamespace,
    serviceName,
    tokenAgent,
    request,
    pathname,
    idName,
    span,
}: {
    durableObjectNamespace: DurableObjectNamespace;
    serviceName: DurableObjectServiceName;
    tokenAgent: TokenAgentBase;
    request: Request;
    pathname: string;
    idName: string;
    span: TracerSpan;
}): Promise<Response> {
    const durableObjectId = durableObjectNamespace.idFromName(idName);
    const durableObjectStub = durableObjectNamespace.get(durableObjectId);

    const newUrl = new URL(request.url);
    newUrl.pathname = pathname;
    const newRequest = new Request(newUrl.toString(), request);
    newRequest.headers.set("cyberworlds-id-name", idName);
    addTracerPropagationContextHeader(newRequest.headers, span);

    const sessionCookieToken = await getSessionCookieIfExists(tokenAgent, request);
    if (!sessionCookieToken) throw unauthenticatedSessionError();

    const requestToken = await tokenAgent.dangerouslySignShortLivedToken(
        serviceName,
        sessionCookieToken,
    );
    newRequest.headers.set("authorization", `bearer ${requestToken}`);

    return durableObjectStub.fetch(newRequest);
}
