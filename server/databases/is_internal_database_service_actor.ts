import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";

/**
 * Whether the actor is a trusted first-party service rather than a public
 * transport. This is the provenance gate for the durable object's service-only
 * surfaces: running `internalOnly` database actions (schema mutations like
 * `createTable`/`syncTableMetadata`, over the `/action` route) and broadcasting
 * table-metadata realtime events.
 *
 * It is _not_ a data-authority check — `serviceName` is the signed issuer of the
 * actor's token, so a browser (which arrives re-signed as `EdgeService`) can't
 * forge it, but per-table access is enforced separately in
 * `DatabaseServer.executeAction`. `Test` is trusted only in the test environment.
 * `DatabaseGroupService` is deliberately excluded — nothing self-issues internal
 * requests.
 */
export function isInternalDatabaseServiceActor(actor: WorkerActionContext["actor"]): boolean {
    switch (actor.serviceName) {
        case "AppService":
        case "JobQueueService":
        case "ApiService":
            return true;
        case "Test":
            return process.env.NODE_ENV === "test";
        default:
            return false;
    }
}
