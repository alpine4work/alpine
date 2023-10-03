import {useEffect} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {scheduleIdlePreloadRpc, useLazyLoadLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";

/**
 * Return all the accounts in this space. Returns `null` while we are loading
 * the accounts from the network. Throws an error if we are not in a space
 * route.
 *
 * Using this hook will load the accounts in the space. If the space accounts were
 * already loaded we will return stale data for a bit while we reload. It's
 * recommended that you use `useExpensivelyPreloadAllSpaceAccounts()` in some
 * parent component so that stale accounts are ready when this hook is called.
 */
export function useExpensivelyLoadAllSpaceAccounts({
    isDisabled = false,
}: {
    isDisabled?: boolean;
} = {}) {
    const {space} = useSpaceContext();
    const {output} = useLazyLoadLoadRpc(
        expensivelyGetAllSpaceAccounts,
        !isDisabled ? {spaceId: space.id} : null,
    );
    return output?.accounts ?? null;
}

/**
 * Preload space accounts so that they are immediately available when you
 * call `useExpensivelyLoadAllSpaceAccounts()` and you don't have to wait for a
 * network request.
 */
export function useExpensivelyPreloadAllSpaceAccounts() {
    const context = useAppContext();
    const {space} = useSpaceContext();

    useEffect(() => {
        scheduleIdlePreloadRpc(context, expensivelyGetAllSpaceAccounts, {spaceId: space.id});
    }, [context, space.id]);
}
