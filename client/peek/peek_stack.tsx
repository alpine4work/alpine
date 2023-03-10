import {ClientRect, DndContext, DraggableAttributes, Modifier, useDraggable} from "@dnd-kit/core";
import {SyntheticListenerMap} from "@dnd-kit/core/dist/hooks/utilities";
import {PressEvent} from "@react-types/shared";
import {RemixEntryContext} from "@remix-run/react/dist/esm/components";
import {Path, To} from "history";
import {animate, spring} from "motion";
import {ArrowsOutSimple, DotsSixVertical, X} from "phosphor-react";
import {
    ReactNode,
    Ref,
    createContext,
    forwardRef,
    useCallback,
    useContext,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {getNextFocusableElement} from "~/client/design/helpers/get_next_focusable_element";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {IconButton} from "~/client/design/icon_button";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted";
import {loadInitialPeekData} from "~/client/peek/internal/load_initial_peek_data";
import {PeekRemixEmbed} from "~/client/peek/internal/peek_remix_embed";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {InternalError} from "~/shared/error/error";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {generateId} from "~/shared/id/id";
import {PeekId} from "~/shared/id/types/id_types";
import {peekContainerClassName, sprinkles} from "~/shared/styles/styles";

const peekWidth = spacing["128"];
const peekHeight = spacing["160"];
const peekRightOffset = spacing["12"];
const peekBottomBuffer = spacing["8"];
const peekUnderlayOffset = spacing["2"];

type PeekStackEntry = {
    readonly id: PeekId;
    readonly initialPath: Path;
    readonly initialLoaderData: {[key: string]: unknown};
    readonly autoFocus: boolean;
};

type PeekStackState = {
    readonly stack: ReadonlyArray<PeekStackEntry>;
    readonly unmountedStartStackIndex: number;
    readonly unmountingStack: ReadonlyArray<PeekStackEntry>;
    readonly isUnmountingAll: boolean;
};

type PeekStackAction =
    | PeekStackPushAction
    | PeekStackPopAction
    | PeekStackPopAllAction
    | PeekStackSetUnmountedStart
    | PeekStackFinishUnmounting;

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

type PeekStackSetUnmountedStart = {
    readonly type: "SetUnmountedStart";
    readonly stackIndex: number;
};

type PeekStackFinishUnmounting = {
    readonly type: "FinishUnmounting";
    readonly unmountingStackIndex: number;
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
};

export function PeekStackContextProvider({children}: {children?: ReactNode}) {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

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
                initialPath: path,
                initialLoaderData: loaderData,
                autoFocus: focus,
            },
        });
    });

    return (
        <PeekStackContext.Provider value={useMemo(() => ({push}), [push])}>
            {children}
            {(state.stack.length > 0 || state.unmountingStack.length > 0) && (
                <PeekStack state={state} dispatch={dispatch} />
            )}
        </PeekStackContext.Provider>
    );
}

function PeekStack({
    state,
    dispatch,
}: {
    state: PeekStackState;
    dispatch: (action: PeekStackAction) => void;
}) {
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
                state={state}
                dispatch={dispatch}
                deltaXPercentage={deltaXPercentage}
            />
        </DndContext>
    );
}

function PeekStackDraggable({
    state,
    dispatch,
    deltaXPercentage,
}: {
    state: PeekStackState;
    dispatch: (action: PeekStackAction) => void;
    deltaXPercentage: number;
}) {
    const {attributes, listeners, setNodeRef, transform, isDragging, activatorEvent} = useDraggable(
        {id: "peek"},
    );

    const isPointerDragging = isDragging && activatorEvent instanceof PointerEvent;
    const isKeyboardDragging = isDragging && activatorEvent instanceof KeyboardEvent;

    return (
        <>
            <Box
                ref={setNodeRef}
                position="absolute"
                bottom="0"
                zIndex="60"
                style={{
                    right: `calc(${peekRightOffset} + ${-deltaXPercentage * 100}%)`,
                    width: peekWidth,
                    height: peekHeight,
                    transform: `translate(${transform?.x ?? 0}px, ${transform?.y ?? 0}px)`,
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
                                draggableAttributes={attributes}
                                draggableListeners={listeners}
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
                            draggableAttributes={attributes}
                            draggableListeners={listeners}
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
        }, [entry.autoFocus, index, translateY]);

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
            const initialIndex = index > 0 ? index + 1 : index;

            const {transform, opacity} = getPeekOverlayAnimationStyles(initialIndex);

            overlayElement.style.transform = transform;
            overlayElement.style.opacity = opacity;
        }, [index]);

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
        isDragging,
        isKeyboardDragging,
        draggableAttributes,
        draggableListeners,
    }: {
        state: PeekStackState;
        dispatch: (action: PeekStackAction) => void;
        entry: PeekStackEntry;
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
                <PeekRemixEmbed
                    initialPath={entry.initialPath}
                    initialLoaderData={entry.initialLoaderData}
                    onExpandRef={onExpandRef}
                />
            </Box>
        </PeekContext.Provider>
    );
});

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
