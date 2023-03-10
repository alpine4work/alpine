import {ClientRect, DndContext, DraggableAttributes, Modifier, useDraggable} from "@dnd-kit/core";
import {SyntheticListenerMap} from "@dnd-kit/core/dist/hooks/utilities";
import {PressEvent} from "@react-types/shared";
import {useTransition} from "@remix-run/react";
import {RemixEntryContext} from "@remix-run/react/dist/esm/components";
import {matchClientRoutes} from "@remix-run/react/dist/esm/routeMatching";
import {ClientRoute} from "@remix-run/react/dist/esm/routes";
import {Action, Location, MemoryHistory, To, createMemoryHistory, parsePath} from "history";
import {animate, spring} from "motion";
import {ArrowsOutSimple, DotsSixVertical, SpinnerGap, X} from "phosphor-react";
import {
    ReactNode,
    Ref,
    createContext,
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
import {useLocation, useNavigationType} from "react-router";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {getNextFocusableElement} from "~/client/design/helpers/get_next_focusable_element";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {IconButton} from "~/client/design/icon_button";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {usePromise} from "~/client/helpers/use_promise";
import {loadInitialPeekData} from "~/client/peek/internal/load_initial_peek_data";
import {
    convertPeekPathToSpacePath,
    convertSpacePathToPeekPath,
} from "~/client/peek/internal/peek_path_helpers";
import {PeekRemixEmbed} from "~/client/peek/internal/peek_remix_embed";
import {NavigationEventContextProvider} from "~/client/remix/use_navigate";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {InternalError} from "~/shared/error/error";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Lazy} from "~/shared/helpers/control/lazy";
import {generateId} from "~/shared/id/id";
import {PeekId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";
import {
    colorSchemeVars,
    peekContainerClassName,
    spinAnimationClassName,
    sprinkles,
    wiggleAnimation,
    wiggleAnimationDuration,
} from "~/shared/styles/styles";

const peekWidth = spacing["128"];
const peekHeight = spacing["160"];
const peekRightOffset = spacing["12"];
const peekBottomBuffer = spacing["8"];
const peekUnderlayOffset = spacing["2"];

type PeekStackEntry = {
    readonly id: PeekId;
    readonly history: MemoryHistory;
    readonly autoFocus: boolean;
    readonly initialLoaderData: Lazy<PromiseImmediate<{[key: string]: unknown}>>;
};

type PeekStackState = {
    readonly stack: ReadonlyArray<PeekStackEntry>;
    readonly unmountedStartStackIndex: number;
    readonly unmountingStack: ReadonlyArray<PeekStackEntry>;
    readonly isUnmountingAll: boolean;
    readonly disableEntranceAnimationsDuringNextRender: boolean;
};

type PeekStackAction =
    | PeekStackPushAction
    | PeekStackPopAction
    | PeekStackPopAllAction
    | PeekStackSetUnmountedStartAction
    | PeekStackFinishUnmountingAction
    | PeekStackResetAction
    | PeekStackRestoreAction
    | PeekStackReenableEntranceAnimationsAction;

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

function reducePeekStackState(state: PeekStackState, action: PeekStackAction): PeekStackState {
    switch (action.type) {
        case "Push": {
            return {
                ...state,
                stack: [action.entry, ...state.stack],
                unmountedStartStackIndex: state.unmountedStartStackIndex + 1,
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
                };
            }

            if (action.unmountingStackIndex >= 0) {
                state = {
                    ...state,
                    unmountingStack: state.unmountingStack.slice(0, action.unmountingStackIndex),
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
            };
        }
        case "ReenableEntranceAnimations": {
            if (!state.disableEntranceAnimationsDuringNextRender) return state;
            return {...state, disableEntranceAnimationsDuringNextRender: false};
        }
        default:
            throw exhaustive(action);
    }
}

type PeekStackContext = {
    readonly push: (to: To, options?: {focus?: boolean}) => Promise<void>;
};

const PeekStackContext = createContext<PeekStackContext | null>(null);

const initialPeekStackState: PeekStackState = {
    stack: [],
    unmountedStartStackIndex: 0,
    unmountingStack: [],
    isUnmountingAll: false,
    disableEntranceAnimationsDuringNextRender: false,
};

export function PeekStackContextProvider({children}: {children?: ReactNode}) {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    const stackRef = useRef<PeekStackRef>(null);
    const [state, dispatch] = useReducer(reducePeekStackState, initialPeekStackState);

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const push = useEvent(async (to: To, {focus = false}: {focus?: boolean} = {}) => {
        const abortController = new AbortController();

        const {path, loaderData} = await loadInitialPeekData(
            remixEntryContext.clientRoutes,
            to,
            abortController.signal,
        );

        dispatch({
            type: "Push",
            entry: {
                id: generateId(),
                history: createMemoryHistory({
                    initialEntries: [path],
                }),
                autoFocus: focus,
                initialLoaderData: new Lazy(() => PromiseImmediate.resolve(loaderData)),
            },
        });
    });

    const location = useLocation();
    const transition = useTransition();
    const navigationType = useNavigationType();

    // If we are navigating to a location with a peek stack we need to restore then
    // start preloading the peek stack during the transition so our data is ready
    // when we land on the page.
    const preloadRestoreStackRef = useRef<{
        location: Location;
        abortController: AbortController;
        stack: ReadonlyArray<PeekStackEntry>;
    } | null>(null);
    useEffect(() => {
        if (transition.state !== "loading") {
            preloadRestoreStackRef.current?.abortController.abort();
            preloadRestoreStackRef.current = null;
            return;
        }

        if (preloadRestoreStackRef.current?.location.key === transition.location.key) return;

        preloadRestoreStackRef.current?.abortController.abort();

        const result = restorePeekStack(transition.location.key, remixEntryContext.clientRoutes);
        if (result === null) {
            preloadRestoreStackRef.current = null;
            return;
        }

        preloadRestoreStackRef.current = {
            ...result,
            location: transition.location,
        };
    }, [remixEntryContext.clientRoutes, transition.location, transition.state]);

    const lastLocationKeyRef = useRef<string | null>(null);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastLocationKeyRef.current === location.key) return;
        const lastLocationKey = lastLocationKeyRef.current;
        lastLocationKeyRef.current = location.key;

        // When the location changes, store our peek stack state for our last
        // location. So if the user navigates back to this location we can revive
        // the peek stack.
        if (lastLocationKey !== null) {
            storePeekStack(lastLocationKey, state);
        }

        const result =
            preloadRestoreStackRef.current?.location.key === location.key
                ? preloadRestoreStackRef.current
                : restorePeekStack(location.key, remixEntryContext.clientRoutes);

        if (result === null) {
            // If a new location was pushed then completely reset our peek stack without
            // animating. If the user hits the back arrow we will revive the peek stack.
            if (lastLocationKey !== null && navigationType !== Action.Replace) {
                dispatch({type: "Reset"});
            }
            return;
        }

        dispatch({type: "Restore", stack: result.stack});
    }, [location.key, navigationType, remixEntryContext.clientRoutes, state]);

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
                storePeekStack(location.key, state);
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

    return (
        <PeekStackContext.Provider value={useMemo(() => ({push}), [push])}>
            <NavigationEventContextProvider
                onNavigate={useEvent((to, options) => {
                    // Only intercept navigation events that want to push a new history entry. We
                    // will instead push a peek.
                    if (options?.replace) return {preventDefault: false};

                    const path = typeof to === "string" ? parsePath(to) : to;

                    // Don't open a peek if it's the URL we're navigating to is the same as the
                    // current URL.
                    if (
                        (path.pathname ?? "/") === location.pathname &&
                        (path.search ?? "") === location.search
                    ) {
                        return {preventDefault: false};
                    }

                    // Determine whether there is a peek route for the path we are navigating to.
                    const peekPath = convertSpacePathToPeekPath(path);
                    if (!peekPath) return {preventDefault: false};
                    const routeMatches = matchClientRoutes(
                        remixEntryContext.clientRoutes,
                        peekPath.pathname,
                    );
                    if (!routeMatches) return {preventDefault: false};

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

                    // If there is a peek route then open a peek instead of navigating to the URL!
                    // The user can then expand the peek fullscreen if desired.
                    return {
                        preventDefault: true,
                        promise: push(to),
                    };
                })}
            >
                {children}
            </NavigationEventContextProvider>
            {(state.stack.length > 0 || state.unmountingStack.length > 0) && (
                <PeekStack ref={stackRef} state={state} dispatch={dispatch} />
            )}
        </PeekStackContext.Provider>
    );
}

const mockPeekStackContextForTest: PeekStackContext | null =
    typeof jest !== "undefined"
        ? {
              push: () => {
                  throw new InternalError(
                      "Can not push peeks in tests unless you render your component in `<PeekStackContext>`",
                  );
              },
          }
        : null;

export function usePeekStackContext(): PeekStackContext {
    const peekStackContext = useContext(PeekStackContext);

    // Provide a mock context implementation in unit tests so components don't throw.
    if (typeof jest !== "undefined" && mockPeekStackContextForTest)
        return mockPeekStackContextForTest;

    assert(peekStackContext, "Must render in a `<PeekStackContext>` to use peeks");

    return peekStackContext;
}

type PeekStackRef = {
    wiggle(): void;
};

const PeekStack = forwardRef(function PeekStack(
    {
        state,
        dispatch,
    }: {
        state: PeekStackState;
        dispatch: (action: PeekStackAction) => void;
    },
    ref: Ref<PeekStackRef>,
) {
    // Measured in percentage of our container width so when our container resizes
    // the peek moves with it.
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

            const marginX =
                parseRemLengthNumber(peekUnderlayOffset) * 3.5 * getRemPxWithoutListening();

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
                deltaXPercentage={deltaXPercentage}
            />
        </DndContext>
    );
});

function PeekStackDraggable({
    parentRef,
    state,
    dispatch,
    deltaXPercentage,
}: {
    parentRef: Ref<PeekStackRef>;
    state: PeekStackState;
    dispatch: (action: PeekStackAction) => void;
    deltaXPercentage: number;
}) {
    const {
        attributes: draggableAttributes,
        listeners: draggableListeners,
        setNodeRef: setDraggableNodeRef,
        transform: dragTransform,
        isDragging,
        activatorEvent: dragActivatorEvent,
    } = useDraggable({id: "peek"});

    const isPointerDragging = isDragging && dragActivatorEvent instanceof PointerEvent;
    const isKeyboardDragging = isDragging && dragActivatorEvent instanceof KeyboardEvent;

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

    return (
        <>
            <Box
                ref={setDraggableNodeRef}
                position="absolute"
                bottom="0"
                zIndex="60"
                style={{
                    right: `calc(${peekRightOffset} + ${-deltaXPercentage * 100}%)`,
                    width: peekWidth,
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
                            <PeekOverlay
                                key={entry.id}
                                state={state}
                                dispatch={dispatch}
                                entry={entry}
                                index={index}
                                isDragging={isDragging}
                                isKeyboardDragging={isKeyboardDragging}
                                draggableAttributes={draggableAttributes}
                                draggableListeners={draggableListeners}
                            />
                        ))
                        .reverse(),
                    ...state.unmountingStack.map((entry, index) => (
                        <PeekOverlay
                            key={entry.id}
                            state={state}
                            dispatch={dispatch}
                            entry={entry}
                            index={-(index + 1)}
                            isDragging={isDragging}
                            isKeyboardDragging={isKeyboardDragging}
                            draggableAttributes={draggableAttributes}
                            draggableListeners={draggableListeners}
                        />
                    )),
                ]}
            </Box>
            {isPointerDragging &&
                createPortal(
                    <Box position="absolute" inset="0" zIndex="70" cursor="grabbing" />,
                    document.body,
                )}
        </>
    );
}

function PeekOverlay({
    state,
    dispatch,
    entry,
    index,
    isDragging,
    isKeyboardDragging,
    draggableAttributes,
    draggableListeners,
}: {
    state: PeekStackState;
    dispatch: (action: PeekStackAction) => void;
    entry: PeekStackEntry;
    index: number;
    isDragging: boolean;
    isKeyboardDragging: boolean;
    draggableAttributes: DraggableAttributes;
    draggableListeners: SyntheticListenerMap | undefined;
}) {
    const isMounted = useIsMounted();
    const overlayRef = useRef<HTMLDivElement>(null);
    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const overlayContentContainerRef = useRef<HTMLDivElement>(null);
    const overlayContentRef = useRef<PeekOverlayContentRef>(null);

    const renderPopClickOverlay = (offset: number) => (
        <Box
            position="absolute"
            borderTopRightRadius="md"
            style={{
                height: peekHeight,
                width: peekUnderlayOffset,
                bottom: `-${parseRemLengthNumber(peekUnderlayOffset) * offset}rem`,
                right: `-${parseRemLengthNumber(peekUnderlayOffset) * offset}rem`,
            }}
            // We have no affordance that underlayed peeks are clickable so give them a
            // pointer cursor to let the user know they can click.
            cursor="pointer"
            onClick={() => dispatch({type: "Pop"})}
        />
    );

    const indexRef = useRef(index);
    useLayoutEffect(() => {
        indexRef.current = index;
    });

    // Animation 1: Spring the overlay up from below the screen.
    {
        const translateY = addRemLengths(peekHeight, peekUnderlayOffset);

        const isUnmounting = index < 0 || state.isUnmountingAll;

        const hasInitiallyRenderedRef = useRef(false);
        useLayoutEffect(() => {
            if (hasInitiallyRenderedRef.current) return;
            hasInitiallyRenderedRef.current = true;

            if (state.disableEntranceAnimationsDuringNextRender) return;

            // Only pull up our first peek.
            if (index > 0) return;

            const overlayContainerElement = assertExists(overlayContainerRef.current);

            overlayContainerElement.style.transform = `translateY(${translateY})`;

            animate(
                overlayContainerElement,
                {
                    transform: "translateY(0)",
                },
                {
                    easing: spring({
                        stiffness: 250,
                        damping: 28,
                    }),
                },
            );

            // If auto-focus is enabled then it should happen at the same time as we
            // animate up.
            if (entry.autoFocus) {
                const overlayContent = assertExists(overlayContentRef.current);
                overlayContent.focus();
            }
        }, [entry.autoFocus, index, state.disableEntranceAnimationsDuringNextRender, translateY]);

        const hasStartedUnmountingRef = useRef(false);
        useLayoutEffect(() => {
            if (!isUnmounting) return;
            if (hasStartedUnmountingRef.current) return;
            hasStartedUnmountingRef.current = true;

            const overlayContainerElement = assertExists(overlayContainerRef.current);

            // If the overlay we're unmounting contains the focused element then unfocus
            // the element while unmounting.
            if (
                document.activeElement instanceof HTMLElement &&
                overlayContainerElement.contains(document.activeElement)
            ) {
                document.activeElement.blur();
            }

            const animation = animate(
                overlayContainerElement,
                {
                    transform: `translateY(${translateY})`,
                },
                {
                    easing: spring({
                        stiffness: 320,
                        damping: 28,
                    }),
                },
            );

            void animation.finished.then(() => {
                if (!isMounted()) return;

                // We use `indexRef` here so we don't capture an old index in this closure.
                dispatch({type: "FinishUnmounting", unmountingStackIndex: -indexRef.current - 1});
            });
        }, [dispatch, isMounted, isUnmounting, translateY]);
    }

    // Animation 2: Shift overlays later in the stack right and down.
    {
        // On initial render, imperatively set our initial styles so we render from
        // this starting place.
        const hasInitiallyRenderedRef = useRef(false);
        useLayoutEffect(() => {
            if (hasInitiallyRenderedRef.current) return;
            hasInitiallyRenderedRef.current = true;

            const overlayElement = assertExists(overlayRef.current);

            // Index 0 is mounted at index 0. Overlays mounted at higher indexes are being
            // remounted from the bottom of the stack.
            const initialIndex =
                !state.disableEntranceAnimationsDuringNextRender && index > 0 ? index + 1 : index;

            const {transform, opacity} = getPeekOverlayAnimationStyles(initialIndex);

            overlayElement.style.transform = transform;
            overlayElement.style.opacity = opacity;
        }, [index, state.disableEntranceAnimationsDuringNextRender]);

        const {transform, opacity} = getPeekOverlayAnimationStyles(index);

        // Whenever our styles change, animate to the new styles. The `animate()`
        // function is interruptible so if an animation is ongoing we will continue
        // from that position.
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
                    easing: "linear",
                },
            );

            let isCancelled = false;

            void animation.finished.then(() => {
                if (isCancelled) return;

                // Once the element has fully disappeared, let's unmount it.
                if (opacity === "0") dispatch({type: "SetUnmountedStart", stackIndex: index});
            });

            return () => {
                isCancelled = true;
            };
        }, [dispatch, index, opacity, transform]);
    }

    // Animation 3: Hide the content of a peek and eventually unmount it.
    const shouldRenderContent = index <= 0;
    const [isRenderingContent, setIsRenderingContent] = useState(shouldRenderContent);
    {
        const lastShouldRenderContentRef = useRef(shouldRenderContent);
        useLayoutEffect(() => {
            // Fade out content...
            if (!shouldRenderContent && lastShouldRenderContentRef.current) {
                // If React already isn't rendering our content then we're good.
                if (!isRenderingContent) return;
                assert(overlayContentContainerRef.current);
                const overlayContentContainerElement = overlayContentContainerRef.current;

                lastShouldRenderContentRef.current = false;

                const animation = animate(
                    overlayContentContainerElement,
                    {
                        opacity: "0",
                    },
                    {
                        delay: 0.5,
                        duration: 0.2,
                        easing: "linear",
                    },
                );

                let isCancelled = false;

                void animation.finished.then(() => {
                    if (isCancelled) return;
                    setIsRenderingContent(false);
                });

                return () => {
                    isCancelled = true;
                };
            }

            // Fade in content...
            if (shouldRenderContent && !lastShouldRenderContentRef.current) {
                // If our content is not being rendered by React then we can't fade it in.
                if (!isRenderingContent) {
                    setIsRenderingContent(true);
                    return;
                }
                assert(overlayContentContainerRef.current);
                const overlayContentContainerElement = overlayContentContainerRef.current;

                lastShouldRenderContentRef.current = true;

                // Start from an opacity of 0.
                overlayContentContainerElement.style.opacity = "0";

                animate(
                    overlayContentContainerElement,
                    {
                        opacity: "1",
                    },
                    {
                        duration: 0.1,
                        easing: "linear",
                    },
                );
                return;
            }
        }, [isRenderingContent, shouldRenderContent]);
    }

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
                className={peekContainerClassName}
            >
                <Box
                    ref={overlayRef}
                    overflow="hidden"
                    borderTopRadius="md"
                    backgroundColor="grey-0"
                    borderTop={{dark: "grey-10"}}
                    borderLeft={{dark: "grey-10"}}
                    borderRight={{dark: "grey-10"}}
                    boxShadow={index === 0 ? "elevation-40" : "elevation-30"}
                    style={{
                        width: peekWidth,
                        height: addRemLengths(peekHeight, peekBottomBuffer),
                        paddingBottom: peekBottomBuffer,
                    }}
                >
                    {isRenderingContent && (
                        <Box
                            ref={overlayContentContainerRef}
                            width="full"
                            height="full"
                            overflow="hidden"
                        >
                            <PeekOverlayContent
                                ref={overlayContentRef}
                                state={state}
                                dispatch={dispatch}
                                entry={entry}
                                index={index}
                                isDragging={isDragging}
                                isKeyboardDragging={isKeyboardDragging}
                                draggableAttributes={draggableAttributes}
                                draggableListeners={draggableListeners}
                            />
                        </Box>
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

function getPeekOverlayAnimationStyles(index: number) {
    const translateX = `${parseRemLengthNumber(peekUnderlayOffset) * Math.max(0, index)}rem`;
    const translateY = `${parseRemLengthNumber(peekUnderlayOffset) * Math.max(0, index)}rem`;
    const transform = `translate(${translateX}, ${translateY})`;
    const opacity = index < 3 ? "1" : "0";
    return {transform, opacity};
}

export type PeekContext = {readonly id: PeekId};

const PeekContext = createContext<PeekContext | null>(null);

/**
 * Get the context of the peek we are rendering in if we are rendering in
 * a peek. If we are not rendering in a peek then this will return null.
 */
export function usePeekContext(): PeekContext | null {
    return useContext(PeekContext);
}

type PeekOverlayContentRef = {
    focus(): void;
};

const PeekOverlayContent = forwardRef(function PeekOverlayContent(
    {
        state,
        dispatch,
        entry,
        index,
        isDragging,
        isKeyboardDragging,
        draggableAttributes,
        draggableListeners,
    }: {
        state: PeekStackState;
        dispatch: (action: PeekStackAction) => void;
        entry: PeekStackEntry;
        index: number;
        isDragging: boolean;
        isKeyboardDragging: boolean;
        draggableAttributes: DraggableAttributes;
        draggableListeners: SyntheticListenerMap | undefined;
    },
    ref: Ref<PeekOverlayContentRef>,
) {
    const contentRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onExpandRef = useRef<(() => Promise<void>) | null>(null);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => {
                const contentElement = assertExists(contentRef.current);
                const closeButtonElement = assertExists(closeButtonRef.current);
                const focusElement = getNextFocusableElement(closeButtonElement, {
                    withinElement: contentElement,
                });
                focusElement?.focus({preventScroll: true});
            },
        }),
        [],
    );

    const [doubleClickTimeout, setDoubleClickTimeout] = useState<Timeout | null>(null);

    // We manually implement double-click support instead of using the operating
    // system double click. This means we aren't using the operating system double
    // click timer! This is bad for accessibility since users with motor skill
    // issues struggle to double click fast enough.
    //
    // The reason we need to manually implement double clicking is we need to delay
    // closing the peek overlay for some amount of time to detect a double click.
    // If we waited the max operating system double click timeout ([5s on
    // Windows][1]) without responding to a single click that would be ridiculous.
    // (We also can't get the double click time from JavaScript.)
    //
    // So we pick a reasonable delay that balances wanting to immediately respond
    // to users in the single click case and allowing users who can to double click
    // as a convenience. Users who can not double click in our chosen delay may use
    // the shift keyboard shortcut. The [default double click time on Windows is
    // 500ms][2]. We pick a delay of [300ms which is the delay mobile browsers
    // used][3] to apply to all taps to try and detect a double tap or pinch zoom.
    // That makes 300ms an industry standard delay for detecting double taps/clicks.
    // Though to be fair the mobile delay was for taps and our delay is for clicks.
    //
    // [1]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdoubleclicktime
    // [2]: https://en.wikipedia.org/wiki/Double-click
    // [3]: https://developer.chrome.com/blog/300ms-tap-delay-gone-away/
    const doubleClickDelay = 300;

    const handlePressClose = (event: PressEvent) => {
        if (doubleClickTimeout) {
            doubleClickTimeout.clear();
            dispatch({type: "PopAll"});
            return;
        }

        if (event.shiftKey) {
            dispatch({type: "PopAll"});
            return;
        }

        // Double click to close all only works when using a mouse. On keyboards you
        // may use the shift keyboard modifier. For touch platforms you may swipe down.
        //
        // TODO(calebmer): Implement swipe down to close all peeks on touch devices
        // like iPads.
        if (event.pointerType === "mouse" && state.stack.length > 1 && !doubleClickTimeout) {
            setDoubleClickTimeout(
                createTimeout(() => {
                    dispatch({type: "Pop"});
                }, doubleClickDelay),
            );
            return;
        }

        dispatch({type: "Pop"});
    };

    const initialLoaderDataResult = usePromise(entry.initialLoaderData.get());

    // Once we've finished loading the data the peek whose content we're rendering,
    // start loading the data for the next peek in the stack so that it's ready
    // when we close our current peek.
    useEffect(() => {
        if (!initialLoaderDataResult.isPending) {
            void state.stack[index + 1]?.initialLoaderData.get();
        }
    }, [index, initialLoaderDataResult.isPending, state.stack]);

    return (
        <PeekContext.Provider value={useMemo(() => ({id: entry.id}), [entry.id])}>
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
                    if (event.key === "Escape" && !isDragging) {
                        if (event.shiftKey) {
                            event.preventDefault();
                            dispatch({type: "PopAll"});
                            return;
                        }

                        event.preventDefault();
                        dispatch({type: "Pop"});
                        return;
                    }
                }}
            >
                <Box
                    flexShrink="0"
                    height="8"
                    borderBottom="grey-10"
                    display="flex"
                    alignItems="center"
                >
                    <Box flexGrow="1" />
                    <Box flexShrink="0" paddingX="1.5" display="flex" gap="1">
                        <FocusRing>
                            <button
                                className={sprinkles({
                                    width: "4",
                                    height: "4",
                                    padding: "0.5",
                                    borderRadius: "full",
                                    cursor: "grab",
                                    backgroundColor: isKeyboardDragging ? "grey-10" : undefined,
                                })}
                                {...draggableAttributes}
                                {...draggableListeners}
                            >
                                <DotsSixVertical size={spacing["3"]} />
                            </button>
                        </FocusRing>
                        <IconButton
                            size="xs"
                            description="Expand"
                            tooltipPlacement="top"
                            pressErrorTitle="Couldn’t expand"
                            onPress={async () => {
                                await onExpandRef.current?.();
                            }}
                        >
                            <ArrowsOutSimple />
                        </IconButton>
                        <IconButton
                            ref={closeButtonRef}
                            size="xs"
                            description="Close"
                            tooltipPlacement="top"
                            tooltipContentOverride="Double-click to close all"
                            onPress={handlePressClose}
                        >
                            <X />
                        </IconButton>
                    </Box>
                </Box>
                {!initialLoaderDataResult.isPending ? (
                    <PeekRemixEmbed
                        initialLoaderData={initialLoaderDataResult.value}
                        history={entry.history}
                        onExpandRef={onExpandRef}
                    />
                ) : (
                    <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                        <SpinnerGap
                            className={spinAnimationClassName}
                            color={colorSchemeVars["grey-70"]}
                            size={spacing["6"]}
                        />
                    </Box>
                )}
            </Box>
        </PeekContext.Provider>
    );
});

const LocationSchema: Schema<Location> = Schema.object({
    pathname: Schema.string,
    search: Schema.string,
    hash: Schema.string,
    state: Schema.unknown as Schema<unknown>,
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

function storePeekStack(locationKey: string, state: PeekStackState) {
    if (state.stack.length === 0) {
        sessionStorage.removeItem(`location/${locationKey}/peekStack`);
        return;
    }

    sessionStorage.setItem(
        `location/${locationKey}/peekStack`,
        JSON.stringify(
            PeekStackStorageSchema.serialize({
                stack: state.stack.map(entry => ({
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

function restorePeekStack(
    locationKey: string,
    routes: Array<ClientRoute>,
): {
    abortController: AbortController;
    stack: Array<PeekStackEntry>;
} | null {
    const stateString = sessionStorage.getItem(`location/${locationKey}/peekStack`);
    if (stateString === null) return null;

    let state;
    try {
        state = PeekStackStorageSchema.deserialize(JSON.parse(stateString));
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(InternalError.from(error, "Could not deserialize peek stack state"));
        return null;
    }

    const abortController = new AbortController();

    const stack = state.stack.map((entry): PeekStackEntry => {
        const history = createMemoryHistory({
            initialEntries: entry.history.entries.slice(),
            initialIndex: entry.history.index,
        });

        return {
            id: entry.id,
            history,
            autoFocus: false,
            initialLoaderData: new Lazy(() =>
                PromiseImmediate.resolve(
                    (async () => {
                        const spacePath = convertPeekPathToSpacePath(history.location);
                        if (!spacePath)
                            throw new InternalError(
                                "Expected restored peek stack to only have peek routes",
                            );

                        const {loaderData} = await loadInitialPeekData(
                            routes,
                            spacePath,
                            abortController.signal,
                        );

                        return loaderData;
                    })(),
                ),
            ),
        };
    });

    // Start preloading the data for the first entry in the stack. So that
    // hopefully when we render, all the data is available and the user doesn't see
    // a loading spinner.
    void stack[0]?.initialLoaderData.get();

    return {
        abortController,
        stack,
    };
}
