import {getInteractionModality, setInteractionModality, usePress} from "@react-aria/interactions";
import _Fuse from "fuse.js";
import {
    MutableRefObject,
    Ref,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useComboBox} from "react-aria";
import {ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useCanPrimaryInputHover, usePlatform} from "~/client/web/remix/platform_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {getTaskPriorityName} from "~/client/web/tasks/internal/get_task_priority_name.js";
import {isTaskGridViewApplyingUndoStackEntry} from "~/client/web/tasks/internal/is_task_grid_view_applying_undo_stack_entry.js";
import {TaskPriorityIcon} from "~/client/web/tasks/internal/task_priority_icon.js";
import {
    TaskPriorityInputListBox,
    TaskPriorityInputListBoxOptionItem,
} from "~/client/web/tasks/internal/task_priority_input_list_box.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export type TaskPriorityInputItem = {readonly key: TaskPriority | "Null"};

type TaskPriorityInputState =
    | {
          readonly type: "Selection";
          readonly disableAnimationOut: boolean;
          readonly shouldBlurRef: MutableRefObject<boolean>;
      }
    | {
          readonly type: "Typing";
          readonly initialPriority: TaskPriority | null;
          readonly value: string;
          readonly hasChanged: boolean;
          readonly disableAnimationOut: boolean;
          readonly shouldSelectRef: MutableRefObject<boolean>;
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
        withoutBlurAfterSelection,
        isReadOnly,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        color = "grey-100",
        isTabbable = true,
        onArrowLeftLeaveKeyDown,
        onArrowRightLeaveKeyDown,
    }: {
        priority: TaskPriority | null;
        onPriorityChange: (priority: TaskPriority | null) => void;
        shouldHighlightUrgent: boolean;
        withoutBlurAfterSelection?: boolean;
        isReadOnly?: boolean;
        "aria-label"?: string;
        "aria-labelledby"?: string;
        color?: "grey-100" | "grey-60";
        isTabbable?: boolean;
        onArrowLeftLeaveKeyDown?: () => void;
        onArrowRightLeaveKeyDown?: () => void;
    },
    ref: Ref<TaskPriorityInputRef>,
) {
    const platform = usePlatform();
    const canPrimaryInputHover = useCanPrimaryInputHover();

    const [inputState, setInputState] = useState<TaskPriorityInputState>({
        type: "Selection",
        disableAnimationOut: false,
        shouldBlurRef: {current: false},
    });

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (inputState.type === "Selection" && inputState.shouldBlurRef.current) {
            inputState.shouldBlurRef.current = false;
            assertExists(inputRef.current).blur();
        }

        if (inputState.type === "Typing" && inputState.shouldSelectRef.current) {
            inputState.shouldSelectRef.current = false;
            assertExists(inputRef.current).select();
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
                    disableAnimationOut: false,
                    shouldSelectRef: {current: false},
                };
            });

            // If the combobox was closed (probably because of a selection) reopen when the
            // user starts typing again.
            if (!comboBoxState.isOpen) {
                comboBoxState.open();
            }
        },

        onOpenChange: isOpen => {
            const inputElement = assertExists(inputRef.current);

            // Select all text when the combobox opens.
            //
            // Except on mobile. Since on mobile devices like iOS selecting a range of text
            // will open a hovering edit menu (with copy/paste/etc. actions) which
            // conflicts with our overlay. So instead we clear out the text. The old text
            // will still be visible in a placeholder.
            if (isOpen && platform !== "mobile") {
                inputElement.select();
            }
        },

        onFocus: () => {
            // Open the combobox on focus as long as we're not currently applying an undo.
            if (!isTaskGridViewApplyingUndoStackEntry()) {
                comboBoxState.open();
            }

            // When focused, switch to a typing state.
            setInputState(inputState => {
                if (inputState.type === "Typing") return inputState;
                return {
                    type: "Typing",
                    initialPriority: priority,
                    value: platform !== "mobile" ? inputValue : "",
                    hasChanged: false,
                    disableAnimationOut: false,
                    shouldSelectRef: {current: true},
                };
            });
        },

        onBlur: event => {
            // Chrome dispatches a "fake" blur event when the user has an element focused
            // but then clicks on another window, focusing that window but leaving our
            // current window visible. `blur` is dispatched but `document.activeElement`
            // doesn't change!
            //
            // Detect this case. If we receive a `blur` event but `document.activeElement`
            // hasn't changed then escalate to a real blur.
            if (event.target === document.activeElement) {
                event.target.blur();
            }

            // If we're focusing an element with a popup (`role="combobox"` [implicitly has
            // `aria-haspopup="listbox"`][1]) then don't animate out. Since the newly
            // focused element will probably open its popup.
            //
            // This happens when you have this input open then switch to another input by
            // tapping in `<TaskGridViewMobileKeyboardToolbar>`.
            //
            // [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
            const disableAnimationOut =
                event.relatedTarget instanceof HTMLElement
                    ? (event.relatedTarget.ariaHasPopup ??
                          (event.relatedTarget.role === "combobox" ? "listbox" : null)) !== null
                    : false;

            // When unfocused, switch back to a selection state discarding any typed value.
            setInputState(inputState => {
                if (inputState.type === "Selection") return inputState;
                return {
                    type: "Selection",
                    disableAnimationOut,
                    shouldBlurRef: {current: false},
                };
            });
        },

        onKeyDown: event => {
            const inputElement = assertExists(inputRef.current);

            switch (event.key) {
                case "ArrowDown":
                case "ArrowUp":
                case "Home":
                case "End": {
                    setInteractionModality("keyboard");
                    break;
                }
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
        children: useCallback(
            (item: TaskPriorityInputItem) => (
                <Item textValue={getTaskPriorityName(item.key)}>
                    <TaskPriorityInputListBoxOptionItem item={item} />
                </Item>
            ),
            [],
        ),

        selectedKey,
        onSelectionChange: _key => {
            if (isClosingComboBox) return;

            const key = _key as TaskPriorityInputItem["key"];

            if (key !== selectedKey) {
                onPriorityChange(key === "Null" ? null : key);
            }

            // Keep focus in the input if we're using a keyboard interaction modality.
            if (getInteractionModality() !== "pointer" || withoutBlurAfterSelection) {
                setInputState(inputState => {
                    if (inputState.type !== "Typing") return inputState;
                    return {
                        type: "Typing",
                        initialPriority: key === "Null" ? null : key,
                        value: key === "Null" ? "" : getTaskPriorityName(key),
                        hasChanged: false,
                        disableAnimationOut: true,
                        shouldSelectRef: {current: true},
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
                    return {
                        type: "Selection",
                        disableAnimationOut: true,
                        shouldBlurRef: {current: true},
                    };
                });
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
            disableAnimationOut: true,
            shouldSelectRef: {current: true},
        });

        comboBoxState.close();
    }

    const {inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            inputRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            popoverRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
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
            }
        },
        onPress: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                assertExists(inputRef.current).focus();
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

    const insetMarginY = platform === "mobile" ? "2.5" : undefined;

    return (
        <div
            className={sprinkles({
                // Height of 9 for 45px on mobile to meet the [minimum recommended touch hit
                // target size][1].
                //
                // [1]: https://developer.apple.com/design/human-interface-guidelines/buttons#Best-practices
                height: platform === "mobile" ? "9" : "4",
                marginY: insetMarginY ? `-${insetMarginY}` : undefined,
            })}
            onKeyDown={event => {
                // Blur the input when escape is pressed which closes the dropdown.
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    (event.target as HTMLElement).blur();
                    return;
                }
            }}
        >
            <OverlayAnimated
                isVisible={comboBoxState.isOpen}
                offset={defaultTooltipOffset}
                offsetAlong="-2.5"
                disableAnimationIn={true}
                disableAnimationOut={inputState.disableAnimationOut}
                // Prefer rendering the overlay above the input on mobile since the keyboard
                // will open below the input causing an overlay rendered below to jump up.
                placement={platform === "mobile" ? "top-start" : "bottom-start"}
                // The overlay blocks interaction with everything outside the overlay. Except
                // the combobox input. We still want to render the overlay in our current
                // overlay scope so that it animates smoothly with scroll animations (important
                // on mobile when we need to avoid the keyboard).
                isBlocking={true}
                withoutRootBlockingScope={true}
                withoutBlockingTarget={true}
                onBlockingCoverPointerDown={() => {
                    if (document.activeElement instanceof HTMLElement)
                        document.activeElement.blur();
                }}
                // Set a constant `overflowBottom` value instead of relying on the current
                // keyboard height (which will be updated asynchronously after `isEditing` is
                // true). This stops the overlay placement from jumping around while the
                // keyboard opens. The value was calculated based on the keyboard height in
                // iOS. We may need to change this constant if the keyboard height for iOS
                // changes or the Android keyboard height is bigger.
                overflowBottom={platform === "mobile" ? "18rem" : undefined}
                overflowTop={navigationBarHeight}
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
                                height: platform === "mobile" ? "9" : "4",
                            })}
                            style={{
                                ...inputProps.style,
                                // We want a text cursor even if `isReadOnly` is true. But not if we have a
                                // placeholder.
                                cursor: inputValue.length > 0 ? "text" : undefined,
                            }}
                            containerStyle={{
                                // Don't allow selecting the input text if touch drag is supported and the
                                // input is unfocused. We know `!canPrimaryInputHover` is the main precondition
                                // to supporting touch dragging.
                                //
                                // Otherwise if you long press on this text input the browser will try to
                                // select text and go into drag state at the same time! We only want to engage
                                // drag state.
                                pointerEvents:
                                    !canPrimaryInputHover && inputState.type === "Selection"
                                        ? "none"
                                        : undefined,
                            }}
                            // Allow iOS and MacOS autocorrect and spell checking. By default `react-aria`
                            // disables these capabilities because the user has combobox suggestions.
                            // However, fixing typos at the OS level when typos are common (like on iOS)
                            // is really useful.
                            autoCorrect={undefined}
                            spellCheck={undefined}
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
                            onPointerDown={event => {
                                // As a convenience, if you tap on this element while it's already focused but
                                // the combobox isn't open then open the combobox. After you select an option
                                // the combobox closes but the user may want to select another account.
                                //
                                // We have to be a little careful and make sure this doesn't break the default
                                // browser behavior of focusing the input if it's unfocused.
                                if (
                                    !isReadOnly &&
                                    document.activeElement === event.target &&
                                    !comboBoxState.isOpen
                                ) {
                                    comboBoxState.open();
                                }

                                // When using the mouse, if the user clicks the input and the input isn't
                                // focused then prevent default and open the combobox. We `preventDefault()`
                                // since the browser default is to focus on `pointerdown` then set the
                                // selection on `pointerup`. However, on initial tap we want to focus
                                // everything (we call `inputElement.select()` in `onOpenChange`) so the
                                // browser changing the selection in `pointerup` breaks that.
                                if (
                                    !isReadOnly &&
                                    event.pointerType === "mouse" &&
                                    document.activeElement !== event.target
                                ) {
                                    event.preventDefault();
                                    comboBoxState.open();
                                }
                            }}
                        />
                    </div>
                </FocusRing>
            </OverlayAnimated>
        </div>
    );
}
