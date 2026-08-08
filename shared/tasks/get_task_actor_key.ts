import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";

export type TaskActorKey = "System" | `Account:${AccountId}` | `Bot:${AccountId}:${AccountId}`;

/**
 * Returns the collision-safe identity of an activity actor, including bot
 * provenance.
 */
export function getTaskActorKey(actor: TaskCreator | null): TaskActorKey {
    if (actor === null) return "System";
    return actor.from === null
        ? `Account:${actor.accountId}`
        : `Bot:${actor.accountId}:${actor.from.accountId}`;
}
