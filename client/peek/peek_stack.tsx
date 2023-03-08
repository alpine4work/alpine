import {X} from "phosphor-react";
import {ReactNode, createContext, useContext, useEffect, useMemo, useReducer} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {Spacing, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {InternalError} from "~/shared/error/error";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Id, generateId} from "~/shared/id/id";
import {peekStackStyles} from "~/shared/styles/styles";

const peekRightOffset: Spacing = "12";
const peekBottomBuffer: Spacing = "8";

type PeekStackEntry = {
    readonly id: Id;
};

type PeekStackState = {
    readonly stack: {
        readonly head: PeekStackEntry;
        readonly tail: ReadonlyArray<PeekStackEntry>;
    };
    readonly animationState: PeekStackAnimationState | null;
};

type PeekStackAnimation = "Push" | "Pop";

type PeekStackAnimationState = {
    readonly animation: PeekStackAnimation;
    readonly startTime: Date;
    readonly pendingActions: ReadonlyArray<PeekStackPushAction | PeekStackPopAction>;
};

const durationByPeekAnimation: {[K in PeekStackAnimation]: number} = {
    Push: Math.max(
        peekStackStyles.peekPushAnimationDuration,
        peekStackStyles.peekPushUnderlayAnimationTotalDuration,
        peekStackStyles.peekPushUnderlayContentAnimationTotalDuration,
    ),
    Pop: Math.max(
        peekStackStyles.peekPopAnimationTotalDuration,
        peekStackStyles.peekPopUnderlayAnimationTotalDuration,
        peekStackStyles.peekPopUnderlayContentAnimationDuration,
    ),
};

type PeekStackAction = PeekStackAnimationFinishedAction | PeekStackPushAction | PeekStackPopAction;

type PeekStackAnimationFinishedAction = {
    readonly type: "AnimationFinished";
};

type PeekStackPushAction = {
    readonly type: "Push";
    readonly entry: PeekStackEntry;
};

type PeekStackPopAction = {
    readonly type: "Pop";
};

function reducePeekStackState(
    state: PeekStackState | null,
    action: PeekStackAction,
): PeekStackState | null {
    switch (action.type) {
        case "AnimationFinished": {
            if (!state?.animationState) return state;
            const {animationState} = state;

            // We perform the pop's change to the stack at the end of our animation.
            if (animationState.animation !== "Pop") {
                state = {
                    ...state,
                    animationState: null,
                };
            } else {
                if (!state.stack.tail[0]) {
                    state = null;
                } else {
                    state = {
                        stack: {
                            head: state.stack.tail[0],
                            tail: state.stack.tail.slice(1),
                        },
                        animationState: null,
                    };
                }
            }

            // Run our pending actions now that the animation has finished. If any action
            // starts a new animation then remaining actions will likely be put into the
            // pending list again.
            state = animationState.pendingActions.reduce(reducePeekStackState, state);

            return state;
        }
        case "Push": {
            // We can not perform this action during an animation so queue it for after our
            // animation finishes.
            if (state?.animationState) {
                return {
                    ...state,
                    animationState: {
                        ...state.animationState,
                        pendingActions: [...state.animationState.pendingActions, action],
                    },
                };
            }

            return {
                stack: {
                    head: action.entry,
                    tail: state ? [state.stack.head, ...state.stack.tail] : [],
                },
                animationState: {
                    animation: "Push",
                    startTime: new Date(),
                    pendingActions: [],
                },
            };
        }
        case "Pop": {
            if (!state) return state;

            // We can not perform this action during an animation so queue it for after our
            // animation finishes.
            if (state.animationState) {
                return {
                    ...state,
                    animationState: {
                        ...state.animationState,
                        pendingActions: [...state.animationState.pendingActions, action],
                    },
                };
            }

            return {
                // We will update our stack at the end of the animation.
                stack: state.stack,
                animationState: {
                    animation: "Pop",
                    startTime: new Date(),
                    pendingActions: [],
                },
            };
        }
        default:
            throw exhaustive(action);
    }
}

type PeekStackContext = {
    readonly push: () => void;
};

const PeekStackContext = createContext<PeekStackContext | null>(null);

export function PeekStackContextProvider({children}: {children?: ReactNode}) {
    const [state, dispatch] = useReducer(reducePeekStackState, null);

    // Clear animation state when the animation is done.
    useEffect(() => {
        if (!state) return;
        const {animationState} = state;
        if (!animationState) return;

        // In case the start time recorded in state isn't actually the time the
        // animation started because React had to render to start the animation we add
        // a grace buffer to our animation state reset timeout.
        const startTimeGraceDuration = 50;

        const duration = durationByPeekAnimation[animationState.animation];
        const remainingDuration =
            duration -
            Math.max(0, Date.now() - (animationState.startTime.getTime() + startTimeGraceDuration));

        const finish = () => {
            dispatch({type: "AnimationFinished"});
        };

        if (remainingDuration <= 0) {
            finish();
            return;
        }

        const timeout = createTimeout(finish, remainingDuration);
        return () => timeout.clear();
    }, [state]);

    return (
        <PeekStackContext.Provider
            value={useMemo(
                () => ({
                    push: () => {
                        dispatch({
                            type: "Push",
                            entry: {id: generateId()},
                        });
                    },
                }),
                [],
            )}
        >
            {children}
            {state &&
                [
                    <PeekOverlay
                        key={state.stack.head.id}
                        state={state}
                        dispatch={dispatch}
                        entry={state.stack.head}
                        index={0}
                    />,
                    ...state.stack.tail
                        .slice(
                            0,
                            state.animationState?.animation === "Push" ||
                                state.animationState?.animation === "Pop"
                                ? 3
                                : 2,
                        )
                        .map((entry, index) => {
                            index += 1;
                            assert(1 <= index && index <= 3);
                            return (
                                <PeekOverlay
                                    key={entry.id}
                                    state={state}
                                    dispatch={dispatch}
                                    entry={entry}
                                    index={index as 1 | 2 | 3}
                                />
                            );
                        }),
                    // Reverse for proper z-layering
                ].reverse()}
        </PeekStackContext.Provider>
    );
}

function PeekOverlay({
    state,
    dispatch,
    entry,
    index,
}: {
    state: PeekStackState;
    dispatch: (action: PeekStackAction) => void;
    entry: PeekStackEntry;
    index: 0 | 1 | 2 | 3;
}) {
    const shouldRenderContent =
        index === 0 ||
        (index === 1 &&
            (state.animationState?.animation === "Push" ||
                state.animationState?.animation === "Pop"));

    const renderPopClickOverlay = (offset: number) => (
        <Box
            position="absolute"
            zIndex="60"
            borderTopRightRadius="md"
            style={{
                height: peekStackStyles.peekHeight,
                width: `${peekStackStyles.peekUnderlayOffsetRem}rem`,
                bottom: `-${peekStackStyles.peekUnderlayOffsetRem * offset}rem`,
                right: `${
                    parseRemLengthNumber(spacing[peekRightOffset]) -
                    peekStackStyles.peekUnderlayOffsetRem * offset
                }rem`,
            }}
            // We have no affordance that underlayed peeks are clickable so give them a
            // pointer cursor to let the user know they can click.
            cursor="pointer"
            onClick={() => dispatch({type: "Pop"})}
        />
    );

    return (
        <>
            <Box
                key={entry.id}
                position="absolute"
                zIndex="60"
                right={peekRightOffset}
                bottom={`-${peekBottomBuffer}`}
                paddingBottom={peekBottomBuffer}
                width="128"
                overflow="hidden"
                borderTopRadius="md"
                backgroundColor="grey-0"
                borderTop={{dark: "grey-10"}}
                borderLeft={{dark: "grey-10"}}
                borderRight={{dark: "grey-10"}}
                boxShadow={index === 0 ? "elevation-40" : "elevation-30"}
                style={{
                    height: addRemLengths(peekStackStyles.peekHeight, spacing[peekBottomBuffer]),
                    transform: `translate(${peekStackStyles.peekUnderlayOffsetRem * index}rem, ${
                        peekStackStyles.peekUnderlayOffsetRem * index
                    }rem)`,
                    opacity: index < 3 ? 1 : 0,
                    animation: state.animationState
                        ? getPeekOverlayAnimation(state.animationState, index)
                        : undefined,
                }}
            >
                {shouldRenderContent && (
                    <Box
                        width="full"
                        height="full"
                        overflow="hidden"
                        style={{
                            animation:
                                index !== 0 && state.animationState?.animation === "Push"
                                    ? peekStackStyles.peekPushUnderlayContentAnimation
                                    : index !== 0 && state.animationState?.animation === "Pop"
                                    ? peekStackStyles.peekPopUnderlayContentAnimation
                                    : undefined,
                        }}
                        display="flex"
                        flexDirection="column"
                    >
                        <Box
                            flexShrink="0"
                            height="8"
                            borderBottom="grey-10"
                            display="flex"
                            alignItems="center"
                        >
                            <Box flexGrow="1" />
                            <Box flexShrink="0" paddingX="1">
                                <IconButton
                                    size="xs"
                                    description="Close"
                                    withoutTooltip={true}
                                    onPress={() => dispatch({type: "Pop"})}
                                >
                                    <X />
                                </IconButton>
                            </Box>
                        </Box>
                        <Box flexGrow="1" overflow="hidden"></Box>
                    </Box>
                )}
            </Box>
            {index === 0 && (
                <>
                    {(state.stack.tail.length >= 2 ||
                        (state.stack.tail.length === 1 &&
                            state.animationState?.animation !== "Push" &&
                            state.animationState?.animation !== "Pop")) &&
                        renderPopClickOverlay(1)}
                    {(state.stack.tail.length >= 3 ||
                        (state.stack.tail.length === 2 &&
                            state.animationState?.animation !== "Push" &&
                            state.animationState?.animation !== "Pop")) &&
                        renderPopClickOverlay(2)}
                </>
            )}
        </>
    );
}

function getPeekOverlayAnimation(animationState: PeekStackAnimationState, index: 0 | 1 | 2 | 3) {
    switch (animationState.animation) {
        case "Push": {
            switch (index) {
                case 0:
                    return peekStackStyles.peekPushAnimation;
                case 1:
                    return peekStackStyles.peekPushUnderlay0To1Animation;
                case 2:
                    return peekStackStyles.peekPushUnderlay1To2Animation;
                case 3:
                    return peekStackStyles.peekPushUnderlay2ToOutAnimation;
                default:
                    throw exhaustive(index);
            }
        }
        case "Pop": {
            switch (index) {
                case 0:
                    return peekStackStyles.peekPopAnimation;
                case 1:
                    return peekStackStyles.peekPopUnderlay1To0Animation;
                case 2:
                    return peekStackStyles.peekPopUnderlay2To1Animation;
                case 3:
                    return peekStackStyles.peekPopUnderlayOutTo2Animation;
                default:
                    throw exhaustive(index);
            }
        }
        default:
            throw exhaustive(animationState.animation);
    }
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
