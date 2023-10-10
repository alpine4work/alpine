import {getInteractionModality, isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import classNames from "classnames";
import _Fuse from "fuse.js";
import {Check, MagnifyingGlass} from "phosphor-react";
import {
    Ref,
    RefObject,
    cloneElement,
    forwardRef,
    isValidElement,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {getTaskPriorityName} from "~/client/tasks/internal/get_task_priority_name.js";
import {TaskPriorityIcon} from "~/client/tasks/internal/task_priority_icon.js";
import {spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    colorSchemeVars,
    greyElevated2ClassName,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

type TaskPriorityInputItem = {readonly key: TaskPriority | "Null"};

type TaskPriorityInputState =
    | {
          readonly type: "Selection";
          readonly disableAnimationOut: boolean;
      }
    | {
          readonly type: "Typing";
          readonly value: string;
          readonly hasChanged: boolean;
          readonly shouldSelect: boolean;
      };

export type TaskPriorityInputRef = {
    focus(): void;
};

const TaskPriorityInputForwardRef = forwardRef(TaskPriorityInput);
export {TaskPriorityInputForwardRef as TaskPriorityInput};

function TaskPriorityInput(
    {
        isReadOnly,
        priority,
        onPriorityChange,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        color = "grey-text",
        isTabbable = true,
        onArrowLeftLeaveKeyDown,
        onArrowRightLeaveKeyDown,
    }: {
        priority: TaskPriority | null;
        onPriorityChange: (priority: TaskPriority | null) => void;
        isReadOnly?: boolean;
        "aria-label"?: string;
        "aria-labelledby"?: string;
        color?: "grey-text" | "grey-60";
        isTabbable?: boolean;
        onArrowLeftLeaveKeyDown?: () => void;
        onArrowRightLeaveKeyDown?: () => void;
    },
    ref: Ref<TaskPriorityInputRef>,
) {
    const [inputState, setInputState] = useState<TaskPriorityInputState>({
        type: "Selection",
        disableAnimationOut: false,
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        if (inputState.type === "Typing" && inputState.shouldSelect) {
            assertExists(inputRef.current).select();
            setInputState({...inputState, shouldSelect: false});
        }
    }, [inputState]);

    const selectionInputValue = priority ? getTaskPriorityName(priority) : "";
    const inputValue = inputState.type === "Selection" ? selectionInputValue : inputState.value;

    const allItems: Array<TaskPriorityInputItem> = useMemo(
        () => [{key: "Null"}, {key: "Low"}, {key: "Medium"}, {key: "High"}, {key: "Urgent"}],
        [],
    );

    const itemsSearchIndex = useMemo(
        () =>
            new Fuse(allItems, {
                keys: [{name: "name", getFn: item => getTaskPriorityName(item.key)}],
            }),
        [allItems],
    );

    const searchedItems = useMemo(
        () =>
            inputValue === "" || inputState.type === "Selection" || !inputState.hasChanged
                ? allItems
                : itemsSearchIndex.search(inputValue).map(({item}) => item),

        [allItems, inputState, inputValue, itemsSearchIndex],
    );

    const selectedKey: TaskPriorityInputItem["key"] = priority ?? "Null";

    const comboBoxProps: ComboBoxStateOptions<TaskPriorityInputItem> = {
        menuTrigger: "focus",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        isDisabled: isReadOnly,

        inputValue,
        onInputChange: inputValue => {
            setInputState(inputState => {
                // Must be in a typing state to accept new typing changes.
                if (inputState.type !== "Typing") return inputState;

                return {type: "Typing", value: inputValue, hasChanged: true, shouldSelect: false};
            });
        },

        onFocus: () => {
            // Select all text on focus.
            assertExists(inputRef.current).select();

            // When focused, switch to a typing state.
            setInputState(inputState => {
                if (inputState.type === "Typing") return inputState;
                return {type: "Typing", value: inputValue, hasChanged: false, shouldSelect: false};
            });
        },

        onBlur: () => {
            // When unfocused, switch back to a selection state discarding any typed value.
            setInputState(inputState => {
                if (inputState.type === "Selection") return inputState;
                return {type: "Selection", disableAnimationOut: false};
            });
        },

        onKeyDown: event => {
            const inputElement = assertExists(inputRef.current);

            switch (event.key) {
                case "Backspace": {
                    if (priority && inputState.type === "Typing" && inputState.value.length === 0) {
                        event.preventDefault();
                        event.stopPropagation();
                        comboBoxState.setSelectedKey("Null");
                    }
                    break;
                }
                case "ArrowLeft": {
                    if (
                        inputElement.selectionStart === inputElement.selectionEnd &&
                        inputElement.selectionStart === 0
                    ) {
                        event.preventDefault();
                        event.stopPropagation();
                        onArrowLeftLeaveKeyDown?.();
                    }
                    break;
                }
                case "ArrowRight": {
                    if (
                        inputElement.selectionStart === inputElement.selectionEnd &&
                        inputElement.selectionStart === inputElement.value.length
                    ) {
                        event.preventDefault();
                        event.stopPropagation();
                        onArrowRightLeaveKeyDown?.();
                    }
                    break;
                }
            }
        },

        items: searchedItems,
        children: item => (
            <Item textValue={getTaskPriorityName(item.key)}>
                <TaskPriorityInputListBoxOptionItem item={item} />
            </Item>
        ),

        selectedKey,
        onSelectionChange: _key => {
            const key = _key as TaskPriorityInputItem["key"];

            if (key !== selectedKey) {
                onPriorityChange(key === "Null" ? null : key);
            }

            // Keep focus in the input if we're using a keyboard interaction modality.
            if (getInteractionModality() !== "pointer") {
                setInputState(inputState => {
                    if (inputState.type !== "Typing") return inputState;
                    return {
                        type: "Typing",
                        value: key === "Null" ? "" : getTaskPriorityName(key),
                        hasChanged: false,
                        shouldSelect: true,
                    };
                });
            } else {
                setInputState(inputState => {
                    if (inputState.type === "Selection") return inputState;
                    return {type: "Selection", disableAnimationOut: true};
                });

                assertExists(inputRef.current).blur();
            }
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const {inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            inputRef,
            popoverRef,
            listBoxRef,
            "aria-label": ariaLabel,
            "aria-labelledby": ariaLabelledBy,
        },
        comboBoxState,
    );

    useImperativeHandle(
        ref,
        () => ({
            focus: () => assertExists(inputRef.current).focus(),
        }),
        [],
    );

    return (
        <Box
            onKeyDown={event => {
                // Blur the input when escape is pressed which closes the dropdown.
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    event.target.blur();
                    return;
                }
            }}
        >
            <OverlayAnimated
                isVisible={comboBoxState.isOpen}
                offset={defaultTooltipOffset}
                offsetAlong="-2.5"
                disableAnimationIn={true}
                disableAnimationOut={
                    inputState.type === "Selection" && inputState.disableAnimationOut
                }
                placement="bottom-start"
                overlay={
                    <Box ref={popoverRef} position="relative">
                        <TaskPriorityInputListBox
                            comboBoxState={comboBoxState}
                            listBoxRef={listBoxRef}
                            listBoxProps={listBoxProps}
                            selectedKey={selectedKey}
                        />
                    </Box>
                }
            >
                <FocusRing isVisibleWhenFocusWithin>
                    <Box
                        maxWidth="full"
                        height="4"
                        display="inline-flex"
                        alignItems="center"
                        gap="1"
                        className={
                            !isReadOnly ? tasksStyles.textCursorNotInheritedClassName : undefined
                        }
                        style={{
                            // `display: inline-block` creates an inline layout which adds extra space
                            // below the element. Adding `vertical-align` stops the space from being added.
                            // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                            verticalAlign: "top",
                        }}
                        onPointerDown={event => {
                            // If the backdrop of this element was clicked and the input is focused then
                            // don't let a click unfocus it.
                            if (event.target === event.currentTarget) {
                                event.preventDefault();
                                assertExists(inputRef.current).focus();
                            }

                            // Make sure to reopen the combobox whenever the pointer clicks the input.
                            if (!isReadOnly) {
                                comboBoxState.open();
                            }
                        }}
                    >
                        <Box width="4" height="4" pointerEvents="none">
                            <TaskPriorityIcon
                                size="4"
                                priority={priority}
                                shouldHighlightUrgent={true}
                            />
                        </Box>
                        <InputWithAutoGrowingWidth
                            {...inputProps}
                            ref={inputRef}
                            tabIndex={!isTabbable ? -1 : undefined}
                            placeholder={priority ? selectionInputValue : getTaskPriorityName(null)}
                            className={sprinkles({color, height: "4"})}
                            style={{
                                ...inputProps.style,
                                // We want a text cursor even if `isReadOnly` is true. But not if we have a
                                // placeholder.
                                cursor: inputValue.length > 0 ? "text" : undefined,
                            }}
                        />
                    </Box>
                </FocusRing>
            </OverlayAnimated>
        </Box>
    );
}

function TaskPriorityInputListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskPriorityInputItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskPriorityInputItem>;
    selectedKey: TaskPriorityInputItem["key"];
}) {
    const {listBoxProps} = useListBox(_listBoxProps, comboBoxState, listBoxRef);

    return (
        <ul
            {...listBoxProps}
            ref={useMergedRefs(listBoxRef, useScrollbar())}
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    borderRadius: "md",
                    padding: "1",
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-20",
                    width: "48",
                    maxHeight: "64",
                    overflowX: "hidden",
                    overflowY: "auto",
                }),
            )}
        >
            {comboBoxState.collection.size === 0 ? (
                <Box padding="1.5" display="flex" alignItems="center" gap="1.5" color="grey-70">
                    <Box padding="0.5">
                        <MagnifyingGlass size={spacing["4"]} />
                    </Box>
                    <Box>No results</Box>
                </Box>
            ) : (
                Array.from(comboBoxState.collection, item => (
                    <TaskPriorityInputListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                        selectedKey={selectedKey}
                    />
                ))
            )}
        </ul>
    );
}

function TaskPriorityInputListBoxOption({
    comboBoxState,
    item,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskPriorityInputItem>;
    item: Node<TaskPriorityInputItem>;
    selectedKey: TaskPriorityInputItem["key"];
}) {
    const optionRef = useRef(null);
    const {isHovered, hoverProps} = useHover({});
    const {optionProps, isFocused, isPressed} = useOption(
        {key: item.key},
        comboBoxState,
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    assert(isValidElement(item.rendered));

    return (
        <FocusRing offset="0" isVisible={isFocused && wasFocusVisibleWhenFocused}>
            <li
                {...mergeProps(optionProps, hoverProps)}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    padding: "1.5",
                    borderRadius: "base",
                    color: "grey-text",
                    backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                })}
            >
                {cloneElement(item.rendered, {
                    isSelected: selectedKey === item.key,
                    isPressed,
                } as any)}
            </li>
        </FocusRing>
    );
}

function TaskPriorityInputListBoxOptionItem({
    item,
    isSelected,
    isPressed,
}: {
    item: TaskPriorityInputItem;
    isSelected?: boolean;
    isPressed?: boolean;
}) {
    assert(
        typeof isSelected === "boolean" || typeof isPressed === "boolean",
        "Expected to be rendered by <TaskPriorityInputListBoxOption> which provides extra props",
    );

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <TaskPriorityIcon
                size="4"
                priority={item.key === "Null" ? null : item.key}
                shouldHighlightUrgent={false}
            />
            <Box flexGrow="1" fontStyle="truncate">
                {getTaskPriorityName(item.key)}
            </Box>
            {isSelected && (
                <Box flexShrink="0" marginLeft="2">
                    <Check
                        size={spacing["3"]}
                        color={
                            isPressed ? colorSchemeVars["grey-text"] : colorSchemeVars["grey-70"]
                        }
                    />
                </Box>
            )}
        </Box>
    );
}
