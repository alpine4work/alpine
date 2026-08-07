import {Star} from "phosphor-react";
import {Memo, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {useGlobalContext} from "~/client/web/helpers/global_context.js";
import {RpcCacheContext} from "~/client/web/rpc/rpc_cache.js";
import {forceRevalidateSearchByAffinity} from "~/client/web/search/core/force_revalidate_search_by_affinity.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {favoriteSearchEntity, unfavoriteSearchEntity} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

// This orange looks much nicer for the favorites color than yellow. It's warm and
// easier to read on a white background than yellow.
export const searchFavoriteEntityIconColor = "orange-30-const";
export const searchFavoriteEntityIconPressedColor = {
    light: "orange-40-const",
    dark: "orange-20-const",
} as const;

let updateSearchFavoriteEntityMenuActionEventEmitter: EventEmitter<
    [SpaceId, SearchAffinityEntityId, boolean]
> | null = null;

/**
 * Update the internal `isFavorite` state of all favorite menu actions for the
 * provided `SearchEntityId`. This is very race condition prone but it's good
 * enough for this non-collaborative use case. _Shrug_
 */
export function updateSearchFavoriteEntityMenuAction(
    spaceId: SpaceId,
    entityId: SearchAffinityEntityId,
    isFavorite: boolean,
) {
    updateSearchFavoriteEntityMenuActionEventEmitter?.emit([spaceId, entityId, isFavorite]);
}

/**
 * Listen to any `updateSearchFavoriteEntityMenuAction()` calls. This is very race
 * condition prone but it's good enough for this non-collaborative use case.
 * _Shrug_
 */
export function subscribeToUpdateSearchFavoriteEntityMenuAction(
    listener: (spaceId: SpaceId, entityId: SearchAffinityEntityId, isFavorite: boolean) => void,
) {
    updateSearchFavoriteEntityMenuActionEventEmitter ??= new EventEmitter();
    return updateSearchFavoriteEntityMenuActionEventEmitter.subscribe(args => listener(...args));
}

export function useSearchFavoriteEntityMenuAction(
    entityId: SearchAffinityEntityId,
    initialIsFavorite: boolean,
): Memo<MenuAction> | null {
    const context = useAppContext();
    const rpcCache = useGlobalContext(RpcCacheContext);
    const {space, currentAccount} = useSpaceContext();
    const hasCurrentAccount = !!currentAccount;

    const [isFavorite, setIsFavorite] = useState(initialIsFavorite);

    const mutexRef = useRef<Mutex | null>(null);

    useEffect(() => {
        updateSearchFavoriteEntityMenuActionEventEmitter ??= new EventEmitter();

        return updateSearchFavoriteEntityMenuActionEventEmitter.subscribe(
            ([eventSpaceId, eventEntityId, eventIsFavorite]) => {
                if (eventSpaceId === space.id && eventEntityId === entityId) {
                    setIsFavorite(eventIsFavorite);
                }
            },
        );
    }, [entityId, space.id]);

    return useMemo((): MenuAction | null => {
        // If the actor doesn't have space access then we shouldn't be showing the favorite
        // menu action. Since the favorite/unfavorite RPCs will throw an error if you try
        // to call them.
        if (!hasCurrentAccount) return null;

        return {
            label: "Favorite",
            icon: ({isPressed}: {isPressed: boolean}) => (
                <Star
                    weight={isFavorite ? "fill" : undefined}
                    className={sprinkles({
                        fill: isFavorite
                            ? isPressed
                                ? searchFavoriteEntityIconPressedColor
                                : searchFavoriteEntityIconColor
                            : undefined,
                    })}
                />
            ),
            iconPlacement: "end",
            pressErrorTitle: isFavorite
                ? "Couldn\u2019t remove from favorites"
                : "Couldn\u2019t add to favorites",
            onPress: async () => {
                mutexRef.current ??= new Mutex();

                // Don't allow multiple favorite/unfavorite requests to happen at once. Our
                // `isFavorite` React state might start exhibiting buggy behavior.
                await mutexRef.current.withLock(async () => {
                    if (isFavorite) {
                        // Optimistically update our `isFavorite` state so the UI changes at the same time
                        // as `isPressed` becomes false. If the RPC fails then we revert the change.
                        updateSearchFavoriteEntityMenuAction(space.id, entityId, false);

                        try {
                            await unfavoriteSearchEntity(context, {
                                spaceId: space.id,
                                entityId,
                            });
                        } catch (error) {
                            updateSearchFavoriteEntityMenuAction(space.id, entityId, isFavorite);
                            throw error;
                        }

                        // Force `searchByAffinity()` to revalidate so:
                        //
                        // 1. When the user opens `<SearchModal>` they'll see the new favorite immediately
                        //    and it won't flash in
                        // 2. If the user is already in `<SearchModal>` then they'll see the favorite move
                        //    automatically in realtime
                        forceRevalidateSearchByAffinity(
                            context,
                            rpcCache,
                            space.id,
                            "removing favorite from menu item",
                            output =>
                                output.favoriteResults.every(result => result.id !== entityId),
                        );
                    } else {
                        // Optimistically update our `isFavorite` state so the UI changes at the same time
                        // as `isPressed` becomes false. If the RPC fails then we revert the change.
                        updateSearchFavoriteEntityMenuAction(space.id, entityId, true);

                        try {
                            await favoriteSearchEntity(context, {
                                spaceId: space.id,
                                entityId,
                            });
                        } catch (error) {
                            updateSearchFavoriteEntityMenuAction(space.id, entityId, isFavorite);
                            throw error;
                        }

                        // Force `searchByAffinity()` to revalidate so:
                        //
                        // 1. When the user opens `<SearchModal>` they'll see the new favorite immediately
                        //    and it won't flash in
                        // 2. If the user is already in `<SearchModal>` then they'll see the favorite move
                        //    automatically in realtime
                        forceRevalidateSearchByAffinity(
                            context,
                            rpcCache,
                            space.id,
                            "adding favorite from menu item",
                            output =>
                                output.hasMoreFavoriteResults ||
                                output.favoriteResults.some(result => result.id === entityId),
                        );
                    }
                });

                return {withoutClose: true};
            },
        };
    }, [context, entityId, hasCurrentAccount, isFavorite, rpcCache, space.id]);
}
