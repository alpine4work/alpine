import {isFocusVisible, usePress} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {Check, MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
    useOverlayTrigger,
} from "react-aria";
import {ComboBoxState, Item, useListState, useOverlayTriggerState} from "react-stately";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {useOutsidePress} from "~/client/design/helpers/use_outside_press";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {defaultTooltipOffset} from "~/client/design/tooltip";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {Spacing, addRemLengths, spacing} from "~/shared/design/spacing";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {noop} from "~/shared/helpers/control/noop";
import {
    colorSchemeVars,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles";

export type TaskQueryFilterEditorMultiSelectComboBoxItem<Key extends string> = {
    readonly key: Key;
    readonly textValue: string;
    readonly node: ReactNode;
};

export function TaskQueryFilterEditorMultiSelectComboBox<Key extends string>({
    inputLabel,
    preview,
    selectedKeys,
    onSelectedKeysChange,
    useSearchedItems,
    optionCheckboxMarginTop,
}: {
    inputLabel: string;
    preview: ReactNode;
    selectedKeys: ReadonlySet<Key>;
    onSelectedKeysChange: (selectedKeys: ReadonlySet<Key>) => void;
    useSearchedItems: (searchInputValue: string) =>
        | {
              isLoading: false;
              searchedItems: ReadonlyArray<TaskQueryFilterEditorMultiSelectComboBoxItem<Key>>;
          }
        | {isLoading: true};
    optionCheckboxMarginTop?: Spacing;
}) {
    const overlayTriggerState = useOverlayTriggerState({});

    const triggerRef = useRef<HTMLButtonElement>(null);
    const {
        triggerProps: {onPressStart, onPress, ...triggerProps},
        overlayProps,
    } = useOverlayTrigger({type: "listbox"}, overlayTriggerState, triggerRef);
    const {pressProps, isPressed} = usePress({onPressStart, onPress});
    const {hoverProps, isHovered} = useHover({});

    // When this is set to true we allow the next animation then no more
    // animations. Most interactions that control whether the picker is open/close
    // are direct interactions that shouldn't be animated.
    const [shouldOverlayAnimateOut, setShouldOverlayAnimateOut] = useState(false);
    useEffect(() => {
        if (!shouldOverlayAnimateOut) return;

        const timeout = createTimeout(() => {
            setShouldOverlayAnimateOut(false);
        }, overlayFadeOutAnimationDurationMs);
        return () => {
            timeout.clear();
        };
    }, [shouldOverlayAnimateOut]);

    return (
        <OverlayAnimated
            isVisible={overlayTriggerState.isOpen}
            placement="bottom-start"
            offset={defaultTooltipOffset}
            disableAnimationIn={true}
            disableAnimationOut={!shouldOverlayAnimateOut}
            overlay={
                <Box
                    {...overlayProps}
                    ref={useOutsidePress(event => {
                        // Clicking on the trigger button is not an outside press. Let
                        // `useOverlayTrigger()` handle that.
                        if (assertExists(triggerRef.current).contains(event.target as Element)) {
                            return;
                        }

                        setShouldOverlayAnimateOut(true);
                        overlayTriggerState.close();
                    })}
                    width="64"
                    maxHeight="96"
                    overflow="hidden"
                    borderRadius="md"
                    backgroundColor={{light: "grey-0", dark: "grey-5"}}
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                >
                    <TaskQueryFilterEditorMultiSelectComboBoxOverlay
                        inputLabel={inputLabel}
                        selectedKeys={selectedKeys}
                        onSelectedKeysChange={onSelectedKeysChange}
                        useSearchedItems={useSearchedItems}
                        onCloseWithoutAnimation={() => overlayTriggerState.close()}
                        optionCheckboxMarginTop={optionCheckboxMarginTop ?? null}
                    />
                </Box>
            }
        >
            <FocusRing offset="0">
                <button
                    {...mergeProps(triggerProps, pressProps, hoverProps)}
                    ref={triggerRef}
                    className={sprinkles({
                        height: "full",
                    })}
                    style={{
                        paddingTop: 1,
                        paddingBottom: 1,
                    }}
                >
                    <span
                        className={sprinkles({
                            height: "full",
                            minWidth: "4",
                            paddingX: "1",
                            display: "flex",
                            alignItems: "center",
                            // The hit radius for this button extends within the entire filter editor but
                            // the background color style has some inset.
                            backgroundColor: isPressed
                                ? "grey-10"
                                : isHovered
                                ? "grey-5"
                                : undefined,
                            borderRadius: "sm",
                        })}
                    >
                        {preview}
                    </span>
                </button>
            </FocusRing>
        </OverlayAnimated>
    );
}

function TaskQueryFilterEditorMultiSelectComboBoxOverlay<Key extends string>({
    inputLabel,
    selectedKeys,
    onSelectedKeysChange,
    useSearchedItems,
    onCloseWithoutAnimation,
    optionCheckboxMarginTop,
}: {
    inputLabel: string;
    selectedKeys: ReadonlySet<Key>;
    onSelectedKeysChange: (selectedKeys: ReadonlySet<Key>) => void;
    useSearchedItems: (searchInputValue: string) =>
        | {
              isLoading: false;
              searchedItems: ReadonlyArray<TaskQueryFilterEditorMultiSelectComboBoxItem<Key>>;
          }
        | {isLoading: true};
    onCloseWithoutAnimation: () => void;
    optionCheckboxMarginTop: Spacing | null;
}) {
    const [inputValue, setInputValue] = useState("");

    const searchedItemsResult = useSearchedItems(inputValue);
    const searchedItems = searchedItemsResult.isLoading
        ? emptyArray
        : searchedItemsResult.searchedItems;

    const renderItem = (item: TaskQueryFilterEditorMultiSelectComboBoxItem<Key>) => (
        <Item textValue={item.textValue}>{item.node}</Item>
    );

    const {collection, selectionManager, disabledKeys} = useListState({
        items: searchedItems,
        children: renderItem,

        selectionMode: "multiple",
        selectedKeys,
        onSelectionChange: selectedKeys => {
            // Ignore "all" selections. Doesn't make sense for this input.
            if (selectedKeys === "all") return;

            onSelectedKeysChange(selectedKeys as Set<Key>);
            onCloseWithoutAnimation();
        },
    });

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const comboBoxState: ComboBoxState<TaskQueryFilterEditorMultiSelectComboBoxItem<Key>> = {
        inputValue,
        setInputValue,

        commit: () => {
            selectionManager.select(selectionManager.focusedKey);
        },
        revert: () => {
            setInputValue("");
            onCloseWithoutAnimation();
        },

        // Always open
        isOpen: true,
        setOpen: noop,
        open: noop,
        close: noop,
        toggle: noop,
        focusStrategy: "first",

        isFocused: selectionManager.isFocused,
        setFocused: isFocused => selectionManager.setFocused(isFocused),

        // We use multiple selection, there is never one selected key.
        selectedKey: null as any,
        selectedItem: null as any,
        setSelectedKey: key => selectionManager.select(key),

        collection,
        selectionManager,
        disabledKeys,
    };

    const {inputProps, listBoxProps} = useComboBox(
        {
            "aria-label": inputLabel,
            inputRef,
            popoverRef,
            listBoxRef,
            autoFocus: false,
            shouldFocusWrap: false,
            items: searchedItems,
            children: renderItem,
        },
        comboBoxState,
    );

    // Autofocus our input when the overlay opens.
    const hasInitiallyRenderedRef = useRef(false);
    useLayoutEffect(() => {
        if (hasInitiallyRenderedRef.current) return;
        hasInitiallyRenderedRef.current = true;

        assertExists(inputRef.current).focus();
    }, []);

    return (
        <>
            <FocusRing offset="border">
                <input
                    {...inputProps}
                    ref={inputRef}
                    className={sprinkles({
                        flexShrink: "0",
                        display: "block",
                        width: "full",
                        height: "8",
                        paddingX: "2.5",
                        backgroundColor: "transparent",
                        borderTopRadius: "md",
                        borderBottom: "grey-10",
                    })}
                    placeholder={inputLabel}
                />
            </FocusRing>
            <Box
                ref={popoverRef}
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
            >
                {searchedItemsResult.isLoading ? (
                    <Box paddingY="7" display="flex" justifyContent="center">
                        <SpinnerGap
                            className={spinAnimationClassName}
                            color={colorSchemeVars["grey-70"]}
                            size={spacing["4"]}
                        />
                    </Box>
                ) : (
                    <TaskQueryFilterEditorMultiSelectListBox
                        comboBoxState={comboBoxState}
                        listBoxRef={listBoxRef}
                        listBoxProps={listBoxProps}
                        optionCheckboxMarginTop={optionCheckboxMarginTop}
                    />
                )}
            </Box>
        </>
    );
}

function TaskQueryFilterEditorMultiSelectListBox<Key extends string>({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    optionCheckboxMarginTop,
}: {
    comboBoxState: ComboBoxState<TaskQueryFilterEditorMultiSelectComboBoxItem<Key>>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskQueryFilterEditorMultiSelectComboBoxItem<Key>>;
    optionCheckboxMarginTop: Spacing | null;
}) {
    const {listBoxProps} = useListBox(
        {..._listBoxProps, autoFocus: false},
        comboBoxState,
        listBoxRef,
    );

    return (
        <ul
            {...listBoxProps}
            ref={listBoxRef}
            className={sprinkles({
                flexGrow: "1",
                padding: "1",
                overflowX: "hidden",
                overflowY: "scroll",
            })}
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
                    <TaskQueryFilterEditorMultiSelectListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                        optionCheckboxMarginTop={optionCheckboxMarginTop}
                    />
                ))
            )}
        </ul>
    );
}

function TaskQueryFilterEditorMultiSelectListBoxOption<Key extends string>({
    comboBoxState,
    item,
    optionCheckboxMarginTop,
}: {
    comboBoxState: ComboBoxState<TaskQueryFilterEditorMultiSelectComboBoxItem<Key>>;
    item: Node<TaskQueryFilterEditorMultiSelectComboBoxItem<Key>>;
    optionCheckboxMarginTop: Spacing | null;
}) {
    const optionRef = useRef(null);
    const {isHovered, hoverProps} = useHover({});
    const {optionProps, isFocused, isPressed, isSelected} = useOption(
        {key: item.key},
        comboBoxState,
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

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
                    backgroundColor: isPressed
                        ? {light: "grey-10", dark: "grey-20"}
                        : isHovered
                        ? {light: "grey-5", dark: "grey-10"}
                        : undefined,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "1.5",
                })}
            >
                <Box
                    alignSelf={optionCheckboxMarginTop === null ? "stretch" : undefined}
                    paddingTop={
                        optionCheckboxMarginTop !== null ? optionCheckboxMarginTop : undefined
                    }
                    display="flex"
                    alignItems="center"
                >
                    <Box
                        width="3"
                        height="3"
                        border={!isSelected ? "grey-20" : undefined}
                        borderRadius="sm"
                        backgroundColor={
                            !isSelected ? "grey-0" : {light: "grey-80", dark: "grey-90"}
                        }
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                    >
                        {isSelected && (
                            <Check
                                color={colorSchemeVars["grey-0"]}
                                weight="bold"
                                size={addRemLengths(spacing["2"], spacing["0.5"])}
                            />
                        )}
                    </Box>
                </Box>
                {item.rendered}
            </li>
        </FocusRing>
    );
}
