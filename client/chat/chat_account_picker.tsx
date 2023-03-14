import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {CaretDown} from "phosphor-react";
import {RefObject, useRef, useState} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {sprinkles} from "~/shared/styles/styles";

type ChatAccountPickerItem = {
    key: number;
};

export function ChatAccountPicker() {
    const comboBoxProps: ComboBoxStateOptions<ChatAccountPickerItem> = {
        label: "To:",
        menuTrigger: "focus",
        items: [{key: 1}, {key: 2}, {key: 3}],
        children: () => <Item>Item</Item>,
    };

    const state = useComboBoxState(comboBoxProps);

    const inputRef = useRef<HTMLInputElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const {labelProps, inputProps, buttonProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            inputRef,
            buttonRef,
            popoverRef,
            listBoxRef,
        },
        state,
    );

    return (
        <OverlayAnimated
            isVisible={state.isOpen}
            placement="bottom-start"
            sameWidth={true}
            offset="-1"
            overlay={
                <Box ref={popoverRef}>
                    <ChatAccountMemberPickerListBox
                        state={state}
                        listBoxRef={listBoxRef}
                        listBoxProps={listBoxProps}
                    />
                </Box>
            }
        >
            <Box position="relative">
                <label
                    {...labelProps}
                    className={sprinkles({
                        position: "absolute",
                        left: "4",
                        paddingY: "3",
                        fontSize: "100",
                        color: "grey-50",
                        pointerEvents: "none",
                    })}
                >
                    {comboBoxProps.label}
                </label>
                <input
                    {...inputProps}
                    ref={inputRef}
                    className={sprinkles({
                        width: "full",
                        fontSize: "100",
                        paddingY: "3",
                        paddingLeft: "12",
                        paddingRight: "10",
                    })}
                    style={{background: "none"}}
                    placeholder="Who do you want to send a message to?"
                />
                <Box
                    position="absolute"
                    right="3"
                    // Really tiny detail: Click boundaries of the container should be the same as
                    // the button so that clicking the corners selects the text box.
                    borderRadius="full"
                    style={{top: addRemLengths(spacing["3"], spacing["0.5"])}}
                >
                    <IconButton
                        {...buttonProps}
                        ref={buttonRef}
                        size="xs"
                        description="Toggle"
                        withoutTooltip={true}
                    >
                        <CaretDown />
                    </IconButton>
                </Box>
            </Box>
        </OverlayAnimated>
    );
}

function ChatAccountMemberPickerListBox({
    state,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    state: ComboBoxState<ChatAccountPickerItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<ChatAccountPickerItem>;
}) {
    const {listBoxProps} = useListBox(_listBoxProps, state, listBoxRef);

    return (
        <ul
            {...listBoxProps}
            ref={listBoxRef}
            className={sprinkles({
                borderRadius: "md",
                padding: "1",
                marginX: "2",
                backgroundColor: {light: "grey-0", dark: "grey-5"},
                border: {light: "grey-0", dark: "grey-10"},
                boxShadow: "elevation-20",
            })}
        >
            {Array.from(state.collection, item => (
                <ChatAccountMemberPickerListBoxOption key={item.key} state={state} item={item} />
            ))}
        </ul>
    );
}

function ChatAccountMemberPickerListBoxOption({
    state,
    item,
}: {
    state: ComboBoxState<ChatAccountPickerItem>;
    item: Node<ChatAccountPickerItem>;
}) {
    const optionRef = useRef(null);
    const {isHovered, hoverProps} = useHover({});
    const {optionProps, isFocused, isPressed} = useOption({key: item.key}, state, optionRef);

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
                    paddingX: "2",
                    paddingY: "1",
                    borderRadius: "base",
                    color: "grey-text",
                    backgroundColor: isPressed
                        ? {light: "grey-10", dark: "grey-20"}
                        : isHovered
                        ? {light: "grey-5", dark: "grey-10"}
                        : undefined,
                    display: "flex",
                })}
            >
                <Box flexGrow="1" fontStyle="truncate">
                    {item.rendered}
                </Box>
            </li>
        </FocusRing>
    );
}
