import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";

/**
 * Whether the actor may run `internalOnly` database actions (schema mutations like
 * `createTable`/`syncTableMetadata`) and reach the service-only HTTP `/action`
 * route.
 *
 * This is a _provenance_ gate, not a data-authority one: `serviceName` is the
 * signed-in issuer of the actor's token, so a browser (which arrives re-signed as
 * `EdgeService`) can't reach these paths. Per-table data access is enforced
 * separately in `DatabaseServer.executeAction`. `Test` is unreachable in
 * production (not a signing service). `DatabaseGroupService` is deliberately
 * excluded — nothing self-issues internal actions.
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
