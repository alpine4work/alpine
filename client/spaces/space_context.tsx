import Fuse from "fuse.js";
import {
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/context/app_context";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted";
import {InternalError} from "~/shared/error/error";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {unwrapResult} from "~/shared/helpers/control/capture_result";
import {Result} from "~/shared/helpers/control/result";
import {SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions";

const SpaceContext = createContext<{
    readonly currentAccount: AccountModel;
    preloadSpaceAccounts(): void;
} | null>(null);

type SpaceAccountsState = {
    readonly spaceId: SpaceId;
    readonly isLoading: boolean;
    readonly data: Result<{
        readonly accounts: ReadonlyArray<AccountModel>;
        readonly fuse: Fuse<AccountModel>;
    }> | null;
};

const SpaceAccountsContext = createContext<{
    readonly state: SpaceAccountsState;
    reload(): void;
} | null>(null);

/**
 * Context available when we are in a space route. Throws an
 * error if we are not in a space route.
 */
export function useSpaceContext() {
    const spaceContext = useContext(SpaceContext);
    if (!spaceContext) throw new InternalError("Must be in a space route to get space context");
    return spaceContext;
}

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
    const spaceAccountsContext = useContext(SpaceAccountsContext);
    if (!spaceAccountsContext)
        throw new InternalError("Must be in a space route to get space accounts");

    // Reload space accounts on initial render. We will use the existing data in
    // our context while waiting for the reload to finish.
    const hasInitiallyRenderedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyRenderedRef.current) return;
        hasInitiallyRenderedRef.current = true;

        spaceAccountsContext.reload();
    }, [spaceAccountsContext]);

    return spaceAccountsContext.state.data ? unwrapResult(spaceAccountsContext.state.data) : null;
}

/**
 * Preload space accounts so that they are immediately available when you
 * call `useSpaceAccounts()` and you don't have to wait for a network request.
 */
export function useExpensivelyPreloadAllSpaceAccounts() {
    const spaceContext = useSpaceContext();

    // Preload space accounts on initial render.
    const hasInitiallyRenderedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyRenderedRef.current) return;
        hasInitiallyRenderedRef.current = true;

        spaceContext.preloadSpaceAccounts();
    }, [spaceContext]);
}

export function SpaceContextProvider({
    spaceId,
    currentAccount,
    children,
}: {
    spaceId: SpaceId;
    currentAccount: AccountModel;
    children?: ReactNode;
}) {
    const context = useAppContext();
    const isMounted = useIsMounted();

    const [_spaceAccountsState, setSpaceAccountsState] = useState<SpaceAccountsState>({
        spaceId,
        isLoading: false,
        data: null,
    });

    const spaceAccountsState = useMemo(
        () =>
            _spaceAccountsState.spaceId === spaceId
                ? _spaceAccountsState
                : {
                      spaceId,
                      isLoading: false,
                      data: null,
                  },
        [_spaceAccountsState, spaceId],
    );

    // If we have different state thanks to props, reflect that back in
    // our state...
    if (spaceAccountsState !== _spaceAccountsState) setSpaceAccountsState(spaceAccountsState);

    // If we are not currently loading accounts, start loading them regardless of
    // whether we already have data. Our old data will be considered stale.
    const reloadSpaceAccounts = useCallback(() => {
        setSpaceAccountsState(spaceAccountsState =>
            !spaceAccountsState.isLoading
                ? {...spaceAccountsState, isLoading: true}
                : spaceAccountsState,
        );
    }, []);

    // Add a low priority tasks to preload accounts. If we have already loaded some
    // accounts then this does nothing.
    const preloadSpaceAccounts = useEvent(() => {
        if (spaceAccountsState.data) return;

        requestIdleCallback(() => {
            if (!isMounted()) return;

            setSpaceAccountsState(spaceAccountsState =>
                spaceAccountsState.spaceId === spaceId &&
                !spaceAccountsState.isLoading &&
                !spaceAccountsState.data
                    ? {...spaceAccountsState, isLoading: true}
                    : spaceAccountsState,
            );
        });
    });

    // When `isLoading` changes from `false` to `true` then we want to send a
    // network request to actually load the accounts. We use a ref to track if the
    // network request has actually been sent.
    const isActuallyLoadingAccountsForSpaceIdRef = useRef<SpaceId | null>(null);
    useEffect(() => {
        const {spaceId} = spaceAccountsState;

        if (!spaceAccountsState.isLoading) return;
        if (isActuallyLoadingAccountsForSpaceIdRef.current === spaceId) return;
        isActuallyLoadingAccountsForSpaceIdRef.current = spaceId;

        runPromiseWithoutAwaiting(async () => {
            try {
                const {accounts} = await expensivelyGetAllSpaceAccounts(context, {spaceId});

                // Sort accounts by name using the user's current locale. Ideally we would sort
                // by relevance to the user but this is the simple thing to do for now.
                const sortedAccounts = Array.from(accounts).sort((account1, account2) =>
                    account1.name.localeCompare(account2.name),
                );

                // Build Fuse search index...
                const fuse = new Fuse(sortedAccounts, {keys: ["name"]});

                // Don't set state if the component unmounted...
                if (isMounted()) {
                    setSpaceAccountsState(spaceAccountsState => {
                        // Don't set state if the space ID changed...
                        if (spaceAccountsState.spaceId !== spaceId) return spaceAccountsState;
                        return {
                            spaceId,
                            isLoading: false,
                            data: {
                                ok: true,
                                value: {accounts: sortedAccounts, fuse},
                            },
                        };
                    });
                }
            } catch (error) {
                if (isMounted()) {
                    setSpaceAccountsState(spaceAccountsState => {
                        if (spaceAccountsState.spaceId !== spaceId) return spaceAccountsState;
                        return {
                            spaceId,
                            isLoading: false,
                            data: {
                                ok: false,
                                error,
                            },
                        };
                    });
                }
            }
        });
    }, [context, isMounted, spaceAccountsState]);

    return (
        <SpaceContext.Provider
            value={useMemo(
                () => ({currentAccount, preloadSpaceAccounts}),
                [currentAccount, preloadSpaceAccounts],
            )}
        >
            <SpaceAccountsContext.Provider
                value={useMemo(
                    () => ({state: spaceAccountsState, reload: reloadSpaceAccounts}),
                    [reloadSpaceAccounts, spaceAccountsState],
                )}
            >
                {children}
            </SpaceAccountsContext.Provider>
        </SpaceContext.Provider>
    );
}
