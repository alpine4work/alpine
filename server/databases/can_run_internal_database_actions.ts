import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";

/**
 * Whether the actor arrived from trusted internal server code rather than a public
 * transport, and so may run `internalOnly` database actions (schema mutations like
 * `createTable`/`syncTableMetadata`) and reach the service-only HTTP `/action`
 * route.
 *
 * This is a _provenance_ check, not a data-authority one. An actor's `serviceName`
 * is the _issuer_ of its short-lived token — the service whose private key signed
 * it (see `createDurableObjectActorContextModule`), not the audience or the
 * originating account. A public client cannot forge it: a browser request
 * forwarded through the edge is re-signed by the edge and arrives as
 * `EdgeService`, so it is excluded here and must use the WebSocket protocol.
 *
 * It deliberately answers only "did this come from inside, not from a browser." It
 * does **not** decide per-table data access: a session forwarded by `AppService`
 * (e.g. a server-side-rendered read) still carries a real account, and that
 * account's per-table access is enforced separately (see
 * `DatabaseServer.executeAction`, which only skips enforcement for `internalOnly`
 * actions or a `System` actor). Conflating the two would let any
 * `AppService`-forwarded session bypass per-table enforcement purely because of
 * who forwarded it.
 *
 * Requests reaching the internal action path are issued by:
 *
 * - `AppService` — database RPCs and route loaders, e.g. `createDatabaseTable`
 *   running `createTable`.
 * - `JobQueueService` — the `IndexSearchEntity` job syncs table metadata via
 *   `syncTableMetadata`.
 * - `Test` — unit-test contexts execute actions directly. No production token can
 *   be issued as `Test` (it is not a signing service), so this is unreachable
 *   outside tests.
 *
 * Keep this set as small as the call graph allows: an actor reaching the durable
 * object from an unlisted service fails loudly (a `PermissionDeniedError` naming
 * the action, easy to diagnose and add), whereas a spurious entry silently widens
 * the trusted surface. Notably this excludes `DatabaseGroupService` (the durable
 * object's own service name): nothing self-issues an internal action, and listing
 * it would grant internal rights to any token signed by the durable object's key.
 */
export function canRunInternalDatabaseActions(actor: WorkerActionContext["actor"]): boolean {
    switch (actor.serviceName) {
        case "AppService":
        case "JobQueueService":
        case "Test":
            return true;
        default:
            return false;
    }
}
