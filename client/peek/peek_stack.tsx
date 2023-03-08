import {X} from "phosphor-react";
import {ReactNode, createContext, useContext, useMemo, useReducer} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {Spacing, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {InternalError} from "~/shared/error/error";
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
    readonly head: PeekStackEntry;
    readonly tail: ReadonlyArray<PeekStackEntry>;
};

type PeekStackAction = PeekStackPushAction | PeekStackPopAction;

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
        case "Push": {
            return {
                head: action.entry,
                tail: state ? [state.head, ...state.tail] : [],
            };
        }
        case "Pop": {
            if (!state) return state;

            if (!state.tail[0]) {
                return null;
            } else {
                return {
                    head: state.tail[0],
                    tail: state.tail.slice(1),
                };
            }
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
                        key={state.head.id}
                        state={state}
                        dispatch={dispatch}
                        entry={state.head}
                        index={0}
                    />,
                    ...state.tail.slice(0, 3).map((entry, index) => {
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
                }}
            >
                {index === 0 && (
                    <Box
                        width="full"
                        height="full"
                        overflow="hidden"
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
                    {state.tail.length >= 1 && renderPopClickOverlay(1)}
                    {state.tail.length >= 2 && renderPopClickOverlay(2)}
                </>
            )}
        </>
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
