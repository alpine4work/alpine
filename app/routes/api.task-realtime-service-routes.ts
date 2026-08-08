import generateEtag from "etag";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    TaskRealtimeServiceRoutesSchema,
    taskRealtimeServiceRoutesInvalidatedMs,
    taskRealtimeServiceRoutesRevalidateMs,
} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.open_source.js";

/**
 * Returns encrypted task service routing information for `EdgeService`. This way
 * when `EdgeService` receives a WebSocket connection request for
 * `TaskRealtimeService` it can send the traffic to the appropriate server for the
 * provided `SpaceId`.
 *
 * Uses HTTP caching to avoid frequent requests to this endpoint. Since the result
 * should be cacheable in a shared HTTP cache (like the Cloudflare edge cache) we
 * encrypt the result. Only the `EdgeService` private key can decrypt it.
 */
export async function loader({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "GET") throw new InvalidArgumentError("Must use GET HTTP method");

        const routes = await context.tasks.router.getRoutes(context);
        const routesString = JSON.stringify(TaskRealtimeServiceRoutesSchema.serialize(routes));
        const routesEtag = generateEtag(routesString);

        const cacheControlHeader = [
            // Allow caching this resource in Cloudflare's shared cache. Though this data is
            // sensitive to our system! Making it available in a shared cache means we can't
            // use the `Authorization` header to block actors outside our system from reading
            // it. So instead we encrypt the response such that only the `EdgeService` can read
            // it.
            "public",
            // We want the resource to be available for some time and revalidate in the
            // background when it's stale instead of blocking a request.
            `max-age=${Math.floor(taskRealtimeServiceRoutesRevalidateMs / 1000)}`,
            `stale-while-revalidate=${Math.floor(
                (taskRealtimeServiceRoutesInvalidatedMs - taskRealtimeServiceRoutesRevalidateMs) /
                    1000,
            )}`,
        ].join(", ");

        // Clients can use the etag header to avoid receiving the full response.
        if (request.headers.get("if-none-match") === routesEtag) {
            return new Response(null, {
                status: 304,
                headers: {
                    "cache-control": cacheControlHeader,
                    etag: routesEtag,
                },
            });
        }

        const encryptedRoutesString = await context.loader.tokenAgent.publicSide.encrypt(
            "EdgeService",
            routesString,
        );

        return new Response(encryptedRoutesString, {
            status: 200,
            headers: {
                // Mime type defined for JWS and JWE:
                // https://www.rfc-editor.org/rfc/rfc7515#section-9.2.1
                "content-type": "application/jose",
                "cache-control": cacheControlHeader,
                etag: routesEtag,
            },
        });
    } catch (error) {
        span.addException(error);

        return new Response(
            JSON.stringify({
                ok: false,
                error: ErrorSchema.serialize(error),
            }),
            {
                status: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
