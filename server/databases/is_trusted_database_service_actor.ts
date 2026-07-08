import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";

/**
 * Whether the actor's token was issued by trusted server-side code, as opposed to
 * a public transport. Trusted actors run unrestricted (no per-table access
 * enforcement) and are the only ones allowed to execute `internalOnly` database
 * actions (schema mutations like `createTable`/`syncTableMetadata`).
 *
 * An actor's `serviceName` is the _issuer_ of its short-lived token — the service
 * whose private key signed it (see `createDurableObjectActorContextModule`), not
 * the audience or the originating account. A public client cannot forge it: a
 * browser request forwarded through the edge is re-signed by the edge and arrives
 * as `EdgeService`, and a session/account actor carries its own non-backend service
 * name.
 *
 * Requests arriving at the database group durable object are issued by:
 *
 * - `EdgeService` — browser traffic (WebSocket upgrades and any HTTP subpath the
 *   edge forwards); the payload is the browser's session. NOT trusted: these actors
 *   get per-table access enforcement and may not run `internalOnly` actions or reach
 *   service-only routes.
 * - `AppService` — database RPCs and route loaders, e.g. `createDatabaseTable`
 *   running `createTable`. Trusted.
 * - `JobQueueService` — the `IndexSearchEntity` job syncs table metadata via
 *   `syncTableMetadata`. Trusted.
 * - `Test` — unit-test contexts execute actions directly. No production token can be
 *   issued as `Test` (it is not a signing service), so this is unreachable outside
 *   tests. Trusted.
 *
 * Keep this set as small as the call graph allows: an actor reaching the durable
 * object from an unlisted service fails loudly (a `PermissionDeniedError` naming the
 * action, easy to diagnose and add), whereas a spurious entry silently widens the
 * trusted surface. Notably this excludes `DatabaseGroupService` (the durable
 * object's own service name): nothing self-issues an internal action, and listing it
 * would grant trusted rights to any token signed by the durable object's key.
 */
export function isTrustedDatabaseServiceActor(actor: WorkerActionContext["actor"]): boolean {
    switch (actor.serviceName) {
        case "AppService":
        case "JobQueueService":
        case "Test":
            return true;
        default:
            return false;
    }
}
