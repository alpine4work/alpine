import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";

/**
 * Whether the actor may broadcast database table-metadata realtime events to a
 * group's durable object (the `/broadcast-...` route). Like {@link
 * canRunInternalDatabaseActions} this is a provenance gate that keeps browsers
 * out; the broadcast path is driven by the server code that writes table metadata
 * (`AppService`/`JobQueueService`/`ApiService`).
 */
export function canBroadcastDatabaseTableMetadata(actor: WorkerActionContext["actor"]): boolean {
    switch (actor.serviceName) {
        case "AppService":
        case "JobQueueService":
        case "ApiService":
            return true;
        default:
            return false;
    }
}
