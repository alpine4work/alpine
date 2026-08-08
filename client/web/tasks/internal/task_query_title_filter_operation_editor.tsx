import {MutableRefObject, useRef, useState} from "react";
import {useHover} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {TaskQueryFilterOperatorEditor} from "~/client/web/tasks/internal/task_query_filter_operator_editor.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TaskQueryTitleFilter} from "~/shared/tasks/task_query_filter.js";

export function TaskQueryTitleFilterOperationEditor({
    filter,
    onFilterChange,
}: {
    filter: TaskQueryTitleFilter;
    onFilterChange: (filter: TaskQueryTitleFilter) => void;
}) {
    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={filter.operation.type === "Includes" ? "includes" : "excludes"}
                allOperators={[
                    {
                        label: "includes",
                        isSelected: filter.operation.type === "Includes",
                        onPress: () => {
                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, type: "Includes"},
                            });
                        },
                    },
                    {
                        label: "excludes",
                        isSelected: filter.operation.type === "Excludes",
                        onPress: () => {
                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, type: "Excludes"},
                            });
                        },
                    },
                ]}
            />
            <TaskQueryTitleFilterOperationEditorValueEditor
                titleQuery={filter.operation.titleQuery}
                onTitleQueryChange={titleQuery =>
                    onFilterChange({
                        ...filter,
                        operation: {...filter.operation, titleQuery},
                    })
                }
            />
        </>
    );
}

function TaskQueryTitleFilterOperationEditorValueEditor({
    titleQuery,
    onTitleQueryChange,
}: {
    titleQuery: string;
    onTitleQueryChange: (filter: string) => void;
}) {
    const platform = usePlatform();

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

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.isFocused || !state.shouldSelectRef.current) return;
        // eslint-disable-next-line react-compiler/react-compiler
        state.shouldSelectRef.current = false;

        assertExists(inputRef.current).select();
    }, [state]);

    const inputValue = state.isFocused ? state.value : titleQuery;
    const inputPlaceholder = "anything";

    return (
        <Box
            {...hoverProps}
            height="full"
            maxWidth={platform === "mobile" ? undefined : "48"}
            overflow={platform === "mobile" ? "hidden" : undefined}
            position="relative"
            zIndex="0"
        >
            <FocusRing offset="0">
                <InputWithAutoGrowingWidth
                    ref={inputRef}
                    containerClassName={sprinkles({
                        height: "full",
                    })}
                    textClassName={sprinkles({
                        height: "full",
                        paddingX: "1",
                        fontSize: "75",
                    })}
                    className={sprinkles({
                        backgroundColor: "transparent",
                    })}
                    placeholder={inputValue.trim().length > 0 ? "\u2014" : inputPlaceholder}
                    value={inputValue}
                    onChange={event => {
                        if (!state.isFocused) return;

                        // Don't update the page while the user is typing. If they type "15" that means
                        // they first type "1". We don't want to navigate to "1".
                        setState({
                            isFocused: true,
                            value: event.currentTarget.value,
                            shouldSelectRef: {current: false},
                        });
                    }}
                    onFocus={event => {
                        // Select everything in the input on focus.
                        event.currentTarget.select();

                        if (!state.isFocused) {
                            setState({
                                isFocused: true,
                                value: titleQuery,
                                shouldSelectRef: {current: false},
                            });
                        }
                    }}
                    onBlur={() => {
                        // When the user blurs, update our page if it's a valid page number. If the user
                        // types "15" we don't update the page as they type, only when they blur.
                        if (state.isFocused) {
                            onTitleQueryChange(state.value);
                            setState({isFocused: false});
                        }
                    }}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();

                            // If the user hits enter, update our page. If they're typing "15" then this will
                            // jump to page 15.
                            if (state.isFocused) {
                                onTitleQueryChange(state.value);
                            }
                        }
                    }}
                />
            </FocusRing>
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
