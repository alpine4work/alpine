import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {AppContext} from "~/client/web/context/app_context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {markSearchAffinityEntityInteraction} from "~/shared/rpc/search_rpc_definitions.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

const SessionStorageSchema = Schema.object({
    lastUpdateTime: Schema.float.nullable().default(null),
    count: Schema.integer.default(0),
});

const sessionStorageBySearchAffinityEntityId = new Map<
    SearchAffinityEntityId,
    SchemaType<typeof SessionStorageSchema>
>();

let scheduledPersistSessionStorageSearchAffinityEntityIds: Set<SearchAffinityEntityId> | null =
    null;

/**
 * Send `markSearchAffinityEntityInteraction()` with a `LowIntentUpdate`
 * interaction once every 24 seconds. The idea is a single update gives you a low
 * intent update interaction but continuous updating over the course of two minutes
 * gives you the equivalent of a medium intent update interaction (five low intent
 * update interactions).
 *
 * Our convention is to call this hook from a route file in `app/routes` to make it
 * easier to manage/audit how this hook gets used.
 *
 * Returns the number of `markSearchAffinityEntityInteraction()` calls we've made
 * for this entity in this session. If the user closes their browser then opens
 * Alpine back up a day later our count will be reset to 0.
 */
export function markSearchAffinityLowIntentUpdateEntityInteraction(
    context: AppContext,
    spaceId: SpaceId,
    entityId: SearchAffinityEntityId,
    siteId: SiteId | null,
    {
        isVeryLow = false,
    }: {
        // TODO(calebmer): Mixing very low intent updates with regular low intent updates
        // isn't supported right now. Ideally one regular low intent update makes the
        // entire thing low intent (vs very low intent).
        isVeryLow?: boolean;
    } = {},
): number {
    const currentTime = Date.now();

    const {lastUpdateTime, count: oldCount} = getOrSetDefaultMapValue(
        sessionStorageBySearchAffinityEntityId,
        entityId,
        () =>
            SessionStorageSchema.deserialize(
                JSON.parse(
                    sessionStorage.getItem(
                        `cyberworlds/searchAffinityLowIntentUpdateEntityInteraction/${entityId}`,
                    ) ?? "{}",
                ),
            ),
    );

    const updateThrottleDuration = (1000 * 60 * 2) / 5; // 2min / 5 = 24s
    let count = oldCount;

    if (lastUpdateTime === null || updateThrottleDuration < currentTime - lastUpdateTime) {
        count += 1;

        // If this errs it will show up in our telemetry but we don't care about it here.
        void markSearchAffinityEntityInteraction(context, {
            spaceId,
            entityId,
            interaction: {type: isVeryLow ? "VeryLowIntentUpdate" : "LowIntentUpdate"},
            siteId,
        });

        sessionStorageBySearchAffinityEntityId.set(entityId, {lastUpdateTime: currentTime, count});
        schedulePersistSessionStorageEntityIdsIfNeeded();
        scheduledPersistSessionStorageSearchAffinityEntityIds!.add(entityId);
    }

    return count;
}

function schedulePersistSessionStorageEntityIdsIfNeeded() {
    if (scheduledPersistSessionStorageSearchAffinityEntityIds !== null) return;
    scheduledPersistSessionStorageSearchAffinityEntityIds = new Set();

    // Schedule the `sessionStorage.setItem()` call at idle priority when the main
    // thread has a moment. While `sessionStorage.getItem()` and
    // `sessionStorage.setItem()` are synchronous calls, they do require writing to
    // disk so may have unexpected performance characteristics. Safer to call in an
    // idle callback.
    //
    // We can't use `requestIdleCallback()` since Safari doesn't support it. We use the
    // React scheduler since the React scheduler knows about all our other ongoing
    // work.
    unstable_scheduleCallback(unstable_IdlePriority, () => {
        assert(scheduledPersistSessionStorageSearchAffinityEntityIds !== null);

        const persistEntityIds = scheduledPersistSessionStorageSearchAffinityEntityIds;
        scheduledPersistSessionStorageSearchAffinityEntityIds = null;

        for (const persistEntityId of persistEntityIds) {
            const persistSessionStorage =
                sessionStorageBySearchAffinityEntityId.get(persistEntityId);
            if (!persistSessionStorage) continue;

            sessionStorage.setItem(
                `cyberworlds/searchAffinityLowIntentUpdateEntityInteraction/${persistEntityId}`,
                JSON.stringify(SessionStorageSchema.serialize(persistSessionStorage)),
            );
        }
    });
}
