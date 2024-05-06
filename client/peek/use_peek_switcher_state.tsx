import {deserializeErrors} from "@remix-run/react";
import {HydrationState, MemoryHistory, createMemoryHistory, resolvePath} from "@remix-run/router";
import {Key, Memo, useEffect} from "react";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {loadInitialPeekDataForClient} from "~/client/peek/load_initial_peek_data_for_client.js";
import {PeekRemixEmbedRouter, usePeekRemixEmbedRouter} from "~/client/peek/peek_remix_embed.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {generateId} from "~/shared/id/id.js";
import {PeekId} from "~/shared/id/types/id_types.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";

export type PeekSwitcherStatePeek<Extra> = {
    readonly id: PeekId;
    readonly content: PeekSwitcherStatePeekContent | null;
    readonly extra: Extra;
    readonly setExtra: (extra: Extra) => void;
};

export type PeekSwitcherStatePeekContent = {
    readonly initialSpacePath: string;
    readonly history: MemoryHistory;
    readonly routerPromise: PromiseImmediate<PeekRemixEmbedRouter>;
};

type PeekSwitcherState<Extra> = {
    readonly activePeek: PeekSwitcherStatePeek<Extra> | null;
    readonly transition: {
        readonly peek: PeekSwitcherStatePeek<Extra>;
        readonly pendingPromiseResolver: PromiseResolver<void>;
    } | null;
};

type MaybeThunk<T> = T | (() => T);

/**
 * An abstraction for building interfaces where you can switch between visible
 * peeks. Implements the suspense user interface pattern where we delay showing
 * a loading indicator in the hopes that data will load before the user
 * notices.
 *
 * - `selectedPeek`: The peek that the user has actively selected. We may have
 *   just started loading the data for this peek. Use this for rendering
 *   selection in a list to give user immediate feedback for their selection.
 *
 * - `activePeek`: The peek that we show to the user. We'll show the old peek
 *   for a little after switching while we wait for the new peek's data to
 *   load.
 *
 * - `switchPeek`: Function you call to switch the peek. Its promise will
 *   resolve when the new `selectedPeek` becomes the `activePeek` even if its
 *   data hasn't finished loading yet.
 *
 *   If `spacePath` is null then `activePeek.content` will be null. Useful if
 *   you're using this hook to control some selected state but in some
 *   selections you don't want to render a peek.
 */
export function usePeekSwitcherState<Extra>({
    key = null,
    initialPeekData,
}: {
    key?: Key | null;
    initialPeekData: MaybeThunk<{
        spacePath: string | null;
        hydrationData: HydrationState;
        extra: Extra;
    } | null>;
}): {
    selectedPeek: PeekSwitcherStatePeek<Extra> | null;
    activePeek: PeekSwitcherStatePeek<Extra> | null;
    switchPeek: Memo<(peekData: {spacePath: string | null; extra: Extra} | null) => Promise<void>>;
} {
    const {peekRoutes, createPeekRouter} = usePeekRemixEmbedRouter();

    const createSetPeekExtra = (id: PeekId) => {
        return (extra: Extra) => {
            setPeekState(peekState => {
                if (peekState.activePeek?.id === id && peekState.activePeek.extra !== extra) {
                    peekState = {
                        ...peekState,
                        activePeek: {...peekState.activePeek, extra},
                    };
                }

                if (
                    peekState.transition?.peek.id === id &&
                    peekState.transition.peek.extra !== extra
                ) {
                    peekState = {
                        ...peekState,
                        transition: {
                            ...peekState.transition,
                            peek: {...peekState.transition.peek, extra},
                        },
                    };
                }

                return peekState;
            });
        };
    };

    const [peekState, setPeekState] = useStateWithDependencies(
        (key): PeekSwitcherState<Extra> => {
            const peekData =
                typeof initialPeekData === "function" ? initialPeekData() : initialPeekData;

            if (!peekData) {
                return {
                    activePeek: null,
                    transition: null,
                };
            }

            const peekId = generateId<PeekId>();

            if (peekData.spacePath === null) {
                return {
                    activePeek: {
                        id: peekId,
                        content: null,
                        extra: peekData.extra,
                        setExtra: createSetPeekExtra(peekId),
                    },
                    transition: null,
                };
            }

            const spacePath = resolvePath(peekData.spacePath);
            const peekPath = convertSpacePathToPeekPath(spacePath);
            if (!peekPath) throw new InternalError("Invalid space path");

            const history = createMemoryHistory({initialEntries: [peekPath]});

            const peek: PeekSwitcherStatePeek<Extra> = {
                id: peekId,
                content: {
                    initialSpacePath: peekData.spacePath,
                    history,
                    routerPromise: PromiseImmediate.resolve(
                        createPeekRouter({
                            history,
                            hydrationData: {
                                ...peekData.hydrationData,
                                errors: deserializeErrors(peekData.hydrationData.errors ?? null),
                            },
                        }),
                    ),
                },
                extra: peekData.extra,
                setExtra: createSetPeekExtra(peekId),
            };

            return {
                activePeek: peek,
                transition: null,
            };
        },
        // Reset our state if `key` ever changes.
        [key],
    );

    const switchPeek = useEvent(
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        (peekData: {spacePath: string | null; extra: Extra} | null): Promise<void> => {
            if (!peekData) {
                setPeekState({
                    activePeek: null,
                    transition: null,
                });
                return Promise.resolve();
            }

            const peekId = generateId<PeekId>();

            if (peekData.spacePath === null) {
                setPeekState({
                    activePeek: {
                        id: peekId,
                        content: null,
                        extra: peekData.extra,
                        setExtra: createSetPeekExtra(peekId),
                    },
                    transition: null,
                });
                return Promise.resolve();
            }

            const abortController = new AbortController();

            const spacePath = resolvePath(peekData.spacePath);
            const peekPath = convertSpacePathToPeekPath(spacePath);
            if (!peekPath) throw new InternalError("Invalid space path");

            const history = createMemoryHistory({initialEntries: [peekPath]});

            const routerPromise = (async () => {
                const hydrationData = await loadInitialPeekDataForClient(
                    peekRoutes,
                    peekPath,
                    abortController.signal,
                );

                return createPeekRouter({
                    history,
                    hydrationData,
                });
            })();

            const pendingPromiseResolver = createPromiseResolver();

            const peek: PeekSwitcherStatePeek<Extra> = {
                id: peekId,
                content: {
                    initialSpacePath: peekData.spacePath,
                    history,
                    routerPromise: PromiseImmediate.resolve(routerPromise),
                },
                extra: peekData.extra,
                setExtra: createSetPeekExtra(peekId),
            };

            setPeekState({
                activePeek: peekState.activePeek,
                transition: {
                    peek,
                    pendingPromiseResolver,
                },
            });

            return pendingPromiseResolver.promise;
        },
    );

    useEffect(() => {
        const {transition} = peekState;
        if (!transition) return;

        let isCancelled = false;
        let isAccepted = false;

        const acceptTransition = () => {
            if (isCancelled) return;

            if (isAccepted) return;
            isAccepted = true;

            timeout.clear();

            transition.pendingPromiseResolver.resolve();

            setPeekState({
                activePeek: transition.peek,
                transition: null,
            });
        };

        // Accept the transition with whatever comes first:
        //
        // - Our loading indicator delay finishes
        // - Our data promise resolves
        const timeout = createTimeout(
            acceptTransition,
            delayScreenTransitionLoadingIndicatorLimitMs,
        );
        if (!transition.peek.content) {
            acceptTransition();
        } else {
            transition.peek.content.routerPromise.then(acceptTransition, acceptTransition);
        }

        return () => {
            isCancelled = true;
            timeout.clear();
            transition.pendingPromiseResolver.resolve();
        };
    }, [peekState, setPeekState]);

    return {
        selectedPeek: peekState.transition?.peek ?? peekState.activePeek,
        activePeek: peekState.activePeek,
        switchPeek,
    };
}
