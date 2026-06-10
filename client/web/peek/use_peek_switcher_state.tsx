import {deserializeErrors} from "@remix-run/react";
import {HydrationState, MemoryHistory, createMemoryHistory, resolvePath} from "@remix-run/router";
import {Key, Memo, useEffect, useRef} from "react";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStateWithDependencies} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {loadInitialPeekDataForClient} from "~/client/web/peek/load_initial_peek_data_for_client.js";
import {
    PeekRemixEmbedRouter,
    usePeekRemixEmbedRouter,
} from "~/client/web/peek/peek_remix_embed_router.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Result} from "~/shared/helpers/control/result.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";
import {generateId} from "~/shared/id/id.js";
import {PeekId} from "~/shared/id/types/id_types.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";

export type PeekSwitcherStatePeekBase<Extra> = {
    readonly id: PeekId;
    readonly initialSpacePath: string;
    readonly history: MemoryHistory;
    readonly extra: Extra;
    readonly setExtra: (extra: Extra) => void;
};

export type PeekSwitcherStatePeek<Extra> = PeekSwitcherStatePeekBase<Extra> & {
    readonly routerResult: Result<PeekRemixEmbedRouter>;
};

type PeekSwitcherState<Extra> = {
    readonly activePeek: PeekSwitcherStatePeek<Extra> | null;
    readonly transition: {
        readonly peek: PeekSwitcherStatePeekBase<Extra> & {
            readonly routerPromise: PromiseImmediate<PeekRemixEmbedRouter>;
        };
        readonly pendingPromiseResolver: PromiseResolver<void>;
    } | null;
};

/**
 * An abstraction for building interfaces where you can switch between visible
 * peeks. Implements the suspense user interface pattern where we delay showing a
 * loading indicator in the hopes that data will load before the user notices.
 *
 * - `selectedPeek`: The peek that the user has actively selected. We may have just
 *   started loading the data for this peek. Use this for rendering selection in a
 *   list to give user immediate feedback for their selection.
 *
 * - `activePeek`: The peek that we show to the user. We'll show the old peek for a
 *   little after switching while we wait for the new peek's data to load.
 *
 * - `switchPeek`: Function you call to switch the peek. Its promise will resolve
 *   when the new `selectedPeek` becomes the `activePeek` even if its data hasn't
 *   finished loading yet.
 *
 *     If `spacePath` is null then `activePeek.content` will be null. Useful if
 *     you're using this hook to control some selected state but in some selections
 *     you don't want to render a peek.
 */
export function usePeekSwitcherState<Extra>({
    key = null,
    initialPeekData,
}: {
    key?: Key | null;
    initialPeekData: MaybeThunk<{
        spacePath: string;
        hydrationData: HydrationState;
        extra: Extra;
    } | null>;
}): {
    selectedPeek: PeekSwitcherStatePeekBase<Extra> | null;
    activePeek: PeekSwitcherStatePeek<Extra> | null;
    switchPeek: Memo<(peekData: {spacePath: string; extra: Extra} | null) => Promise<void>>;
    holdPeekTransition: Memo<(promise: Promise<unknown>) => void>;
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
        (): PeekSwitcherState<Extra> => {
            const peekData =
                typeof initialPeekData === "function" ? initialPeekData() : initialPeekData;

            if (!peekData) {
                return {
                    activePeek: null,
                    transition: null,
                };
            }

            const peekId = generateId<PeekId>();

            const spacePath = resolvePath(peekData.spacePath);
            const peekPath = convertSpacePathToPeekPath(spacePath);
            if (!peekPath) throw new InternalError("Invalid space path");

            const history = createMemoryHistory({initialEntries: [peekPath]});

            const peek: PeekSwitcherStatePeek<Extra> = {
                id: peekId,
                initialSpacePath: peekData.spacePath,
                history,
                extra: peekData.extra,
                setExtra: createSetPeekExtra(peekId),
                routerResult: {
                    ok: true,
                    value: createPeekRouter({
                        history,
                        hydrationData: {
                            ...peekData.hydrationData,
                            errors: deserializeErrors(peekData.hydrationData.errors ?? null),
                        },
                    }),
                },
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
        (peekData: {spacePath: string; extra: Extra} | null): Promise<void> => {
            if (!peekData) {
                setPeekState({
                    activePeek: null,
                    transition: null,
                });
                return Promise.resolve();
            }

            const peekId = generateId<PeekId>();

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

            setPeekState({
                activePeek: peekState.activePeek,
                transition: {
                    peek: {
                        id: peekId,
                        initialSpacePath: peekData.spacePath,
                        history,
                        extra: peekData.extra,
                        setExtra: createSetPeekExtra(peekId),
                        routerPromise: PromiseImmediate.resolve(routerPromise),
                    },
                    pendingPromiseResolver,
                },
            });

            return pendingPromiseResolver.promise;
        },
    );

    const holdPeekTransitionPromisesRef = useRef<Set<Promise<void>>>(new Set());

    useEffect(() => {
        const {transition} = peekState;
        if (!transition) return;

        let isCancelled = false;
        let isAccepted = false;

        const acceptTransition = (routerResult: Result<PeekRemixEmbedRouter>) => {
            if (isCancelled) return;

            if (isAccepted) return;
            isAccepted = true;

            transition.pendingPromiseResolver.resolve();

            setPeekState({
                activePeek: {
                    ...omitObject(transition.peek, ["routerPromise"]),
                    routerResult,
                },
                transition: null,
            });
        };

        (async () => {
            const router = await transition.peek.routerPromise;

            // Don't accept the transition if we were asked to hold.
            while (holdPeekTransitionPromisesRef.current.size > 0) {
                await runAllPromises(holdPeekTransitionPromisesRef.current);
            }

            return router;
        })().then(
            router => acceptTransition({ok: true, value: router}),
            error => acceptTransition({ok: false, error}),
        );

        return () => {
            isCancelled = true;
            transition.pendingPromiseResolver.resolve();
        };
    }, [peekState, setPeekState]);

    const holdPeekTransition = useEvent((promise: Promise<unknown>) => {
        // Ignore errors from holding promise.
        const actualPromise = promise.then(
            () => {},
            () => {},
        );

        holdPeekTransitionPromisesRef.current.add(actualPromise);

        void promise.finally(() => {
            holdPeekTransitionPromisesRef.current.delete(actualPromise);
        });
    });

    return {
        selectedPeek: peekState.transition?.peek ?? peekState.activePeek,
        activePeek: peekState.activePeek,
        switchPeek,
        holdPeekTransition,
    };
}
