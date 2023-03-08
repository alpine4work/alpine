import {ReactNode, createContext, useContext, useEffect, useMemo, useReducer} from "react";
import {Box} from "~/client/design/box";
import {Spacing, addRemLengths, spacing} from "~/shared/design/spacing";
import {InternalError} from "~/shared/error/error";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Id, generateId} from "~/shared/id/id";
import {peekStackStyles} from "~/shared/styles/styles";

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

    return (
        <Box
            key={entry.id}
            position="absolute"
            zIndex="60"
            right="12"
            bottom={`-${peekBottomBuffer}`}
            paddingBottom={peekBottomBuffer}
            width="128"
            overflow="hidden"
            borderTopRadius="md"
            backgroundColor="grey-0"
            borderTop={{light: "grey-0", dark: "grey-10"}}
            borderLeft={{light: "grey-0", dark: "grey-10"}}
            borderRight={{light: "grey-0", dark: "grey-10"}}
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
            // We have no affordance that underlayed peeks are clickable so give them a
            // pointer cursor to let the user know they can click.
            //
            // TODO(calebmer): I should probably render an element on top of the peeks for
            // this behavior so when popping the main element will be interactive.
            cursor={index !== 0 ? "pointer" : undefined}
            onClick={() => {
                if (index === 0) return;
                dispatch({type: "Pop"});
            }}
        >
            {shouldRenderContent && (
                <Box
                    width="full"
                    height="full"
                    overflow="hidden"
                    // Clicking on a peek that's not the first peek will schedule a pop.
                    pointerEvents={index !== 0 ? "none" : undefined}
                    style={{
                        animation:
                            index !== 0 && state.animationState?.animation === "Push"
                                ? peekStackStyles.peekPushUnderlayContentAnimation
                                : index !== 0 && state.animationState?.animation === "Pop"
                                ? peekStackStyles.peekPopUnderlayContentAnimation
                                : undefined,
                    }}
                >
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec in ante vel
                    lectus semper vehicula ac faucibus nunc. Duis nisi mi, consectetur vel finibus
                    nec, euismod nec ex. Cras lectus turpis, lobortis vitae ante eget, ornare
                    sollicitudin velit. Fusce fringilla dignissim ullamcorper. Nunc feugiat turpis
                    nec dolor posuere pulvinar. Vestibulum eget felis quis nunc viverra ullamcorper
                    ut non justo. Praesent accumsan felis ligula, nec tincidunt nibh facilisis sit
                    amet. Praesent vitae arcu ligula. Sed maximus convallis porttitor. Quisque mi
                    ligula, euismod nec sapien non, faucibus ullamcorper mauris. Praesent dapibus
                    tempor dui, id volutpat ipsum. Maecenas maximus risus nec accumsan volutpat.
                    Quisque mollis ex porta lorem ultrices, tempor vestibulum ipsum luctus. Etiam
                    rhoncus, dui ut finibus aliquet, augue nisi pellentesque dui, at blandit nisl
                    nibh eget leo. Praesent vel sem in nisl lobortis aliquet. Proin tincidunt
                    dapibus laoreet. Nam mollis commodo nibh, non mollis sapien dignissim facilisis.
                    Morbi ullamcorper velit ac nunc hendrerit maximus. Aenean nec elit nisi. Aliquam
                    id felis ac diam molestie rutrum. Nulla a sapien leo. Nullam congue sed velit at
                    dictum. Cras interdum augue non nisi lacinia, vel hendrerit urna elementum.
                    Morbi vel ex dapibus, condimentum diam quis, bibendum massa. Sed in ipsum
                    bibendum, commodo nunc sit amet, aliquam sem. Morbi dapibus consequat erat, non
                    blandit quam aliquam eget. Pellentesque habitant morbi tristique senectus et
                    netus et malesuada fames ac turpis egestas. Aliquam lacinia ipsum ligula, tempus
                    ornare lorem aliquet id. Aliquam erat volutpat. Curabitur ut tempor sem, vitae
                    rhoncus ex. Donec faucibus laoreet lectus. Nunc convallis, eros vitae efficitur
                    finibus, orci purus molestie erat, et euismod nunc nulla quis risus. Nulla vitae
                    efficitur tellus, bibendum tempus dolor. Sed vehicula tellus quis ex
                    ullamcorper, id tempus elit ornare. Ut ut mattis mi. Nullam eu neque ultrices,
                    iaculis augue eget, scelerisque lectus. Donec eget convallis ex. Maecenas
                    bibendum orci a urna tincidunt placerat eu nec tellus. Donec vitae tempus nibh.
                    In laoreet euismod justo, ut vulputate leo mollis nec. Cras vehicula sem ac ex
                    rutrum venenatis. Nunc eu nunc bibendum, ullamcorper nisl ac, vestibulum risus.
                    Phasellus a justo sem. Morbi ut dui et sapien faucibus tempor. Morbi vehicula,
                    diam sed aliquet tincidunt, enim odio ultricies est, lacinia porta erat tortor
                    vitae sapien. Pellentesque iaculis massa augue, vel interdum nulla porta et.
                    Vivamus feugiat magna eu posuere tempus. Maecenas non molestie nunc. Ut lacinia
                    odio nec fringilla molestie. Duis arcu lorem, dictum et sapien gravida,
                    porttitor ullamcorper sem. Lorem ipsum dolor sit amet, consectetur adipiscing
                    elit. Donec in ante vel lectus semper vehicula ac faucibus nunc. Duis nisi mi,
                    consectetur vel finibus nec, euismod nec ex. Cras lectus turpis, lobortis vitae
                    ante eget, ornare sollicitudin velit. Fusce fringilla dignissim ullamcorper.
                    Nunc feugiat turpis nec dolor posuere pulvinar. Vestibulum eget felis quis nunc
                    viverra ullamcorper ut non justo. Praesent accumsan felis ligula, nec tincidunt
                    nibh facilisis sit amet. Praesent vitae arcu ligula. Sed maximus convallis
                    porttitor. Quisque mi ligula, euismod nec sapien non, faucibus ullamcorper
                    mauris. Praesent dapibus tempor dui, id volutpat ipsum. Maecenas maximus risus
                    nec accumsan volutpat. Quisque mollis ex porta lorem ultrices, tempor vestibulum
                    ipsum luctus. Etiam rhoncus, dui ut finibus aliquet, augue nisi pellentesque
                    dui, at blandit nisl nibh eget leo. Praesent vel sem in nisl lobortis aliquet.
                    Proin tincidunt dapibus laoreet. Nam mollis commodo nibh, non mollis sapien
                    dignissim facilisis. Morbi ullamcorper velit ac nunc hendrerit maximus. Aenean
                    nec elit nisi. Aliquam id felis ac diam molestie rutrum. Nulla a sapien leo.
                    Nullam congue sed velit at dictum. Cras interdum augue non nisi lacinia, vel
                    hendrerit urna elementum. Morbi vel ex dapibus, condimentum diam quis, bibendum
                    massa. Sed in ipsum bibendum, commodo nunc sit amet, aliquam sem. Morbi dapibus
                    consequat erat, non blandit quam aliquam eget. Pellentesque habitant morbi
                    tristique senectus et netus et malesuada fames ac turpis egestas. Aliquam
                    lacinia ipsum ligula, tempus ornare lorem aliquet id. Aliquam erat volutpat.
                    Curabitur ut tempor sem, vitae rhoncus ex. Donec faucibus laoreet lectus. Nunc
                    convallis, eros vitae efficitur finibus, orci purus molestie erat, et euismod
                    nunc nulla quis risus. Nulla vitae efficitur tellus, bibendum tempus dolor. Sed
                    vehicula tellus quis ex ullamcorper, id tempus elit ornare. Ut ut mattis mi.
                    Nullam eu neque ultrices, iaculis augue eget, scelerisque lectus. Donec eget
                    convallis ex. Maecenas bibendum orci a urna tincidunt placerat eu nec tellus.
                    Donec vitae tempus nibh. In laoreet euismod justo, ut vulputate leo mollis nec.
                    Cras vehicula sem ac ex rutrum venenatis. Nunc eu nunc bibendum, ullamcorper
                    nisl ac, vestibulum risus. Phasellus a justo sem. Morbi ut dui et sapien
                    faucibus tempor. Morbi vehicula, diam sed aliquet tincidunt, enim odio ultricies
                    est, lacinia porta erat tortor vitae sapien. Pellentesque iaculis massa augue,
                    vel interdum nulla porta et. Vivamus feugiat magna eu posuere tempus. Maecenas
                    non molestie nunc. Ut lacinia odio nec fringilla molestie. Duis arcu lorem,
                    dictum et sapien gravida, porttitor ullamcorper sem.
                </Box>
            )}
        </Box>
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
