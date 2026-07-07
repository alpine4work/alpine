import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";

/**
 * Whether the actor's token was issued by trusted server-side code, as opposed to
 * a public transport.
 *
 * An actor's `serviceName` is the _issuer_ of its short-lived token — the service
 * whose private key signed it — not the audience. Requests arriving at the
 * database group durable object are issued by:
 *
 * - `EdgeService` — browser traffic (WebSocket upgrades and any HTTP subpath the
 *   edge forwards); the payload is the browser's session. NOT trusted: these
 *   actors get per-table access enforcement and may not run `internalOnly` actions
 *   or reach service-only routes.
 * - `AppService` / `JobQueueService` / `ApiService` — server code forwarding an
 *   operation it has already authorized (e.g. `syncTableMetadata` after a
 *   Manage-gated policy update). Trusted.
 * - `DatabaseGroupService` — the durable object itself. Trusted.
 * - `Test` — unit-test contexts. Trusted.
 */
export function isTrustedDatabaseServiceActor(actor: WorkerActionContext["actor"]): boolean {
    switch (actor.serviceName) {
        case "AppService":
        case "JobQueueService":
        case "ApiService":
        case "DatabaseGroupService":
        case "Test":
            return true;
        default:
            return false;
    }
}
