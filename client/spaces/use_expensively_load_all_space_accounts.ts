import {useContext, useEffect, useState} from "react";
import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {useAppContext} from "~/client/context/app_context";
import {preloadRpc, useLazyLoadLoadRpc} from "~/client/rpc/use_lazy_load_rpc";
import {useSpaceContext} from "~/client/spaces/space_context";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions";

/**
 * Return all the accounts in this space and a Fuse.js search index for those
 * accounts. Returns `null` if we are loading the accounts from the network.
 * Throws an error if we are not in a space route.
 *
 * Using this hook will load the accounts in the space. If the space accounts were
 * already loaded we will return stale data for a bit while we reload. It's
 * recommended that you use `usePreloadSpaceAccounts()` in some parent component so
 * that stale accounts are ready when this hook is called.
 */
export function useExpensivelyLoadAllSpaceAccounts() {
    const {space} = useSpaceContext();
    const {data} = useLazyLoadLoadRpc(expensivelyGetAllSpaceAccounts, {spaceId: space.id});
    return data?.accounts ?? null;
}

/**
 * Preload space accounts so that they are immediately available when you
 * call `useSpaceAccounts()` and you don't have to wait for a network request.
 */
export function useExpensivelyPreloadAllSpaceAccounts() {
    const context = useAppContext();
    const {space} = useSpaceContext();

    useEffect(() => {
        // If we get some time preload accounts. `requestIdleCallback()` is not
        // implemented on Safari. Generally we recommend using the React scheduler
        // since it has centralized knowledge of all our tasks.
        unstable_scheduleCallback(unstable_IdlePriority, () => {
            preloadRpc(context, expensivelyGetAllSpaceAccounts, {spaceId: space.id});
        });
    }, [context, space.id]);
}
