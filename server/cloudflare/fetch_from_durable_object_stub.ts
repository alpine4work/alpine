import {SignJWT} from "jose";
import {unauthenticatedSessionError} from "~/server/dynamo/context/helpers/unauthenticated_session_error";
import {SessionCookieStorage} from "~/server/remix/session_cookie";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header";
import {TracerSpan} from "~/shared/tracer/tracer_span";

/**
 * Send a request to a Cloudflare Durable Object created with
 * `createDurableObject()` from a Cloudflare Worker. Makes sure the session,
 * tracer data, and ID is correctly propagated.
 */
export async function fetchFromDurableObjectStub({
    durableObjectNamespace,
    sessionCookieSecret,
    sessionCookieStorage,
    request,
    pathname,
    idName,
    span,
}: {
    durableObjectNamespace: DurableObjectNamespace;
    sessionCookieSecret: string;
    sessionCookieStorage: SessionCookieStorage;
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

    const sessionCookie = await sessionCookieStorage.get(request);
    if (!sessionCookie.sessionId) throw unauthenticatedSessionError();

    // Create a short-lived JWT for sharing the `sessionId` with the durable object.
    //
    // We use a JWT to ensure that it's our app worker sending the `sessionId`. If
    // an attacker got access to the Durable Object URL then they could send a
    // request with whatever `sessionId` they have access to! Using a signed JWT
    // prevents that.
    const authenticationToken = await new SignJWT({
        sessionId: sessionCookie.sessionId,
    })
        .setProtectedHeader({alg: "HS256"})
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(new TextEncoder().encode(sessionCookieSecret));

    newRequest.headers.set("authorization", `bearer ${authenticationToken}`);

    return durableObjectStub.fetch(newRequest);
}
