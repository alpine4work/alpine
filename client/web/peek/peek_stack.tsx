import {ClientRect, DndContext, Modifier, useDraggable} from "@dnd-kit/core";
import type {SyntheticListenerMap} from "@dnd-kit/core/dist/hooks/utilities/index.d.ts";
import {PressEvent} from "@react-types/shared";
import {
    Action,
    HydrationState,
    Location,
    MemoryHistory,
    createMemoryHistory,
    createPath,
    resolvePath,
} from "@remix-run/router";
import {animate, spring} from "motion";
import {ArrowLeft, ArrowRight, ArrowsOutSimple, X} from "phosphor-react";
import {
    ReactNode,
    Ref,
    RefObject,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    To,
    matchRoutes,
    useLocation,
    useNavigation,
    useNavigationType,
} from "react-router";
import {useSearchParams} from "react-router-dom";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {Box} from "~/client/web/design/box.js";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {useOutsideInteraction} from "~/client/web/design/helpers/use_outside_interaction.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {
    trackNavigationAnimationFinish,
    trackNavigationAnimationStart,
} from "~/client/web/design/schedule_after_navigation_animation.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/web/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {
    GlobalKeyDownEvent,
    GlobalKeyDownManualContextProvider,
    GlobalKeyDownManualContextProviderRef,
} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/web/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {PeekStackContextDefinition} from "~/client/web/peek/internal/peek_stack_context_definition.js";
import {loadInitialPeekDataForClient} from "~/client/web/peek/load_initial_peek_data_for_client.js";
import {PeekRemixEmbed} from "~/client/web/peek/peek_remix_embed.js";
import {
    PeekRemixEmbedRouter,
    usePeekRemixEmbedRouter,
} from "~/client/web/peek/peek_remix_embed_router.js";
import {getClientInfo, useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {
    getRemPxWithoutListening,
    getSpacingScaleWithoutListening,
} from "~/client/web/remix/spacing_scale_context.js";
import {NavigationEventContextProvider, useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {GlobalLoadingIndicatorChip} from "~/client/web/spaces/global_loading_indicator_context_provider.js";
import {GlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator_types.js";
import {
    peekControlsHeight,
    peekMaxHeight,
    peekNarrowLayoutWidth,
    peekStackOverlayBorderRadius,
} from "~/client/web/styles/peek_shared_styles.js";
import {
    pingAnimationClassName,
    spaceLayoutStyles,
    wiggleAnimation,
    wiggleAnimationDuration,
} from "~/client/web/styles/styles.js";
import {
    greyElevated1ClassName,
    greyElevated2ClassName,
} from "~/shared/design/core/constant_class_names.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {PeekId} from "~/shared/id/types/id_types.js";
import {
    convertPeekPathToSpacePath,
    convertSpacePathToPeekPath,
} from "~/shared/remix/peek_path_helpers.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const peekRightOffset = spacing["12"];
const peekBottomBuffer = spacing["8"];
const peekUnderlayOffset = spacing["2"];

const viewportPeekMarginTop = spacing["4"];
export const peekHeight = `min(100vh - ${viewportPeekMarginTop}, ${peekMaxHeight})`;
const peekHeightWithUnderlayOffset =
    `min(100vh + ${subtractRemLengths(peekBottomBuffer, viewportPeekMarginTop)}, ` +
    `${addRemLengths(peekMaxHeight, peekBottomBuffer)})`;

type PeekStackEntry = {
    readonly id: PeekId;
    readonly history: MemoryHistory;
    readonly initialRouterRef: RefObject<PeekRemixEmbedRouter | null>;
    readonly autoFocus: boolean;
};

type PeekStackState = {
    readonly stack: ReadonlyArray<PeekStackEntry>;
    readonly unmountedStartStackIndex: number;
    readonly unmountingStack: ReadonlyArray<PeekStackEntry>;
    readonly isUnmountingAll: boolean;
    readonly disableEntranceAnimationsDuringNextRender: boolean;
    readonly wasLastInteractionOutside: boolean;
};

type PeekStackAction =
    | PeekStackPushAction
    | PeekStackPopAction
    | PeekStackPopAllAction
    | PeekStackSetUnmountedStartAction
    | PeekStackFinishUnmountingAction
    | PeekStackResetAction
    | PeekStackRestoreAction
    | PeekStackReenableEntranceAnimationsAction
    | PeekStackOutsideInteractionAction
    | PeekStackInsideInteractionAction;

type PeekStackPushAction = {
    readonly type: "Push";
    readonly entry: PeekStackEntry;
};

type PeekStackPopAction = {
    readonly type: "Pop";
};

type PeekStackPopAllAction = {
    readonly type: "PopAll";
};

type PeekStackSetUnmountedStartAction = {
    readonly type: "SetUnmountedStart";
    readonly stackIndex: number;
};

type PeekStackFinishUnmountingAction = {
    readonly type: "FinishUnmounting";
    readonly unmountingStackIndex: number;
};

type PeekStackResetAction = {
    readonly type: "Reset";
};

type PeekStackRestoreAction = {
    readonly type: "Restore";
    readonly stack: ReadonlyArray<PeekStackEntry>;
};

type PeekStackReenableEntranceAnimationsAction = {
    readonly type: "ReenableEntranceAnimations";
};

type PeekStackOutsideInteractionAction = {
    readonly type: "OutsideInteraction";
};

type PeekStackInsideInteractionAction = {
    readonly type: "InsideInteraction";
};

function reducePeekStackState(state: PeekStackState, action: PeekStackAction): PeekStackState {
    switch (action.type) {
        case "Push": {
            return {
                ...state,
                stack: [action.entry, ...state.stack],
                unmountedStartStackIndex: state.unmountedStartStackIndex + 1,
                // When a new peek entry is pushed, we assume the user is interacting with the
                // peek.
                wasLastInteractionOutside: false,
            };
        }
        case "Pop": {
            if (!state.stack[0]) return state;

            return {
                ...state,
                stack: state.stack.slice(1),
                unmountedStartStackIndex: Math.min(
                    state.unmountedStartStackIndex + 1,
                    state.stack.length,
                ),
                unmountingStack: [state.stack[0], ...state.unmountingStack],
            };
        }
        case "PopAll": {
            return {
                ...state,
                isUnmountingAll: true,
            };
        }
        case "SetUnmountedStart": {
            return {
                ...state,
                unmountedStartStackIndex: action.stackIndex,
            };
        }
        case "FinishUnmounting": {
            if (state.isUnmountingAll) {
                state = {
                    ...state,
                    stack: [],
                    unmountedStartStackIndex: 0,
                    unmountingStack: [],
                    isUnmountingAll: false,
                    wasLastInteractionOutside: true,
                };
            }

            if (action.unmountingStackIndex >= 0) {
                state = {
                    ...state,
                    unmountingStack: state.unmountingStack.slice(0, action.unmountingStackIndex),
                    wasLastInteractionOutside:
                        (state.stack.length === 0 && action.unmountingStackIndex === 0) ||
                        state.wasLastInteractionOutside,
                };
            }

            return state;
        }
        case "Reset": {
            return initialPeekStackState;
        }
        case "Restore": {
            return {
                stack: action.stack,
                unmountedStartStackIndex: Math.min(3, action.stack.length),
                unmountingStack: [],
                isUnmountingAll: false,
                disableEntranceAnimationsDuringNextRender: true,
                // If we're restoring peek state after a navigation, assume the user was last
                // interacting with the content behind the peek.
                wasLastInteractionOutside: true,
            };
        }
        case "ReenableEntranceAnimations": {
            if (!state.disableEntranceAnimationsDuringNextRender) return state;
            return {...state, disableEntranceAnimationsDuringNextRender: false};
        }
        case "OutsideInteraction": {
            if (state.wasLastInteractionOutside) return state;
            return {...state, wasLastInteractionOutside: true};
        }
        case "InsideInteraction": {
            if (!state.wasLastInteractionOutside) return state;
            return {...state, wasLastInteractionOutside: false};
        }
        default:
            throw exhaustive(action);
    }
}

const initialPeekStackState: PeekStackState = {
    stack: [],
    unmountedStartStackIndex: 0,
    unmountingStack: [],
    isUnmountingAll: false,
    disableEntranceAnimationsDuringNextRender: false,
    wasLastInteractionOutside: true,
};

export type PeekStackContextProviderRef = {
    readonly push: (to: To, options?: {focus?: boolean}) => Promise<void>;
};

const PeekStackContextProviderForwardRef = forwardRef(PeekStackContextProvider);
export {PeekStackContextProviderForwardRef as PeekStackContextProvider};

function PeekStackContextProvider(
    {
        globalLoadingIndicator,
        children,
    }: {
        globalLoadingIndicator: GlobalLoadingIndicator | null;
        children?: ReactNode;
    },
    ref: Ref<PeekStackContextProviderRef>,
) {
    const dataRouterContext = useContext(DataRouterContext);
    assert(dataRouterContext, "Expected data router context");

    const reporter = useReporter();
    const platform = usePlatform();
    const stackRef = useRef<PeekStackRef>(null);
    const peekStackGlobalKeyDownManualContextRef =
        useRef<GlobalKeyDownManualContextProviderRef>(null);
    const [_state, dispatch] = useReducer(reducePeekStackState, initialPeekStackState);

    const state = platform === "mobile" ? initialPeekStackState : _state;

    // If we enter mobile mode with peeks open then immediately close all of them.
    // Peeks are not allowed in mobile.
    useEffect(() => {
        if (_state !== initialPeekStackState && platform === "mobile") {
            dispatch({type: "Reset"});
        }
    }, [_state, platform]);

    const {peekRoutes, createPeekRouter} = usePeekRemixEmbedRouter();

    const push = useEvent(async (to: To, {focus = false}: {focus?: boolean} = {}) => {
        const path = resolvePath(to, dataRouterContext.router.state.location.pathname);
        const peekPath = convertSpacePathToPeekPath(path);
        if (!peekPath) throw new InternalError("Can only open peek for a space route");

        // If the top of the peek stack is the URL we're navigating to then do nothing.
        // Wiggle the stack as a response to the user's interaction.
        if (
            state.stack[0]?.history.location.pathname === peekPath.pathname &&
            state.stack[0].history.location.search === peekPath.search
        ) {
            stackRef.current?.wiggle();
            return;
        }

        const abortController = new AbortController();

        const {loaderData, errors} = await loadInitialPeekDataForClient(
            peekRoutes,
            peekPath,
            abortController.signal,
        );

        const history = createMemoryHistory({
            initialEntries: [peekPath],
        });

        const router = createPeekRouter({
            history,
            hydrationData: {
                loaderData,
                errors,
            },
        });

        dispatch({
            type: "Push",
            entry: {
                id: generateId(),
                history,
                initialRouterRef: {current: router},
                autoFocus: focus,
            },
        });
    });

    const location = useLocation();
    const navigation = useNavigation();
    const navigationType = useNavigationType();
    const [searchParams, setSearchParams] = useSearchParams();

    // If we are navigating to a location with a peek stack we need to restore then
    // start preloading the peek stack during the transition so our data is ready when
    // we land on the page.
    const preloadRestoreStackRef = useRef<{
        location: Location;
        abortController: AbortController;
        stackPromise: Promise<ReadonlyArray<PeekStackEntry>>;
    } | null>(null);
    useEffect(() => {
        if (navigation.state !== "loading") {
            preloadRestoreStackRef.current?.abortController.abort();
            preloadRestoreStackRef.current = null;
            return;
        }

        if (preloadRestoreStackRef.current?.location.key === navigation.location.key) return;

        preloadRestoreStackRef.current?.abortController.abort();

        const result = restorePeekStack({
            locationKey: navigation.location.key,
            peekSearchParam: new URLSearchParams(navigation.location.search).get("peek"),
            peekRoutes,
            createPeekRouter,
        });

        if (result === null) {
            preloadRestoreStackRef.current = null;
            return;
        }

        preloadRestoreStackRef.current = {
            ...result,
            location: navigation.location,
        };
    }, [createPeekRouter, peekRoutes, navigation.location, navigation.state]);

    const restoreStackGenerationRef = useRef<number>(0);
    const lastLocationKeyRef = useRef<string | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastLocationKeyRef.current === location.key) return;
        const lastLocationKey = lastLocationKeyRef.current;
        lastLocationKeyRef.current = location.key;

        restoreStackGenerationRef.current += 1;
        const generation = restoreStackGenerationRef.current;

        // When the location changes, store our peek stack state for our last location. So
        // if the user navigates back to this location we can revive the peek stack.
        if (lastLocationKey !== null) {
            storePeekStack(lastLocationKey, state.stack);
        }

        let result;
        if (preloadRestoreStackRef.current?.location.key === location.key) {
            result = preloadRestoreStackRef.current;
            preloadRestoreStackRef.current = null;
        } else {
            result = restorePeekStack({
                locationKey: location.key,
                peekSearchParam: new URLSearchParams(location.search).get("peek"),
                peekRoutes,
                createPeekRouter,
            });
        }

        // If we have a `peek` search param then remove it from the URL since we've used it
        // at this point.
        if (searchParams.has("peek")) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("peek");
                    return newSearchParams;
                },
                // We don't want to revalidate when removing these search params or push new
                // entries into the history stack.
                {replace: true, unstable_shouldRevalidate: false},
            );
        }

        if (result === null) {
            // If a new location was pushed then completely reset our peek stack without
            // animating. If the user hits the back arrow we will revive the peek stack.
            if (lastLocationKey !== null && navigationType !== Action.Replace) {
                dispatch({type: "Reset"});
            }
            return;
        }

        result.stackPromise.then(
            stack => {
                // Make sure we didn't switch to a different location while waiting for the peek
                // stack promise.
                if (restoreStackGenerationRef.current !== generation) return;

                dispatch({type: "Restore", stack});
            },
            error => {
                reporter.logErrorWithoutDisplaying("Couldn\u2019t restore peek stack", error);
            },
        );
    }, [
        createPeekRouter,
        peekRoutes,
        location.key,
        navigationType,
        state,
        reporter,
        location.search,
        searchParams,
        setSearchParams,
    ]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            // Store our peek stack state when the browser tab is hidden. If the user then
            // closes their browser and reopens it we can restore their peek state.
            //
            // For why we use `visibilitychange` and not `beforeunload`, see MDN's
            // recommendation for how to send analytics at the end of a session. While we
            // aren't sending analytics this is a similar use case.
            // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon#sending_analytics_at_the_end_of_a_session
            if (document.visibilityState === "hidden") {
                storePeekStack(location.key, state.stack);
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [location.key, state]);

    useEffect(() => {
        if (state.disableEntranceAnimationsDuringNextRender)
            dispatch({type: "ReenableEntranceAnimations"});
    }, [state.disableEntranceAnimationsDuringNextRender]);

    useImperativeHandle(ref, () => ({push}), [push]);

    return (
        <PeekStackContextDefinition.Provider value={useMemo(() => ({push}), [push])}>
            <GlobalKeyDownEvent
                onGlobalKeyDownBeforeChildren={event => {
                    // If the last interaction was inside the peek, then let the peek try to handle
                    // keydown events (like undo) before any child components.
                    //
                    // So if the user was interacting with the peek and they hit undo then it will undo
                    // their changes within the peek. If they were interacting with content below and
                    // hit undo then it will undo their changes there.
                    if (!state.wasLastInteractionOutside) {
                        peekStackGlobalKeyDownManualContextRef.current?.dispatchEvent(event);
                    }
                }}
                onGlobalKeyDown={event => {
                    // If the last interaction was outside the peek then the peek will try to handle
                    // keydown events after all the main content has tried to handle the keydown event.
                    if (state.wasLastInteractionOutside) {
                        peekStackGlobalKeyDownManualContextRef.current?.dispatchEvent(event);
                    }
                }}
            >
                <NavigationEventContextProvider
                    onNavigate={useEvent((to, options) => {
                        // Always perform full page navigations on mobile.
                        if (platform === "mobile") return;

                        // Only intercept navigation events that want to push a new history entry. We will
                        // instead push a peek.
                        if (options?.replace) return;

                        const path = resolvePath(
                            to,
                            dataRouterContext.router.state.location.pathname,
                        );

                        // Don't open a peek if it's the URL we're navigating to is the same as the current
                        // URL.
                        if (
                            path.pathname === location.pathname &&
                            path.search === location.search
                        ) {
                            return;
                        }

                        // Determine whether there is a peek route for the path we are navigating to.
                        const peekPath = convertSpacePathToPeekPath(path);
                        if (!peekPath) return;
                        const peekRouteMatches = matchRoutes(peekRoutes, peekPath.pathname);
                        if (!peekRouteMatches) return;

                        const routeMatches = matchRoutes(
                            dataRouterContext.router.routes,
                            path.pathname ?? "/",
                        );

                        // NOTE(calebmer, 2026-06-05): So the URL paths have changed such that this comment
                        // doesn't make sense anymore. I'm going to leave the comment for now since I can't
                        // figure out the right way to update it or if the comment even makes sense
                        // anymore? This branch isn't hurting anyway so I'm just gonna leave it alone.
                        //
                        // So sometimes we have routes like that look like this:
                        //
                        // - `route/s/$spaceId/tasks/$taskId`
                        // - `route/s/$spaceId/tasks/view`
                        // - `route/s/$spaceId/peek/tasks/$taskId`
                        //
                        // When you navigate to `/s/$spaceId/tasks/view` it correctly picks the view route
                        // instead of the wildcard route. But when navigating to a peek
                        // `/s/$spaceId/peek/tasks/view` matches the `$taskId` wildcard peek route.
                        //
                        // We don't want the peek to open in this case and instead we want the full page
                        // route to open. So the way we detect this case is by trying to match the URL
                        // we're navigating to both by peek path and by regular path. Then we compare the
                        // `params` object of the last match since the last match will have all the
                        // accumulated wildcard values.
                        //
                        // So the main path match will be `{spaceId: '...'}` while the peek path match will
                        // be `{spaceId: '...', taskId: 'view'}`. These are not equal and it tells us we
                        // shouldn't open this route in a peek.
                        //
                        // Admittedly, this is a little hacky.
                        if (
                            !routeMatches ||
                            !isDeepEqual(
                                routeMatches[routeMatches.length - 1]?.params ?? {},
                                peekRouteMatches[peekRouteMatches.length - 1]?.params ?? {},
                            )
                        ) {
                            return;
                        }

                        // If the top of the peek stack is the URL we're navigating to then do nothing.
                        // Wiggle the stack as a response to the user's interaction.
                        if (
                            state.stack[0]?.history.location.pathname === peekPath.pathname &&
                            state.stack[0].history.location.search === peekPath.search
                        ) {
                            stackRef.current?.wiggle();
                            return {
                                preventDefault: true,
                                promise: Promise.resolve(),
                            };
                        }

                        // If there is a peek route then open a peek instead of navigating to the URL! The
                        // user can then expand the peek fullscreen if desired.
                        return {
                            preventDefault: true,
                            promise: push(to),
                        };
                    })}
                >
                    {children}
                </NavigationEventContextProvider>
                {state.stack.length > 0 || state.unmountingStack.length > 0 ? (
                    <GlobalKeyDownManualContextProvider
                        ref={peekStackGlobalKeyDownManualContextRef}
                    >
                        <PeekStack
                            ref={stackRef}
                            state={state}
                            dispatch={dispatch}
                            peekRoutes={peekRoutes}
                            createPeekRouter={createPeekRouter}
                            globalLoadingIndicator={globalLoadingIndicator}
                        />
                    </GlobalKeyDownManualContextProvider>
                ) : (
                    platform !== "mobile" &&
                    globalLoadingIndicator && (
                        <Box
                            pointerEvents="none"
                            position="absolute"
                            zIndex="10"
                            bottom="0"
                            right="0"
                            borderTopLeftRadius="1"
                            backgroundColor="grey-0"
                        >
                            <GlobalLoadingIndicatorChip indicator={globalLoadingIndicator} />
                        </Box>
                    )
                )}
            </GlobalKeyDownEvent>
        </PeekStackContextDefinition.Provider>
    );
}

type PeekStackRef = {
    wiggle(): void;
};

const PeekStack = forwardRef(function PeekStack(
    {
        state,
        dispatch,
        peekRoutes,
        createPeekRouter,
        globalLoadingIndicator,
    }: {
        state: PeekStackState;
        dispatch: (action: PeekStackAction) => void;
        peekRoutes: ReadonlyArray<DataRouteObject>;
        createPeekRouter: (options: {
            history: MemoryHistory;
            hydrationData?: HydrationState;
        }) => PeekRemixEmbedRouter;
        globalLoadingIndicator: GlobalLoadingIndicator | null;
    },
    ref: Ref<PeekStackRef>,
) {
    // Measured in percentage of our container width so when our container resizes the
    // peek moves with it.
    const [deltaXPercentage, setDeltaXPercentage] = useState(0);

    const dndModifier: Modifier = useCallback(
        ({containerNodeRect, draggingNodeRect, transform}) => {
            transform = {
                ...transform,
                // Include the container node rect in the transform so we can use
                // it `onDragEnd`.
                // @ts-expect-error
                containerNodeRect,
                // Only allow movement on the horizontal axis.
                y: 0,
            };

            const marginX = parseRemLength(peekUnderlayOffset) * 3.5 * getRemPxWithoutListening();

            // Stay within the bounds of the container and some margin.
            if (containerNodeRect && draggingNodeRect) {
                const minX = containerNodeRect.left + marginX;
                const maxX = containerNodeRect.right - marginX;

                if (draggingNodeRect.left + transform.x < minX) {
                    transform = {
                        ...transform,
                        x: minX - draggingNodeRect.left,
                    };
                }

                if (draggingNodeRect.right + transform.x > maxX) {
                    transform = {
                        ...transform,
                        x: maxX - draggingNodeRect.right,
                    };
                }
            }

            return transform;
        },
        [],
    );

    return (
        <DndContext
            modifiers={[dndModifier]}
            onDragEnd={({delta}) => {
                const containerNodeRect: ClientRect | null =
                    // @ts-expect-error: We added this property in our custom modifier
                    delta.containerNodeRect;

                assert(containerNodeRect);

                setDeltaXPercentage(
                    previousDeltaX =>
                        previousDeltaX +
                        delta.x / (containerNodeRect.right - containerNodeRect.left),
                );
            }}
        >
            <PeekStackDraggable
                parentRef={ref}
                state={state}
                dispatch={dispatch}
                peekRoutes={peekRoutes}
                createPeekRouter={createPeekRouter}
                deltaXPercentage={deltaXPercentage}
                globalLoadingIndicator={globalLoadingIndicator}
            />
        </DndContext>
    );
});

function PeekStackDraggable({
    parentRef,
    state,
    dispatch,
    peekRoutes,
    createPeekRouter,
    deltaXPercentage,
    globalLoadingIndicator,
}: {
    parentRef: Ref<PeekStackRef>;
    state: PeekStackState;
    dispatch: (action: PeekStackAction) => void;
    peekRoutes: ReadonlyArray<DataRouteObject>;
    createPeekRouter: (options: {
        history: MemoryHistory;
        hydrationData?: HydrationState;
    }) => PeekRemixEmbedRouter;
    deltaXPercentage: number;
    globalLoadingIndicator: GlobalLoadingIndicator | null;
}) {
    const {
        listeners: draggableListeners,
        setNodeRef: setDraggableNodeRef,
        transform: dragTransform,
        isDragging,
        activatorEvent: dragActivatorEvent,
    } = useDraggable({id: "peek"});

    const isPointerDragging = isDragging && dragActivatorEvent instanceof PointerEvent;

    const dragActivatorCursor = useMemo(
        () =>
            dragActivatorEvent?.target
                ? getComputedStyle(dragActivatorEvent.target as Element).cursor
                : null,
        [dragActivatorEvent],
    );

    const [shouldWiggle, setShouldWiggle] = useState(false);

    useEffect(() => {
        if (!shouldWiggle) return;

        const timeout = createTimeout(() => {
            setShouldWiggle(false);
        }, wiggleAnimationDuration);

        return () => {
            timeout.clear();
        };
    }, [shouldWiggle]);

    useImperativeHandle(
        parentRef,
        () => ({
            wiggle: () => setShouldWiggle(true),
        }),
        [],
    );

    // We manually implement double-click support instead of using the operating system
    // double click. This means we aren't using the operating system double click
    // timer! This is bad for accessibility since users with motor skill issues
    // struggle to double click fast enough.
    //
    // The reason we need to manually implement double clicking is we need to delay
    // closing the peek overlay for some amount of time to detect a double click. If we
    // waited the max operating system double click timeout ([5s on Windows][1])
    // without responding to a single click that would be ridiculous. (We also can't
    // get the double click time from JavaScript.)
    //
    // [1]:
    //     https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdoubleclicktime
    const doubleClickTimeoutRef = useRef<Timeout | null>(null);

    const onClosePress = (event: PressEvent) => {
        if (doubleClickTimeoutRef.current) {
            doubleClickTimeoutRef.current.clear();
            dispatch({type: "PopAll"});
            return;
        }

        if (event.shiftKey) {
            dispatch({type: "PopAll"});
            return;
        }

        // Double click to close all only works when using a mouse. On keyboards you may
        // use the shift keyboard modifier. For touch platforms you may swipe down.
        //
        // TODO(calebmer): Implement swipe down to close all peeks on touch devices like
        // iPads.
        if (
            event.pointerType === "mouse" &&
            state.stack.length > 1 &&
            !doubleClickTimeoutRef.current
        ) {
            doubleClickTimeoutRef.current = createTimeout(() => {
                doubleClickTimeoutRef.current = null;
                dispatch({type: "Pop"});
            }, doubleClickDelayMs);
            return;
        }

        dispatch({type: "Pop"});
    };

    return (
        <>
            <Box
                data-testid="PeekStack"
                ref={useMergedRefs<HTMLDivElement>(
                    setDraggableNodeRef,
                    useOutsideInteraction({
                        onOutsideInteraction: () => dispatch({type: "OutsideInteraction"}),
                        onInsideInteraction: () => dispatch({type: "InsideInteraction"}),
                    }),
                )}
                position="absolute"
                bottom="0"
                zIndex="20"
                style={{
                    right: `calc(${peekRightOffset} + ${-deltaXPercentage * 100}%)`,
                    width: spacing[peekNarrowLayoutWidth],
                    height: peekHeight,
                    transform: dragTransform
                        ? `translate(${dragTransform.x}px, ${dragTransform.y}px)`
                        : undefined,
                    animation: !dragTransform && shouldWiggle ? wiggleAnimation : undefined,
                }}
            >
                {[
                    ...state.stack
                        .slice(0, state.unmountedStartStackIndex)
                        .map((entry, index) => (
                            <PeekStackOverlay
                                key={entry.id}
                                state={state}
                                dispatch={dispatch}
                                peekRoutes={peekRoutes}
                                createPeekRouter={createPeekRouter}
                                entry={entry}
                                index={index}
                                isDragging={isDragging}
                                draggableListeners={draggableListeners}
                                onClosePress={onClosePress}
                            />
                        ))
                        .reverse(),
                    ...state.unmountingStack.map((entry, index) => (
                        <PeekStackOverlay
                            key={entry.id}
                            state={state}
                            dispatch={dispatch}
                            peekRoutes={peekRoutes}
                            createPeekRouter={createPeekRouter}
                            entry={entry}
                            index={-(index + 1)}
                            isDragging={isDragging}
                            draggableListeners={draggableListeners}
                            onClosePress={onClosePress}
                        />
                    )),
                ]}
            </Box>
            {isPointerDragging &&
                createPortal(
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="70"
                        cursor={dragActivatorCursor === "grab" ? "grabbing" : "default"}
                    />,
                    document.body,
                )}
            {globalLoadingIndicator && (
                <Box
                    pointerEvents="none"
                    position="absolute"
                    zIndex="10"
                    bottom="0"
                    borderTopRightRadius={deltaXPercentage < -0.25 ? undefined : "1"}
                    borderTopLeftRadius={deltaXPercentage < -0.25 ? "1" : undefined}
                    backgroundColor="grey-0"
                    style={{
                        left: deltaXPercentage < -0.25 ? undefined : spaceLayoutStyles.sideBarWidth,
                        right: deltaXPercentage < -0.25 ? "0" : undefined,
                    }}
                >
                    <GlobalLoadingIndicatorChip indicator={globalLoadingIndicator} />
                </Box>
            )}
        </>
    );
}

function PeekStackOverlay({
    state,
    dispatch,
    peekRoutes,
    createPeekRouter,
    entry,
    index,
    isDragging,
    draggableListeners,
    onClosePress,
}: {
    state: PeekStackState;
    dispatch: (action: PeekStackAction) => void;
    peekRoutes: ReadonlyArray<DataRouteObject>;
    createPeekRouter: (options: {
        history: MemoryHistory;
        hydrationData?: HydrationState;
    }) => PeekRemixEmbedRouter;
    entry: PeekStackEntry;
    index: number;
    isDragging: boolean;
    draggableListeners: SyntheticListenerMap | undefined;
    onClosePress: (event: PressEvent) => void;
}) {
    const overlayRef = useRef<HTMLDivElement>(null);
    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const overlayContentContainerRef = useRef<HTMLDivElement>(null);
    const overlayContentRef = useRef<PeekStackOverlayContentRef>(null);

    const renderPopClickOverlay = (offset: number) => (
        <Box
            position="absolute"
            borderTopRightRadius={peekStackOverlayBorderRadius}
            style={{
                height: peekHeight,
                width: peekUnderlayOffset,
                bottom: `-${parseRemLength(peekUnderlayOffset) * offset}rem`,
                right: `-${parseRemLength(peekUnderlayOffset) * offset}rem`,
            }}
            // We have no affordance that underlayed peeks are clickable so give them a pointer
            // cursor to let the user know they can click.
            cursor="pointer"
            onClick={() => dispatch({type: "Pop"})}
        />
    );

    const indexRef = useRef(index);
    useLayoutEffect(() => {
        indexRef.current = index;
    });

    // Animation 1: Spring the overlay up from below the screen.
    const [isAnimatingOpen, setIsAnimatingOpen] = useState(
        !state.disableEntranceAnimationsDuringNextRender && index === 0,
    );
    {
        const isUnmounting = index < 0 || state.isUnmountingAll;

        const isAnimatingOpenRef = useRef(false);
        useLayoutEffect(() => {
            if (!isAnimatingOpen) return;

            if (isAnimatingOpenRef.current) return;
            isAnimatingOpenRef.current = true;
            trackNavigationAnimationStart();

            const overlayElement = assertExists(overlayRef.current);
            const overlayContainerElement = assertExists(overlayContainerRef.current);

            const spacingScale = getSpacingScaleWithoutListening();
            const translateY =
                overlayElement.clientHeight -
                convertRemLengthToPx(peekBottomBuffer, spacingScale) +
                convertRemLengthToPx(peekUnderlayOffset, spacingScale);

            const animation = animate(
                overlayContainerElement,
                {
                    // Can't use `transform: translateY()` because `spring()` only animates independent
                    // transforms like `y` with a spring so it can overshoot correctly.
                    // https://motion.dev/dom/spring
                    y: [translateY, 0],
                },
                {
                    type: spring,
                    stiffness: 400,
                    damping: 35,
                },
            );

            void animation.finished.finally(() => {
                isAnimatingOpenRef.current = false;
                trackNavigationAnimationFinish();
                setIsAnimatingOpen(false);

                // If auto-focus is enabled then focus the overlay once we're done animating up.
                if (entry.autoFocus) {
                    overlayContentRef.current?.focus();
                }
            });
        }, [
            entry.autoFocus,
            index,
            isAnimatingOpen,
            state.disableEntranceAnimationsDuringNextRender,
        ]);

        const hasStartedUnmountingRef = useRef(false);
        useLayoutEffect(() => {
            if (!isUnmounting) return;
            if (hasStartedUnmountingRef.current) return;
            hasStartedUnmountingRef.current = true;

            const overlayElement = assertExists(overlayRef.current);
            const overlayContainerElement = assertExists(overlayContainerRef.current);

            // If the overlay we're unmounting contains the focused element then unfocus the
            // element while unmounting.
            if (
                document.activeElement instanceof HTMLElement &&
                overlayContainerElement.contains(document.activeElement)
            ) {
                document.activeElement.blur();
            }

            const spacingScale = getSpacingScaleWithoutListening();
            const translateY =
                overlayElement.clientHeight -
                convertRemLengthToPx(peekBottomBuffer, spacingScale) +
                convertRemLengthToPx(peekUnderlayOffset, spacingScale);

            const animation = animate(
                overlayContainerElement,
                {
                    // Can't use `transform: translateY()` because `spring()` only animates independent
                    // transforms like `y` with a spring so it can overshoot correctly.
                    // https://motion.dev/dom/spring
                    y: [0, translateY],
                },
                {
                    type: spring,
                    stiffness: 350,
                    damping: 35,
                    // These settings make sure the animation finishes after ~400-420ms
                    restSpeed: 1000,
                    restDelta: 1,
                },
            );

            void animation.finished.then(() => {
                // We use `indexRef` here so we don't capture an old index in this closure.
                dispatch({type: "FinishUnmounting", unmountingStackIndex: -indexRef.current - 1});
            });
        }, [dispatch, isUnmounting]);
    }

    // Animation 2: Shift overlays later in the stack right and down.
    {
        // On initial render, imperatively set our initial styles so we render from this
        // starting place.
        const hasInitiallyMountedRef = useRef(false);
        useLayoutEffect(() => {
            if (hasInitiallyMountedRef.current) return;
            hasInitiallyMountedRef.current = true;

            const overlayElement = assertExists(overlayRef.current);

            // Index 0 is mounted at index 0. Overlays mounted at higher indexes are being
            // remounted from the bottom of the stack.
            const initialIndex =
                !state.disableEntranceAnimationsDuringNextRender && index > 0 ? index + 1 : index;

            const {transform, opacity} = getPeekStackOverlayAnimationStyles(initialIndex);

            overlayElement.style.transform = transform;
            overlayElement.style.opacity = String(opacity);
        }, [index, state.disableEntranceAnimationsDuringNextRender]);

        const {transform, opacity} = getPeekStackOverlayAnimationStyles(index);

        // Whenever our styles change, animate to the new styles. The `animate()` function
        // is interruptible so if an animation is ongoing we will continue from that
        // position.
        useLayoutEffect(() => {
            const overlayElement = assertExists(overlayRef.current);

            const animation = animate(
                overlayElement,
                {
                    transform,
                    opacity,
                },
                {
                    duration: 0.2,
                    ease: "linear",
                },
            );

            let isCancelled = false;

            void animation.finished.then(() => {
                if (isCancelled) return;

                // Once the element has fully disappeared, let's unmount it.
                if (opacity === 0) dispatch({type: "SetUnmountedStart", stackIndex: index});
            });

            return () => {
                isCancelled = true;
            };
        }, [dispatch, index, opacity, transform]);
    }

    // Animation 3: Hide the content of a peek and eventually unmount it.
    const shouldHideContent = index !== 0;
    const [isContentHidden, setIsContentHidden] = useState(shouldHideContent);

    // Render:
    //
    // - The first peek
    // - The second peek
    // - Peeks that aren't finished with the hide animation
    //
    // We render the second peek to preload its data and keep it up-to-date so if the
    // first peek is closed we can immediately render the second.
    const isContentRendered = index === 0 || index === 1 || !isContentHidden;

    {
        const lastShouldHideContentRef = useRef(shouldHideContent);
        useLayoutEffect(() => {
            // Fade out content...
            if (shouldHideContent && !lastShouldHideContentRef.current) {
                lastShouldHideContentRef.current = true;

                // If React already isn't rendering our content then we don't need to animate.
                if (!isContentRendered) {
                    setIsContentHidden(true);
                    return;
                }

                assert(overlayContentContainerRef.current);
                const overlayContentContainerElement = overlayContentContainerRef.current;

                // If our content is already hidden then make sure opacity is 0 without animating.
                if (isContentHidden) {
                    overlayContentContainerElement.style.opacity = "0";
                    return;
                }

                const animation = animate(
                    overlayContentContainerElement,
                    {
                        opacity: 0,
                    },
                    {
                        delay: 0.5,
                        duration: 0.2,
                        ease: "linear",
                    },
                );

                let isCancelled = false;

                void animation.finished.then(() => {
                    if (isCancelled) return;
                    setIsContentHidden(true);
                });

                return () => {
                    isCancelled = true;
                };
            }

            // Fade in content...
            if (!shouldHideContent && lastShouldHideContentRef.current) {
                // If our content is not being rendered by React then we can't make progress.
                if (!isContentRendered) return;

                lastShouldHideContentRef.current = false;

                assert(overlayContentContainerRef.current);
                const overlayContentContainerElement = overlayContentContainerRef.current;

                // Start from an opacity of 0.
                overlayContentContainerElement.style.opacity = "0";

                // If our content is already shown then make sure opacity is 1 without animating.
                if (!isContentHidden) {
                    overlayContentContainerElement.style.opacity = "1";
                    return;
                }

                const animation = animate(
                    overlayContentContainerElement,
                    {
                        opacity: 1,
                    },
                    {
                        duration: 0.2,
                        ease: "linear",
                    },
                );

                let isCancelled = false;

                void animation.finished.then(() => {
                    if (isCancelled) return;
                    setIsContentHidden(false);
                });

                return () => {
                    isCancelled = true;
                };
            }
        }, [isContentHidden, isContentRendered, shouldHideContent]);
    }

    // If the content is hidden but still rendered then make double sure the opacity
    // is 0. This happens on component initial mount since our animation assumes
    // `isContentHidden` means the content isn't rendered either.
    useLayoutEffect(() => {
        if (isContentHidden && isContentRendered) {
            assert(overlayContentContainerRef.current);
            const overlayContentContainerElement = overlayContentContainerRef.current;

            overlayContentContainerElement.style.opacity = "0";
        }
    }, [isContentHidden, isContentRendered]);

    return (
        <>
            <Box
                ref={overlayContainerRef}
                position="absolute"
                right="0"
                pointerEvents={index < 0 ? "none" : undefined}
                style={{
                    bottom: `-${peekBottomBuffer}`,
                }}
            >
                <Box
                    ref={overlayRef}
                    data-testid="PeekStackOverlay"
                    overflow="hidden"
                    borderTopRadius={peekStackOverlayBorderRadius}
                    boxShadow={index === 0 ? "elevation-40" : "elevation-30"}
                    backgroundColor="grey-0"
                    className={greyElevated1ClassName}
                    style={{
                        width: spacing[peekNarrowLayoutWidth],
                        height: peekHeightWithUnderlayOffset,
                        paddingBottom: peekBottomBuffer,
                    }}
                >
                    {isContentRendered && (
                        <GlobalKeyDownEvent
                            // Don't process global `keydown` events when our peek content is hidden. Very
                            // weird if you hit cmd-z and data in a peek you can't see is updated.
                            isDisabled={isContentHidden}
                        >
                            <Box
                                ref={overlayContentContainerRef}
                                width="full"
                                height="full"
                                overflow="hidden"
                                // The [`<Offscreen>` component][1] React claims is coming may be a better fit here
                                // so we don't actually render content in the DOM. `inert` has good browser support
                                // though!
                                //
                                // [1]: https://react.dev/blog/2022/03/29/react-v18
                                // [2]: https://caniuse.com/?search=inert
                                inert={isContentHidden ? true : undefined}
                                // Make sure inert content is not in the accessibility tree.
                                aria-hidden={isContentHidden ? "true" : undefined}
                                style={{
                                    // Because of our animation code, our element should already be at opacity 0 but we
                                    // also apply `visibility: hidden` so Playwright considers the element as not
                                    // visible: https://playwright.dev/docs/actionability#visible
                                    //
                                    // To avoid conflicting with the animation, we also check that `shouldHideContent`
                                    // is true. If `shouldHideContent` is set to false then we'll begin an opacity
                                    // animation that eventually sets `isContentHidden` to false. During that time
                                    // `visibility: "hidden"` should not be set since the opacity animation controls
                                    // whether we're visible.
                                    visibility:
                                        isContentHidden && shouldHideContent ? "hidden" : undefined,
                                }}
                            >
                                <PeekStackOverlayContent
                                    ref={overlayContentRef}
                                    state={state}
                                    dispatch={dispatch}
                                    peekRoutes={peekRoutes}
                                    createPeekRouter={createPeekRouter}
                                    entry={entry}
                                    isDragging={isDragging}
                                    isHidden={isContentHidden}
                                    draggableListeners={draggableListeners}
                                    onClosePress={onClosePress}
                                />
                            </Box>
                        </GlobalKeyDownEvent>
                    )}
                </Box>
            </Box>
            {index === 0 && (
                <>
                    {state.stack.length > 1 && renderPopClickOverlay(1)}
                    {state.stack.length > 2 && renderPopClickOverlay(2)}
                </>
            )}
        </>
    );
}

function getPeekStackOverlayAnimationStyles(index: number) {
    const translateX = `${parseRemLength(peekUnderlayOffset) * Math.max(0, index)}rem`;
    const translateY = `${parseRemLength(peekUnderlayOffset) * Math.max(0, index)}rem`;
    const transform = `translate(${translateX}, ${translateY})`;
    const opacity = index < 3 ? 1 : 0;
    return {transform, opacity};
}

type PeekStackOverlayContentRef = {
    focus(): void;
};

const PeekStackOverlayContent = forwardRef(function PeekOverlayContent(
    {
        state,
        dispatch,
        peekRoutes,
        createPeekRouter,
        entry,
        isDragging,
        isHidden,
        draggableListeners,
        onClosePress,
    }: {
        state: PeekStackState;
        dispatch: (action: PeekStackAction) => void;
        peekRoutes: ReadonlyArray<DataRouteObject>;
        createPeekRouter: (options: {
            history: MemoryHistory;
            hydrationData?: HydrationState;
        }) => PeekRemixEmbedRouter;
        entry: PeekStackEntry;
        isDragging: boolean;
        isHidden: boolean;
        draggableListeners: SyntheticListenerMap | undefined;
        onClosePress: (event: PressEvent) => void;
    },
    ref: Ref<PeekStackOverlayContentRef>,
) {
    const clientInfo = useClientInfo();
    const navigate = useNavigate();
    const {currentAccountSettings, updateCurrentAccountSettings} = useSpaceContext();

    const contentRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLElement>(null);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => {
                const contentElement = assertExists(contentRef.current);
                const closeButtonElement = assertExists(closeButtonRef.current);
                const focusElement = getNextFocusableElementIfExists(closeButtonElement, {
                    withinElement: contentElement,
                });
                focusElement?.focus({preventScroll: true});
            },
        }),
        [],
    );

    const [{abortController, routerPromise}] = useState(() => {
        // If there's an initial router promise then take it. If this peek is
        // unmounted/remounted we want to completely reload its data.
        if (entry.initialRouterRef.current) {
            const router = entry.initialRouterRef.current;

            // Don't use this router again after initializing state. For some routes (e.g.
            // task detail view) there's stateful data that may only be used once.
            //
            // Task detail view retains a task subscription in the router's loader data
            // then releases the task subscription on unmount. Trying to use the task
            // subscription again will throw an error.
            //
            // eslint-disable-next-line react-compiler/react-compiler
            entry.initialRouterRef.current = null;

            return {abortController: null, routerPromise: PromiseImmediate.resolve(router)};
        }

        const abortController = new AbortController();

        const routerPromise = PromiseImmediate.resolve(
            (async () => {
                const {loaderData, errors} = await loadInitialPeekDataForClient(
                    peekRoutes,
                    entry.history.location,
                    abortController.signal,
                );

                return createPeekRouter({
                    history: entry.history,
                    hydrationData: {loaderData, errors},
                });
            })(),
        );

        return {
            abortController,
            routerPromise,
        };
    });

    const isMounted = useIsMounted();

    // Abort our `routerPromise` load if this component unmounts.
    useEffect(() => {
        return () => {
            if (!isMounted() && routerPromise.getStateWithoutListening().status === "pending") {
                abortController?.abort();
            }
        };
    }, [abortController, isMounted, routerPromise]);

    const routerResult = usePromise(routerPromise);

    const [historyPosition, setHistoryPosition] = useState(() => ({
        index: entry.history.index,
        entriesLength: entry.history.entries.length,
    }));

    useEffect(() => {
        if (routerResult.isPending) return;

        const update = () => {
            setHistoryPosition(historyPosition => {
                const newHistoryPosition = {
                    index: entry.history.index,
                    entriesLength: entry.history.entries.length,
                };
                return !isDeepEqual(historyPosition, newHistoryPosition)
                    ? newHistoryPosition
                    : historyPosition;
            });
        };

        update();

        return routerResult.value.subscribe(update);
    }, [entry.history, routerResult.isPending, routerResult.value]);

    const [isTaskAutoSaveHintVisible, setIsTaskAutoSaveHintVisible] = useState(false);

    // Turn off the auto-save hint if it's been dismissed in settings.
    if (!currentAccountSettings.taskPeekStackAutoSaveHint && isTaskAutoSaveHintVisible) {
        setIsTaskAutoSaveHintVisible(false);
    }
    // Turn off the auto-save hint if the peek is hidden (e.g. when another peek opens
    // on top of this one).
    else if (isHidden && isTaskAutoSaveHintVisible) {
        setIsTaskAutoSaveHintVisible(false);
    }

    const showTaskAutoSaveHint = useEvent(() => {
        if (!currentAccountSettings.taskPeekStackAutoSaveHint) return;
        setIsTaskAutoSaveHintVisible(true);
    });

    const stack = useMemo(() => ({showTaskAutoSaveHint}), [showTaskAutoSaveHint]);

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                switch (event.key) {
                    case "Escape": {
                        if (state.stack.length === 0) break;

                        // Once the user performs the action in the hint (closing the peek), we can hide
                        // the auto-save hint.
                        if (isTaskAutoSaveHintVisible) {
                            setIsTaskAutoSaveHintVisible(false);
                            updateCurrentAccountSettings({type: "HideTaskPeekStackAutoSaveHint"});
                        }

                        if (event.shiftKey) {
                            event.preventDefault();
                            event.stopPropagation();
                            dispatch({type: "PopAll"});
                        } else {
                            event.preventDefault();
                            event.stopPropagation();
                            dispatch({type: "Pop"});
                        }
                        break;
                    }
                    case "e": {
                        if (state.stack.length === 0) break;
                        if (!(clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)) break;

                        event.preventDefault();
                        event.stopPropagation();

                        const spacePath = convertPeekPathToSpacePath(entry.history.location, {
                            routeLayout: "wide",
                        });
                        if (!spacePath) throw new InternalError("Can only expand peek routes");

                        navigate(spacePath);
                        break;
                    }
                }
            }}
        >
            <Box
                ref={contentRef}
                width="full"
                height="full"
                overflow="hidden"
                display="flex"
                flexDirection="column"
                position="relative"
                zIndex="0"
                onKeyDown={event => {
                    // If the user presses escape while dragging that will cancel `@dnd-kit/core`'s
                    // dragging logic and shouldn't close the peek.
                    if (event.key === "Escape" && isDragging) {
                        event.stopPropagation();
                    }
                }}
                style={{
                    // When setting `--safe-area-inset-top` we need to set
                    // `--safe-area-inset-top-base` to the same value. Some code (e.g. inbox
                    // notification banner) will need the base value to override
                    // `--safe-area-inset-top`.
                    //
                    // @ts-expect-error: This sets the CSS variable but TypeScript doesn't
                    // like it.
                    "--safe-area-inset-top-base": spacing[peekControlsHeight],
                    "--safe-area-inset-top": spacing[peekControlsHeight],
                }}
            >
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    right="0"
                    // Render over overlays at `zIndex="50"`
                    zIndex="60"
                    height={peekControlsHeight}
                    flexShrink="0"
                    display="flex"
                    alignItems="center"
                >
                    <Box
                        flexShrink="0"
                        paddingX="0.5"
                        display="flex"
                        justifyContent="flex-start"
                        alignItems="center"
                    >
                        <IconButton
                            size="xs"
                            description="Go back"
                            tooltipPlacement="top"
                            isDisabled={!(historyPosition.index > 0)}
                            onPress={() => entry.history.go(-1)}
                        >
                            <ArrowLeft />
                        </IconButton>
                        <IconButton
                            size="xs"
                            description="Go forwards"
                            tooltipPlacement="top"
                            isDisabled={
                                !(historyPosition.index < historyPosition.entriesLength - 1)
                            }
                            onPress={() => entry.history.go(1)}
                        >
                            <ArrowRight />
                        </IconButton>
                    </Box>
                    <Box
                        flexGrow="1"
                        height="full"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        // As a convenience, allow dragging to start by clicking anywhere on the peek
                        // overlay header. This is not accessible the only accessible way to drag is the
                        // drag handle.
                        onPointerDown={event => {
                            if (event.target === event.currentTarget) {
                                draggableListeners?.onPointerDown?.(event);
                            }
                        }}
                    />
                    <Box
                        flexShrink="0"
                        paddingX="0.5"
                        display="flex"
                        justifyContent="flex-end"
                        alignItems="center"
                    >
                        <IconButton
                            size="xs"
                            description="Expand"
                            keyboardShortcutHint={renderKeyboardShortcutHint(
                                clientInfo,
                                "mod",
                                "e",
                            )}
                            tooltipPlacement="top"
                            pressErrorTitle="Couldn&#x2019;t expand"
                            onPress={async event => {
                                const spacePath = convertPeekPathToSpacePath(
                                    entry.history.location,
                                    {routeLayout: "wide"},
                                );
                                if (!spacePath)
                                    throw new InternalError("Can only expand peek routes");

                                if (isOpenLinkInSeparateTabPointerEvent(event, getClientInfo())) {
                                    window.open(
                                        createPath(spacePath),
                                        "_blank",
                                        // Important security measure. See: https://mathiasbynens.github.io/rel-noopener
                                        "noopener noreferrer",
                                    );
                                } else {
                                    await navigate(spacePath);
                                }
                            }}
                        >
                            <ArrowsOutSimple />
                        </IconButton>
                        <OverlayAnimated
                            isVisible={isTaskAutoSaveHintVisible}
                            disableAnimationOut
                            placement="top-end"
                            offset="3"
                            offsetAlong="0.5"
                            overlay={
                                <Box
                                    backgroundColor="grey-0"
                                    boxShadow="elevation-20"
                                    className={greyElevated2ClassName}
                                    borderRadius="1.5"
                                    paddingX="3"
                                    paddingY="2"
                                    display="flex"
                                    alignItems="center"
                                    gap="4"
                                >
                                    <Box fontSize="50">
                                        Tasks are saved automatically as you type.
                                        <br />
                                        Press esc to close when you&#x2019;re done editing.
                                    </Box>
                                </Box>
                            }
                        >
                            <Box position="relative" zIndex="0">
                                {isTaskAutoSaveHintVisible && (
                                    <Box
                                        position="absolute"
                                        zIndex="10"
                                        width="2"
                                        height="2"
                                        style={{
                                            top: 0,
                                            right: 0,
                                        }}
                                    >
                                        <Box
                                            className={pingAnimationClassName}
                                            position="absolute"
                                            inset="0"
                                            borderRadius="full"
                                            backgroundColor="theme-30-const"
                                        />
                                        <Box
                                            position="absolute"
                                            inset="0"
                                            borderRadius="full"
                                            backgroundColor="theme-40-const"
                                        />
                                    </Box>
                                )}
                                <IconButton
                                    ref={closeButtonRef}
                                    size="xs"
                                    description="Close"
                                    keyboardShortcutHint="esc"
                                    tooltipPlacement="top"
                                    tooltipContentOverride={
                                        state.stack.length > 1
                                            ? "Double-click to close all"
                                            : undefined
                                    }
                                    isHovered={isTaskAutoSaveHintVisible}
                                    onPress={event => {
                                        // Once the user performs the action in the hint (closing the peek), we can hide
                                        // the auto-save hint.
                                        if (isTaskAutoSaveHintVisible) {
                                            setIsTaskAutoSaveHintVisible(false);
                                            updateCurrentAccountSettings({
                                                type: "HideTaskPeekStackAutoSaveHint",
                                            });
                                        }

                                        onClosePress(event);
                                    }}
                                >
                                    <X />
                                </IconButton>
                            </Box>
                        </OverlayAnimated>
                    </Box>
                </Box>
                {useMemo(
                    // While dragging there may be many re-renders. Since re-rendering the peek is
                    // expensive, `useMemo()` short-circuits React updates that don't affect the peek
                    // content.
                    () =>
                        !routerResult.isPending && (
                            <ContentBlockWidthContextProvider width={peekNarrowLayoutWidth}>
                                <PeekRemixEmbed
                                    peekId={entry.id}
                                    layout="narrow"
                                    stack={stack}
                                    router={routerResult.value}
                                    onGoBackOverflow={() => dispatch({type: "Pop"})}
                                />
                            </ContentBlockWidthContextProvider>
                        ),
                    [dispatch, entry.id, routerResult.isPending, routerResult.value, stack],
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
});

const LocationSchema: Schema<Location> = Schema.object({
    pathname: Schema.string,
    search: Schema.string,
    hash: Schema.string,
    state: Schema.unknown(),
    key: Schema.string,
});

const PeekStackStorageSchema = Schema.object({
    stack: Schema.array(
        Schema.object({
            id: Schema.id<PeekId>(),
            history: Schema.object({
                index: Schema.integer,
                entries: Schema.array(LocationSchema),
            }),
        }),
    ),
});

function storePeekStack(locationKey: string, stack: ReadonlyArray<PeekStackEntry>) {
    if (stack.length === 0) {
        sessionStorage.removeItem(`cyberworlds/location/${locationKey}/peekStack`);
        return;
    }

    sessionStorage.setItem(
        `cyberworlds/location/${locationKey}/peekStack`,
        JSON.stringify(
            PeekStackStorageSchema.serialize({
                stack: stack.map(entry => ({
                    id: entry.id,
                    history: {
                        index: entry.history.index,
                        entries: entry.history.entries,
                    },
                })),
            }),
        ),
    );
}

function restorePeekStack({
    locationKey,
    peekSearchParam,
    peekRoutes,
    createPeekRouter,
}: {
    locationKey: string;
    peekSearchParam: string | null;
    peekRoutes: Array<DataRouteObject>;
    createPeekRouter: ({
        history,
        hydrationData,
    }: {
        history: MemoryHistory;
        hydrationData?: HydrationState;
    }) => PeekRemixEmbedRouter;
}): {
    abortController: AbortController;
    stackPromise: Promise<Array<PeekStackEntry>>;
} | null {
    let state: SchemaType<typeof PeekStackStorageSchema>;

    // If there was a `?peek` search param then ignore whatever is in session storage
    // and just use the `?peek` search param as the stack.
    if (peekSearchParam === null) {
        const stateString = sessionStorage.getItem(`cyberworlds/location/${locationKey}/peekStack`);
        if (stateString === null) return null;

        try {
            state = PeekStackStorageSchema.deserialize(JSON.parse(stateString));
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn(InternalError.from(error, "Could not deserialize peek stack state"));
            return null;
        }
    } else {
        let url;
        try {
            url = new URL(peekSearchParam, window.location.href);

            // Can only render peeks as URLs from our app.
            assert(url.origin === window.location.origin);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn(InternalError.from(error, "Could not parse `peek` search param"));
            return null;
        }

        let peekPath = {
            pathname: url.pathname,
            search: url.search,
            hash: url.hash,
        };

        // Add `/peek` to the pathname if it's not already there.
        peekPath = convertSpacePathToPeekPath(peekPath) ?? peekPath;

        state = {
            stack: [
                {
                    id: generateId(),
                    history: {
                        index: 0,
                        entries: [
                            {
                                ...peekPath,
                                state: null,
                                // Forked from:
                                // https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L501-L503
                                key: Math.random().toString(36).substr(2, 8),
                            },
                        ],
                    },
                },
            ],
        };
    }

    const abortController = new AbortController();

    const stackPromise = (async () => {
        const stack = state.stack.map((entry): PeekStackEntry => {
            const history = createMemoryHistory({
                initialEntries: entry.history.entries.slice(),
                initialIndex: entry.history.index,
            });

            return {
                id: entry.id,
                history,
                initialRouterRef: {current: null},
                autoFocus: false,
            };
        });

        // Start preloading the data for the first entry in the stack. So that hopefully
        // when we render, all the data is available and the user doesn't see a loading
        // spinner.
        if (stack[0]) {
            const firstEntry = stack[0];

            const {loaderData, errors} = await loadInitialPeekDataForClient(
                peekRoutes,
                firstEntry.history.location,
                abortController.signal,
            );

            const router = createPeekRouter({
                history: firstEntry.history,
                hydrationData: {loaderData, errors},
            });

            stack[0] = {
                ...firstEntry,
                initialRouterRef: {current: router},
            };
        }

        return stack;
    })();

    return {
        abortController,
        stackPromise,
    };
}
