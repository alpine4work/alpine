import {Star} from "phosphor-react";
import {Memo, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {MenuAction} from "~/client/design/menu.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {sprinkles} from "~/client/styles/styles.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {
    favoriteSearchAffinityEntity,
    unfavoriteSearchAffinityEntity,
} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

// This orange looks much nicer for the favorites color than yellow. It's warm
// and easier to read on a white background than yellow.
export const searchAffinityEntityFavoriteIconColor = "orange-30-const";
export const searchAffinityEntityFavoriteIconPressedColor = {
    light: "orange-40-const",
    dark: "orange-20-const",
} as const;

export function useSearchFavoriteAffinityEntityMenuAction(
    entityId: SearchAffinityEntityId,
    initialIsFavorite: boolean,
): Memo<MenuAction> | null {
    const context = useAppContext();
    const {space, currentAccount} = useSpaceContext();
    const hasCurrentAccount = !!currentAccount;

    const [isFavorite, setIsFavorite] = useState(initialIsFavorite);

    const mutexRef = useRef<Mutex | null>(null);

    return useMemo((): MenuAction | null => {
        // If the actor doesn't have space access then we shouldn't be showing the
        // favorite menu action. Since the favorite/unfavorite RPCs will throw an
        // error if you try to call them.
        if (!hasCurrentAccount) return null;

        return {
            label: "Favorite",
            icon: ({isPressed}: {isPressed: boolean}) => (
                <Star
                    weight={isFavorite ? "fill" : undefined}
                    className={sprinkles({
                        fill: isFavorite
                            ? isPressed
                                ? searchAffinityEntityFavoriteIconPressedColor
                                : searchAffinityEntityFavoriteIconColor
                            : undefined,
                    })}
                />
            ),
            iconPlacement: "end",
            pressErrorTitle: isFavorite
                ? "Couldn’t remove from favorites"
                : "Couldn’t add to favorites",
            onPress: async () => {
                mutexRef.current ??= new Mutex();

                // Don't allow multiple favorite/unfavorite requests to happen at once. Our
                // `isFavorite` React state might start exhibiting buggy behavior.
                await mutexRef.current.withLock(async () => {
                    if (isFavorite) {
                        // Optimistically update our `isFavorite` state so the UI changes at the same
                        // time as `isPressed` becomes false. If the RPC fails then we revert the
                        // change.
                        setIsFavorite(false);

                        try {
                            await unfavoriteSearchAffinityEntity(context, {
                                spaceId: space.id,
                                entityId,
                            });
                        } catch (error) {
                            setIsFavorite(isFavorite);
                            throw error;
                        }
                    } else {
                        // Optimistically update our `isFavorite` state so the UI changes at the same
                        // time as `isPressed` becomes false. If the RPC fails then we revert the
                        // change.
                        setIsFavorite(true);

                        try {
                            await favoriteSearchAffinityEntity(context, {
                                spaceId: space.id,
                                entityId,
                            });
                        } catch (error) {
                            setIsFavorite(isFavorite);
                            throw error;
                        }
                    }
                });

                return {withoutClose: true};
            },
        };
    }, [context, entityId, hasCurrentAccount, isFavorite, space.id]);
}
