import {CalendarDate} from "@internationalized/date";
import {MutableRefObject, useRef, useState} from "react";
import {useHover} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {TaskDateInput} from "~/client/web/tasks/internal/task_date_input.js";
import {TaskQueryFilterOperatorEditor} from "~/client/web/tasks/internal/task_query_filter_operator_editor.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {
    TaskQueryFilterDateOperation,
    TaskQueryFilterDateOperationDuration,
} from "~/shared/tasks/task_query_filter.js";

export const taskQueryFilterDateOperationLessThanOperatorLabel = "is before";
export const taskQueryFilterDateOperationGreaterThanOperatorLabel = "is after";

export function TaskQueryFilterDateOperationEditor({
    operation,
    onOperationChange,
}: {
    operation: TaskQueryFilterDateOperation;
    onOperationChange: (operation: TaskQueryFilterDateOperation) => void;
}) {
    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={
                    operation.type === "LessThan"
                        ? taskQueryFilterDateOperationLessThanOperatorLabel
                        : taskQueryFilterDateOperationGreaterThanOperatorLabel
                }
                allOperators={[
                    {
                        label: taskQueryFilterDateOperationLessThanOperatorLabel,
                        isSelected: operation.type === "LessThan",
                        onPress: () => {
                            onOperationChange({
                                type: "LessThan",
                                date: operation.date,
                            });
                        },
                    },
                    {
                        label: taskQueryFilterDateOperationGreaterThanOperatorLabel,
                        isSelected: operation.type === "GreaterThan",
                        onPress: () => {
                            onOperationChange({
                                type: "GreaterThan",
                                date: operation.date,
                            });
                        },
                    },
                ]}
            />
            <TaskQueryFilterDateOperationValueEditor
                operation={operation}
                onOperationChange={onOperationChange}
            />
        </>
    );
}

export function TaskQueryFilterDateOperationValueEditor({
    operation,
    onOperationChange,
}: {
    operation: TaskQueryFilterDateOperation;
    onOperationChange: (operation: TaskQueryFilterDateOperation) => void;
}) {
    const platform = usePlatform();

    const absoluteDateLabel = "exact date";
    const relativeTodayDateLabel = "today";

    const relativeBeforeTodaySingularLabelByDurationType: {
        [Key in TaskQueryFilterDateOperationDuration["type"]]: string;
    } = {
        Days: "day ago",
        Weeks: "week ago",
        Months: "month ago",
        Years: "year ago",
    };

    const relativeAfterTodaySingularLabelByDurationType: {
        [Key in TaskQueryFilterDateOperationDuration["type"]]: string;
    } = {
        Days: "day from now",
        Weeks: "week from now",
        Months: "month from now",
        Years: "year from now",
    };

    const relativeBeforeTodayPluralLabelByDurationType: {
        [Key in TaskQueryFilterDateOperationDuration["type"]]: string;
    } = {
        Days: "days ago",
        Weeks: "weeks ago",
        Months: "months ago",
        Years: "years ago",
    };

    const relativeAfterTodayPluralLabelByDurationType: {
        [Key in TaskQueryFilterDateOperationDuration["type"]]: string;
    } = {
        Days: "days from now",
        Weeks: "weeks from now",
        Months: "months from now",
        Years: "years from now",
    };

    return (
        <>
            {operation.date.type === "Absolute" ? (
                <TaskQueryFilterDateOperationEditorDate
                    date={operation.date.date}
                    onDateChange={date => {
                        assert(operation.date.type === "Absolute");

                        onOperationChange({
                            type: operation.type,
                            date: {type: "Absolute", date},
                        });
                    }}
                />
            ) : operation.date.type !== "RelativeToday" ? (
                <TaskQueryFilterDateOperationEditorDurationCount
                    count={operation.date.duration.count}
                    onCountChange={count => {
                        assert(
                            operation.date.type !== "Absolute" &&
                                operation.date.type !== "RelativeToday",
                        );

                        onOperationChange({
                            type: operation.type,
                            date: {
                                type: operation.date.type,
                                duration: {
                                    type: operation.date.duration.type,
                                    count,
                                },
                            },
                        });
                    }}
                />
            ) : null}
            <Box
                height="full"
                minWidth={
                    platform === "mobile" && operation.date.type === "Absolute" ? "0" : undefined
                }
                flexShrink={
                    platform === "mobile" && operation.date.type === "Absolute" ? "1" : undefined
                }
                overflow={
                    platform === "mobile" && operation.date.type === "Absolute"
                        ? "hidden"
                        : undefined
                }
            >
                <TaskQueryFilterOperatorEditor
                    operatorLabel={
                        operation.date.type === "Absolute"
                            ? absoluteDateLabel
                            : operation.date.type === "RelativeToday"
                              ? relativeTodayDateLabel
                              : operation.date.type === "RelativeBeforeToday"
                                ? operation.date.duration.count === 1
                                    ? relativeBeforeTodaySingularLabelByDurationType[
                                          operation.date.duration.type
                                      ]
                                    : relativeBeforeTodayPluralLabelByDurationType[
                                          operation.date.duration.type
                                      ]
                                : operation.date.duration.count === 1
                                  ? relativeAfterTodaySingularLabelByDurationType[
                                        operation.date.duration.type
                                    ]
                                  : relativeAfterTodayPluralLabelByDurationType[
                                        operation.date.duration.type
                                    ]
                    }
                    allOperators={[
                        [
                            {
                                label: relativeTodayDateLabel,
                                isSelected: operation.date.type === "RelativeToday",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {type: "RelativeToday"},
                                    });
                                },
                            },
                            {
                                label: absoluteDateLabel,
                                isSelected: operation.date.type === "Absolute",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {type: "Absolute", date: null},
                                    });
                                },
                            },
                        ],
                        [
                            {
                                label: relativeBeforeTodayPluralLabelByDurationType["Days"],
                                isSelected:
                                    operation.date.type === "RelativeBeforeToday" &&
                                    operation.date.duration.type === "Days",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {
                                            type: "RelativeBeforeToday",
                                            duration: {
                                                type: "Days",
                                                count:
                                                    operation.date.type !== "Absolute" &&
                                                    operation.date.type !== "RelativeToday" &&
                                                    operation.date.duration.type === "Days"
                                                        ? operation.date.duration.count
                                                        : 1,
                                            },
                                        },
                                    });
                                },
                            },
                            {
                                label: relativeBeforeTodayPluralLabelByDurationType["Weeks"],
                                isSelected:
                                    operation.date.type === "RelativeBeforeToday" &&
                                    operation.date.duration.type === "Weeks",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {
                                            type: "RelativeBeforeToday",
                                            duration: {
                                                type: "Weeks",
                                                count:
                                                    operation.date.type !== "Absolute" &&
                                                    operation.date.type !== "RelativeToday" &&
                                                    operation.date.duration.type === "Weeks"
                                                        ? operation.date.duration.count
                                                        : 1,
                                            },
                                        },
                                    });
                                },
                            },
                            {
                                label: relativeBeforeTodayPluralLabelByDurationType["Months"],
                                isSelected:
                                    operation.date.type === "RelativeBeforeToday" &&
                                    operation.date.duration.type === "Months",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {
                                            type: "RelativeBeforeToday",
                                            duration: {
                                                type: "Months",
                                                count:
                                                    operation.date.type !== "Absolute" &&
                                                    operation.date.type !== "RelativeToday" &&
                                                    operation.date.duration.type === "Months"
                                                        ? operation.date.duration.count
                                                        : 1,
                                            },
                                        },
                                    });
                                },
                            },
                            {
                                label: relativeBeforeTodayPluralLabelByDurationType["Years"],
                                isSelected:
                                    operation.date.type === "RelativeBeforeToday" &&
                                    operation.date.duration.type === "Years",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {
                                            type: "RelativeBeforeToday",
                                            duration: {
                                                type: "Years",
                                                count:
                                                    operation.date.type !== "Absolute" &&
                                                    operation.date.type !== "RelativeToday" &&
                                                    operation.date.duration.type === "Years"
                                                        ? operation.date.duration.count
                                                        : 1,
                                            },
                                        },
                                    });
                                },
                            },
                        ],
                        [
                            {
                                label: relativeAfterTodayPluralLabelByDurationType["Days"],
                                isSelected:
                                    operation.date.type === "RelativeAfterToday" &&
                                    operation.date.duration.type === "Days",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {
                                            type: "RelativeAfterToday",
                                            duration: {
                                                type: "Days",
                                                count:
                                                    operation.date.type !== "Absolute" &&
                                                    operation.date.type !== "RelativeToday" &&
                                                    operation.date.duration.type === "Days"
                                                        ? operation.date.duration.count
                                                        : 1,
                                            },
                                        },
                                    });
                                },
                            },
                            {
                                label: relativeAfterTodayPluralLabelByDurationType["Weeks"],
                                isSelected:
                                    operation.date.type === "RelativeAfterToday" &&
                                    operation.date.duration.type === "Weeks",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {
                                            type: "RelativeAfterToday",
                                            duration: {
                                                type: "Weeks",
                                                count:
                                                    operation.date.type !== "Absolute" &&
                                                    operation.date.type !== "RelativeToday" &&
                                                    operation.date.duration.type === "Weeks"
                                                        ? operation.date.duration.count
                                                        : 1,
                                            },
                                        },
                                    });
                                },
                            },
                            {
                                label: relativeAfterTodayPluralLabelByDurationType["Months"],
                                isSelected:
                                    operation.date.type === "RelativeAfterToday" &&
                                    operation.date.duration.type === "Months",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {
                                            type: "RelativeAfterToday",
                                            duration: {
                                                type: "Months",
                                                count:
                                                    operation.date.type !== "Absolute" &&
                                                    operation.date.type !== "RelativeToday" &&
                                                    operation.date.duration.type === "Months"
                                                        ? operation.date.duration.count
                                                        : 1,
                                            },
                                        },
                                    });
                                },
                            },
                            {
                                label: relativeAfterTodayPluralLabelByDurationType["Years"],
                                isSelected:
                                    operation.date.type === "RelativeAfterToday" &&
                                    operation.date.duration.type === "Years",
                                onPress: () => {
                                    onOperationChange({
                                        type: operation.type,
                                        date: {
                                            type: "RelativeAfterToday",
                                            duration: {
                                                type: "Years",
                                                count:
                                                    operation.date.type !== "Absolute" &&
                                                    operation.date.type !== "RelativeToday" &&
                                                    operation.date.duration.type === "Years"
                                                        ? operation.date.duration.count
                                                        : 1,
                                            },
                                        },
                                    });
                                },
                            },
                        ],
                    ]}
                />
            </Box>
        </>
    );
}

function TaskQueryFilterDateOperationEditorDate({
    date,
    onDateChange,
}: {
    date: CalendarDate | null;
    onDateChange: (date: CalendarDate | null) => void;
}) {
    const {isHovered, hoverProps} = useHover({});

    return (
        <Box {...hoverProps} height="full" position="relative" zIndex="0">
            <TaskDateInput
                aria-label="Date"
                date={date}
                onDateChange={onDateChange}
                height="full"
                paddingX="1"
                focusRingOffset="0"
            />
            {isHovered && (
                <Box
                    position="absolute"
                    zIndex="-10"
                    left="0"
                    right="0"
                    style={{top: 1, bottom: 1}}
                    backgroundColor="grey-5"
                    borderRadius="0.5"
                    pointerEvents="none"
                />
            )}
        </Box>
    );
}

function TaskQueryFilterDateOperationEditorDurationCount({
    count,
    onCountChange,
}: {
    count: number;
    onCountChange: (count: number) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const {hoverProps, isHovered} = useHover({});

    const [state, setState] = useState<
        | {isFocused: false}
        | {
              isFocused: true;
              value: string;
              shouldSelectRef: MutableRefObject<boolean>;
          }
    >({
        isFocused: false,
    });

    const setStateAndUpdateCount = (newState: typeof state) => {
        setState(newState);

        // Update our local component state and the page number in the same
        // React commit. Instead of an effect which would be two commits.
        updateCount(newState);
    };

    const minCount = 0;
    const maxCount = 2 ** 32 - 1;

    const updateCount = (newState: typeof state) => {
        if (newState.isFocused && /\d+/.test(newState.value)) {
            const valueNumber = parseInt(newState.value, 10);
            const newCount = clamp(minCount, valueNumber, maxCount);
            if (count !== newCount) {
                onCountChange(newCount);
            }
        }
    };

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.isFocused || !state.shouldSelectRef.current) return;
        // eslint-disable-next-line react-compiler/react-compiler
        state.shouldSelectRef.current = false;

        assertExists(inputRef.current).select();
    }, [state]);

    const inputValue = state.isFocused ? state.value : String(count);
    const inputPlaceholder = "0";

    return (
        <Box {...hoverProps} height="full" minWidth="0" position="relative" zIndex="0">
            <FocusRing offset="0">
                <input
                    ref={inputRef}
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                        display: "inline-block",
                        paddingX: "1",
                        backgroundColor: "transparent",
                    })}
                    style={{fontVariantNumeric: "tabular-nums"}}
                    placeholder={inputPlaceholder}
                    inputMode="numeric"
                    value={inputValue}
                    onChange={event => {
                        if (!state.isFocused) return;

                        // Don't update the page while the user is typing. If they type "15" that means
                        // they first type "1". We don't want to navigate to "1".
                        setState({
                            isFocused: true,
                            value: event.currentTarget.value.replaceAll(/\D/g, ""),
                            shouldSelectRef: {current: false},
                        });
                    }}
                    onFocus={event => {
                        // Select everything in the input on focus.
                        event.currentTarget.select();

                        if (!state.isFocused) {
                            setState({
                                isFocused: true,
                                value: String(count),
                                shouldSelectRef: {current: false},
                            });
                        }
                    }}
                    onBlur={() => {
                        // When the user blurs, update our page if it's a valid page number. If the
                        // user types "15" we don't update the page as they type, only when they blur.
                        if (state.isFocused) {
                            updateCount(state);
                            setState({isFocused: false});
                        }
                    }}
                    onKeyDown={event => {
                        switch (event.key) {
                            case "Enter": {
                                event.preventDefault();
                                event.stopPropagation();

                                // If the user hits enter, update our page. If they're typing "15" then this
                                // will jump to page 15.
                                updateCount(state);
                                break;
                            }
                            case "ArrowUp": {
                                event.preventDefault();
                                event.stopPropagation();

                                if (state.isFocused && /\d+/.test(state.value)) {
                                    const valueNumber = parseInt(state.value, 10);
                                    setStateAndUpdateCount({
                                        isFocused: true,
                                        value: String(
                                            clamp(
                                                minCount,
                                                valueNumber + (event.shiftKey ? 5 : 1),
                                                maxCount,
                                            ),
                                        ),
                                        shouldSelectRef: {current: true},
                                    });
                                }
                                break;
                            }
                            case "ArrowDown": {
                                event.preventDefault();
                                event.stopPropagation();

                                if (state.isFocused && /\d+/.test(state.value)) {
                                    const valueNumber = parseInt(state.value, 10);
                                    setStateAndUpdateCount({
                                        isFocused: true,
                                        value: String(
                                            clamp(
                                                minCount,
                                                valueNumber - (event.shiftKey ? 5 : 1),
                                                maxCount,
                                            ),
                                        ),
                                        shouldSelectRef: {current: true},
                                    });
                                }
                                break;
                            }
                        }
                    }}
                />
            </FocusRing>
            <Box
                // Only used for layout, screen readers should ignore.
                aria-hidden={true}
                pointerEvents="none"
                opacity="0"
                height="full"
                paddingX="1"
                maxWidth="32"
                style={{fontVariantNumeric: "tabular-nums"}}
            >
                {inputValue.length === 0 ? inputPlaceholder : inputValue}
                <span
                    style={{
                        display: "inline-block",
                        // NOTE(calebmer): I've found adding a bit of extra width helps sub-pixel
                        // rendering (which sometimes clips the text) and the iOS Safari cursor which
                        // seems to add ~2px of width to input content. Can't use `paddingRight` since
                        // `textClassName` or `textStyle` may add padding we don't want to override.
                        //
                        // To see the issues the [iOS Safari cursor causes here's a bug repro][1].
                        // Notice how the input text shifts to the left and is clipped. This seems to
                        // be because the iOS cursor takes horizontal space in the input.
                        //
                        // [1]: https://gist.github.com/calebmer/cfaa91c91a53e893a43e30d65d1c6b80
                        width: 2,
                    }}
                />
            </Box>
            {isHovered && (
                <Box
                    position="absolute"
                    zIndex="-10"
                    left="0"
                    right="0"
                    style={{top: 1, bottom: 1}}
                    backgroundColor="grey-5"
                    borderRadius="0.5"
                    pointerEvents="none"
                />
            )}
        </Box>
    );
}
