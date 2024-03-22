import {getInteractionModality, usePress} from "@react-aria/interactions";
import classNames from "classnames";
import _Fuse from "fuse.js";
import {Ref, forwardRef, useImperativeHandle, useMemo, useRef, useState} from "react";
import {useComboBox} from "react-aria";
import {ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {getTaskPriorityName} from "~/client/tasks/internal/get_task_priority_name.js";
import {TaskPriorityIcon} from "~/client/tasks/internal/task_priority_icon.js";
import {
    TaskPriorityInputListBox,
    TaskPriorityInputListBoxOptionItem,
} from "~/client/tasks/internal/task_priority_input_list_box.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {sprinkles, tasksStyles} from "~/shared/styles/styles.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export type TaskPriorityInputItem = {readonly key: TaskPriority | "Null"};

type TaskPriorityInputState =
    | {
          readonly type: "Selection";
          readonly disableAnimationOut: boolean;
      }
    | {
          readonly type: "Typing";
          readonly initialPriority: TaskPriority | null;
          readonly value: string;
          readonly hasChanged: boolean;
          readonly shouldSelect: boolean;
      };

export type TaskPriorityInputRef = {
    focus(): void;
};

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// So we assign the `Box` variable to null here so you get a TypeScript error
// if you try to use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

const TaskPriorityInputForwardRef = forwardRef(TaskPriorityInput);
export {TaskPriorityInputForwardRef as TaskPriorityInput};

const allItems: ReadonlyArray<TaskPriorityInputItem> = [
    {key: "Null"},
    {key: "Low"},
    {key: "Medium"},
    {key: "High"},
    {key: "Urgent"},
];

const itemsSearchIndex = new Lazy(() => {
    return new Fuse(allItems, {
        keys: [{name: "name", getFn: item => getTaskPriorityName(item.key)}],
    });
});

let isClosingComboBox = false;

function TaskPriorityInput(
    {
        priority,
        onPriorityChange,
        shouldHighlightUrgent,
        isReadOnly,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        color = "grey-text",
        isTabbable = true,
        onArrowLeftLeaveKeyDown,
        onArrowRightLeaveKeyDown,
    }: {
        priority: TaskPriority | null;
        onPriorityChange: (priority: TaskPriority | null) => void;
        shouldHighlightUrgent: boolean;
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
    const isMobile = useIsMobile();

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

    const searchedItems = useMemo(
        () =>
            inputValue === "" || inputState.type === "Selection" || !inputState.hasChanged
                ? allItems
                : itemsSearchIndex
                      .get()
                      .search(inputValue)
                      .map(({item}) => item),

        [inputState, inputValue],
    );

    const selectedKey: TaskPriorityInputItem["key"] = priority ?? "Null";

    const comboBoxProps: ComboBoxStateOptions<TaskPriorityInputItem> = {
        menuTrigger: "manual",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        isDisabled: isReadOnly,

        inputValue,
        onInputChange: inputValue => {
            setInputState(inputState => {
                // Must be in a typing state to accept new typing changes.
                if (inputState.type !== "Typing") return inputState;

                return {
                    type: "Typing",
                    initialPriority: inputState.initialPriority,
                    value: inputValue,
                    hasChanged: true,
                    shouldSelect: false,
                };
            });

            // If the combobox was closed (probably because of a selection) reopen when the
            // user starts typing again.
            if (!comboBoxState.isOpen) {
                comboBoxState.open();
            }
        },

        onFocus: () => {
            const inputElement = assertExists(inputRef.current);

            // Select all text on focus.
            //
            // Except on mobile. Since on mobile devices like iOS selecting a range of text
            // will open a hovering edit menu (with copy/paste/etc. actions) which
            // conflicts with our overlay. So instead clear out the text. The old text will
            // still be visible in a placeholder.
            if (!isMobile) {
                inputElement.select();

                // Open the combobox on focus.
                comboBoxState.open();

                // When focused, switch to a typing state.
                setInputState(inputState => {
                    if (inputState.type === "Typing") return inputState;
                    return {
                        type: "Typing",
                        initialPriority: priority,
                        value: inputValue,
                        hasChanged: false,
                        shouldSelect: false,
                    };
                });
            } else {
                // Open the combobox on focus.
                comboBoxState.open();

                // When focused, switch to a typing state.
                setInputState(inputState => {
                    if (inputState.type === "Typing") return inputState;
                    return {
                        type: "Typing",
                        initialPriority: priority,
                        value: "",
                        hasChanged: false,
                        shouldSelect: false,
                    };
                });
            }
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
            if (isClosingComboBox) return;

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
                        initialPriority: key === "Null" ? null : key,
                        value: key === "Null" ? "" : getTaskPriorityName(key),
                        hasChanged: false,
                        shouldSelect: true,
                    };
                });

                // Close after the user has selected an option. `shouldSelect: true` will also
                // disable the overlay animation out.
                //
                // Annoyingly, `react-aria` recursively calls `onSelectionChange` when you call
                // `close()` so we need to defend against recursion.
                isClosingComboBox = true;
                try {
                    comboBoxState.close();
                } finally {
                    isClosingComboBox = false;
                }
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

    // If the priority changed while the user was focused and typing, reset the
    // input to the new selection.
    //
    // This commonly happens when the user makes a selection then hits cmd-z.
    if (inputState.type === "Typing" && inputState.initialPriority !== priority) {
        setInputState({
            type: "Typing",
            initialPriority: priority,
            value: priority ? getTaskPriorityName(priority) : "",
            hasChanged: false,
            shouldSelect: true,
        });

        comboBoxState.close();
    }

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

    const {pressProps: backdropPressProps} = usePress({
        // Backdrop doesn't receive focus.
        preventFocusOnPress: true,

        onPressStart: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                assertExists(inputRef.current).focus();

                // Make sure to reopen the combobox whenever the pointer clicks the input.
                if (!isReadOnly) {
                    comboBoxState.open();
                }
            }
        },
        onPress: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                assertExists(inputRef.current).focus();

                // Make sure to reopen the combobox whenever the pointer clicks the input.
                if (!isReadOnly) {
                    comboBoxState.open();
                }
            }
        },
    });

    useImperativeHandle(
        ref,
        () => ({
            focus: () => assertExists(inputRef.current).focus(),
        }),
        [],
    );

    const insetMarginY = isMobile ? "2.5" : undefined;

    return (
        <div
            className={sprinkles({
                // Height of 9 for 45px on mobile to meet the [minimum recommended touch hit
                // target size][1].
                //
                // [1]: https://developer.apple.com/design/human-interface-guidelines/buttons#Best-practices
                height: isMobile ? "9" : "4",
                marginY: insetMarginY ? `-${insetMarginY}` : undefined,
            })}
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
                    inputState.type === "Selection"
                        ? inputState.disableAnimationOut
                        : inputState.shouldSelect
                }
                // Prefer rendering the overlay above the input on mobile since the keyboard
                // will open below the input causing an overlay rendered below to jump up.
                placement={isMobile ? "top-start" : "bottom-start"}
                overlay={
                    <div ref={popoverRef} className={sprinkles({position: "relative"})}>
                        <TaskPriorityInputListBox
                            comboBoxState={comboBoxState}
                            listBoxRef={listBoxRef}
                            listBoxProps={listBoxProps}
                            selectedKey={selectedKey}
                        />
                    </div>
                }
            >
                <FocusRing insetY={insetMarginY} isVisibleWhenFocusWithin>
                    <div
                        className={sprinkles({
                            position: "relative",
                            zIndex: "0",
                            maxWidth: "full",
                            height: "full",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "1",
                        })}
                        style={{
                            // `display: inline-flex` creates an inline layout which adds extra space
                            // below the element. Adding `vertical-align` stops the space from being added.
                            // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                            verticalAlign: "top",
                        }}
                    >
                        {!isReadOnly && (
                            <div
                                {...backdropPressProps}
                                className={sprinkles({
                                    position: "absolute",
                                    zIndex: "-10",
                                    inset: "0",
                                    cursor: "text",
                                })}
                            />
                        )}
                        <div
                            className={sprinkles({width: "4", height: "4", pointerEvents: "none"})}
                        >
                            <TaskPriorityIcon
                                size="4"
                                priority={priority}
                                shouldHighlightUrgent={shouldHighlightUrgent}
                            />
                        </div>
                        <InputWithAutoGrowingWidth
                            {...inputProps}
                            ref={inputRef}
                            tabIndex={!isTabbable ? -1 : undefined}
                            placeholder={priority ? selectionInputValue : getTaskPriorityName(null)}
                            className={sprinkles({
                                color,
                                height: isMobile ? "9" : "4",
                            })}
                            style={{
                                ...inputProps.style,
                                // We want a text cursor even if `isReadOnly` is true. But not if we have a
                                // placeholder.
                                cursor: inputValue.length > 0 ? "text" : undefined,
                            }}
                            onKeyDown={event => {
                                if (
                                    event.key === "Enter" &&
                                    comboBoxState.selectionManager.focusedKey == null
                                ) {
                                    // NOTE(calebmer): By default, `@react-aria/combobox` [calls `state.commit()`
                                    // whenever `Enter` is pressed][1] whether or not an option is focused. If an
                                    // option isn't focused this just closes the combobox and leaves the user
                                    // confused. Is what they typed the new value or not? It's not, you can tell
                                    // since the avatar doesn't change. This is particularly confusing on mobile
                                    // where the user may hit the return key expecting the first value in the menu
                                    // to be selected. But that won't happen, the menu will just close.
                                    //
                                    // So intercept this case and don't call into `@react-aria/combobox`.
                                    //
                                    // [1]: https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/combobox/src/useComboBox.ts#L132
                                } else {
                                    inputProps.onKeyDown?.(event);
                                }
                            }}
                        />
                    </div>
                </FocusRing>
            </OverlayAnimated>
        </div>
    );
}
