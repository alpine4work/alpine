import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {AppContext} from "~/client/context/app_context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {markSearchEntityAffinityInteraction} from "~/shared/rpc/search_rpc_definitions.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchEntityAffinityId} from "~/shared/search/search_entity_affinity_id.js";

const SessionStorageSchema = Schema.object({
    lastUpdateTime: Schema.float.nullable().default(null),
});

const sessionStorageBySearchEntityId = new Map<
    SearchEntityAffinityId,
    SchemaType<typeof SessionStorageSchema>
>();

let scheduledPersistSessionStorageEntityIds: Set<SearchEntityAffinityId> | null = null;

/**
 * Send `markSearchEntityAffinityInteraction()` with a `LowIntentUpdate`
 * interaction once every 24 seconds. The idea is a single update gives you a
 * low intent update interaction but continuous updating over the course of two
 * minutes gives you the equivalent of a medium intent update interaction (five
 * low intent update interactions).
 *
 * Our convention is to call this hook from a route file in `app/routes` to
 * make it easier to manage/audit how this hook gets used.
 */
export function markSearchEntityAffinityLowIntentUpdateInteraction(
    context: AppContext,
    spaceId: SpaceId,
    entityId: SearchEntityAffinityId,
) {
    const currentTime = Date.now();

    const {lastUpdateTime} = getOrSetDefaultMapValue(sessionStorageBySearchEntityId, entityId, () =>
        SessionStorageSchema.deserialize(
            JSON.parse(
                sessionStorage.getItem(
                    `cyberworlds/searchEntityAffinityLowIntentUpdateInteraction/${entityId}`,
                ) ?? "{}",
            ),
        ),
    );

    const updateThrottleDuration = (1000 * 60 * 2) / 5; // 2min / 5 = 24s

    if (lastUpdateTime === null || updateThrottleDuration < currentTime - lastUpdateTime) {
        // If this errs it will show up in our telemetry but we don't care about
        // it here.
        void markSearchEntityAffinityInteraction(context, {
            spaceId,
            entityId,
            interaction: {type: "LowIntentUpdate"},
        });

        sessionStorageBySearchEntityId.set(entityId, {lastUpdateTime: currentTime});
        schedulePersistSessionStorageEntityIdsIfNeeded();
        scheduledPersistSessionStorageEntityIds!.add(entityId);
    }
}

function schedulePersistSessionStorageEntityIdsIfNeeded() {
    if (scheduledPersistSessionStorageEntityIds !== null) return;
    scheduledPersistSessionStorageEntityIds = new Set();

    // Schedule the `sessionStorage.setItem()` call at idle priority when the main
    // thread has a moment. While `sessionStorage.getItem()` and
    // `sessionStorage.setItem()` are synchronous calls, they do require writing to
    // disk so may have unexpected performance characteristics. Safer to call in an
    // idle callback.
    //
    // We can't use `requestIdleCallback()` since Safari doesn't support it. We use
    // the React scheduler since the React scheduler knows about all our other
    // ongoing work.
    unstable_scheduleCallback(unstable_IdlePriority, () => {
        assert(scheduledPersistSessionStorageEntityIds !== null);

        const persistEntityIds = scheduledPersistSessionStorageEntityIds;
        scheduledPersistSessionStorageEntityIds = null;

        for (const persistEntityId of persistEntityIds) {
            const persistSessionStorage = sessionStorageBySearchEntityId.get(persistEntityId);
            if (!persistSessionStorage) continue;

            sessionStorage.setItem(
                `cyberworlds/searchEntityAffinityLowIntentUpdateInteraction/${persistEntityId}`,
                JSON.stringify(SessionStorageSchema.serialize(persistSessionStorage)),
            );
        }
    });
}
