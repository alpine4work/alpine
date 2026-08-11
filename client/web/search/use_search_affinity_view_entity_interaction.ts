import {useEffect} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {useSiteActivation} from "~/client/web/sites/context/site_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.open_source.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {markSearchAffinityEntityInteraction} from "~/shared/rpc/search_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

const SessionStorageSchema = Schema.object({
    durationSinceLastUpdate: Schema.float.nullable().default(null),
});

/**
 * Send `markSearchAffinityEntityInteraction()` calls every 5 minutes while the
 * user is viewing the provided entity. If you pass in `null` this hook will be
 * disabled.
 *
 * `siteId` should be the id of the site this entity inherits its access policy
 * from, or `null` if it isn't in a site (or the entity itself is the site). When
 * non-null, view interactions cascade 80% of their points to the site.
 *
 * Our convention is to call this hook from a route file in `app/routes` to make it
 * easier to manage/audit how this hook gets used.
 */
export function useSearchAffinityViewEntityInteraction(entityId: SearchAffinityEntityId | null) {
    const context = useAppContext();
    const {space, currentAccount} = useSpaceContext();

    // TODO(#sites-testing): make sure you test this works with sites. Should send to
    // the site whenever an entity is rendered in a site.
    const {activeSiteId} = useSiteActivation();

    // When rendered in a peek, the peek may disable view interaction tracking. If you
    // only briefly view a search entity from within the search window's peek, that
    // shouldn't add to the affinity score.
    const withoutSearchAffinityViewEntityInteraction =
        usePeekContext()?.withoutSearchAffinityViewEntityInteraction ?? false;

    // Every 5min while our this hook is mounted we add to the entity's affinity score.
    // We don't add to affinity scores while the page is hidden. We resume if the user
    // reopens the page.
    useEffect(() => {
        // If the actor doesn't have space access, don't send view search affinity
        // requests. They'll be rejected with `PermissionDeniedError` or
        // `UnauthenticatedError` anyway.
        if (!currentAccount) return;

        if (!entityId) return;
        if (withoutSearchAffinityViewEntityInteraction) return;

        const clock = new MonotonicClock(unsynchronizedSystemClock);

        let state: {
            timeout: Timeout;
            lastUpdatedTime: number;
        } | null = null;

        const update = () => {
            const currentTime = clock.now();

            // Stop our affinity update loop:
            if (document.visibilityState !== "visible" && state) {
                sessionStorage.setItem(
                    `cyberworlds/searchAffinityViewEntityInteraction/${entityId}`,
                    JSON.stringify(
                        SessionStorageSchema.serialize({
                            durationSinceLastUpdate: currentTime - state.lastUpdatedTime,
                        }),
                    ),
                );
                state.timeout.clear();
                state = null;
            }

            // Start our affinity update loop:
            if (document.visibilityState === "visible" && !state) {
                const {durationSinceLastUpdate} = SessionStorageSchema.deserialize(
                    JSON.parse(
                        sessionStorage.getItem(
                            `cyberworlds/searchAffinityViewEntityInteraction/${entityId}`,
                        ) ?? "{}",
                    ),
                );

                const updateIntervalDuration = 1000 * 60 * 5; // 5min

                let updateCount = 0;
                const maxUpdateCount = 12;

                const updateLoop = () => {
                    // If this errs it will show up in our telemetry but we don't care about it here.
                    void markSearchAffinityEntityInteraction(context, {
                        spaceId: space.id,
                        entityId,
                        interaction: {type: "View"},
                        siteId: activeSiteId,
                    });

                    // Stop loop after we hit a max number of updates (1hr) to defend against the user
                    // leaving their computer open and unattended for a long time. If the user is
                    // continuously interacting with the page then we'll continue adding points.
                    updateCount++;
                    if (updateCount >= maxUpdateCount) return;

                    state = {
                        lastUpdatedTime: currentTime,
                        timeout: createTimeout(updateLoop, updateIntervalDuration),
                    };
                };

                if (
                    durationSinceLastUpdate === null ||
                    updateIntervalDuration < durationSinceLastUpdate
                ) {
                    updateLoop();
                } else {
                    state = {
                        lastUpdatedTime: currentTime - durationSinceLastUpdate,
                        timeout: createTimeout(
                            updateLoop,
                            updateIntervalDuration - durationSinceLastUpdate,
                        ),
                    };
                }
            }
        };

        update();

        document.addEventListener("visibilitychange", update);
        return () => {
            document.removeEventListener("visibilitychange", update);

            // If our component unmounts, save the duration since last update in our session
            // storage so we can pick up adding affinity points from there if the user
            // navigates back.
            if (state) {
                const currentTime = clock.now();

                sessionStorage.setItem(
                    `cyberworlds/searchAffinityViewEntityInteraction/${entityId}`,
                    JSON.stringify(
                        SessionStorageSchema.serialize({
                            durationSinceLastUpdate: currentTime - state.lastUpdatedTime,
                        }),
                    ),
                );
                state.timeout.clear();
                state = null;
            }
        };
    }, [
        context,
        entityId,
        activeSiteId,
        space.id,
        withoutSearchAffinityViewEntityInteraction,
        currentAccount,
    ]);
}
