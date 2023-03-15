import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {CaretDown, MagnifyingGlass} from "phosphor-react";
import {RefObject, useEffect, useMemo, useRef, useState} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useExpensivelyLoadAllSpaceAccounts} from "~/client/spaces/space_context";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {isId} from "~/shared/id/id";
import {AccountId, ChatId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
    sprinkles,
} from "~/shared/styles/styles";

type ChatAccountPickerItem = {
    readonly key: string;
    readonly account: AccountModel;
};

export function ChatAccountPicker() {
    const [selection, setSelection] = useState<{
        readonly chatId: ChatId | null;
        readonly accounts: ReadonlyArray<AccountModel>;
    } | null>(null);

    const allAccounts = useExpensivelyLoadAllSpaceAccounts();

    const accountById = useMemo(
        () => new Map((allAccounts?.accounts ?? []).map(account => [account.id, account])),
        [allAccounts?.accounts],
    );

    const [{searchQuery, shouldCloseComboBox}, setSearchQuery] = useState<{
        searchQuery: string;
        shouldCloseComboBox: boolean;
    }>({searchQuery: "", shouldCloseComboBox: false});

    const searchedAccounts: ReadonlyArray<AccountModel> = useMemo(() => {
        if (!allAccounts) return [];

        let searchedAccounts =
            searchQuery === ""
                ? allAccounts.accounts
                : allAccounts.fuse.search(searchQuery).map(({item}) => item);

        // Remove accounts that were already selected from the search.
        if (selection)
            searchedAccounts = searchedAccounts.filter(account1 =>
                selection.accounts.every(account2 => account1.id !== account2.id),
            );

        return searchedAccounts;
    }, [allAccounts, searchQuery, selection]);

    // When this is set to true we allow the next animation then no more
    // animations. Most interactions that control whether the picker is open/close
    // are direct interactions that shouldn't be animated.
    const [shouldOverlayAnimate, setShouldOverlayAnimate] = useState(false);
    useEffect(() => {
        if (!shouldOverlayAnimate) return;

        const timeout = createTimeout(() => {
            setShouldOverlayAnimate(false);
        }, Math.max(overlayFadeInAnimationDurationMs, overlayFadeOutAnimationDurationMs));
        return () => {
            timeout.clear();
        };
    }, [shouldOverlayAnimate]);

    const comboBoxProps: ComboBoxStateOptions<ChatAccountPickerItem> = {
        label: "To:",
        menuTrigger: "focus",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue: searchQuery,
        onInputChange: searchQuery => setSearchQuery({searchQuery, shouldCloseComboBox: false}),

        items: searchedAccounts.map(account => ({key: account.id, account})) ?? [],
        children: ({account}) => (
            <Item textValue={account.name}>
                <Box display="flex" alignItems="center" gap="2">
                    <AccountAvatar account={account} size="6" />
                    <Box fontStyle="truncate">{account.name}</Box>
                </Box>
            </Item>
        ),

        // Animate when the combobox loses focus. Losing focus is typically not a
        // direct user interaction. e.g. Clicking outside of the text box. Tabbing out
        // of the text box we consider an indirect interaction since the animation can
        // highlight to the user that their state is going away.
        onBlur: () => setShouldOverlayAnimate(true),

        // No key is ever selected by the combobox. Instead when a selection occurs we
        // add it to a list of selected values.
        selectedKey: null,
        onSelectionChange: key => {
            setSearchQuery({searchQuery: "", shouldCloseComboBox: true});

            if (typeof key === "string" && isId<AccountId>(key)) {
                const account = accountById.get(key);

                if (account) {
                    setSelection(selection => {
                        // If the account already exists in the selection, don't add it a second time.
                        if (
                            selection?.accounts.some(otherAccount => otherAccount.id === account.id)
                        ) {
                            return selection;
                        }

                        return {
                            chatId: null,
                            accounts: [...(selection?.accounts ?? []), account],
                        };
                    });
                }
            }
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    // We can only close the combobox after we render with our new search query. So
    // watch our state for when a close is requested and perform it.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldCloseComboBox) return;
        comboBoxState.close();
        setSearchQuery({searchQuery, shouldCloseComboBox: false});
    }, [comboBoxState, searchQuery, shouldCloseComboBox]);

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
        comboBoxState,
    );

    return (
        <OverlayAnimated
            isVisible={comboBoxState.isOpen}
            disableAnimation={!shouldOverlayAnimate}
            placement="bottom-start"
            sameWidth={true}
            offset="-1"
            overlay={
                <Box ref={popoverRef} position="relative">
                    <ChatAccountMemberPickerListBox
                        comboBoxState={comboBoxState}
                        listBoxRef={listBoxRef}
                        listBoxProps={listBoxProps}
                    />
                </Box>
            }
        >
            <FocusRing
                isVisibleWhenFocusWithin={true}
                // Render below the listbox overlay.
                overlayZIndex="-10"
                // If we are selecting an item within the combobox show a focus ring there,
                // not here.
                isDisabled={
                    comboBoxState.isOpen && comboBoxState.selectionManager.focusedKey !== null
                }
            >
                <Box
                    position="relative"
                    // Border radius for the focus ring
                    borderTopRadius={{desktop: "md"}}
                >
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
            </FocusRing>
        </OverlayAnimated>
    );
}

function ChatAccountMemberPickerListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    comboBoxState: ComboBoxState<ChatAccountPickerItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<ChatAccountPickerItem>;
}) {
    const {listBoxProps} = useListBox(_listBoxProps, comboBoxState, listBoxRef);

    return (
        <ul
            {...listBoxProps}
            ref={listBoxRef}
            className={sprinkles({
                borderRadius: "md",
                padding: "1",
                marginX: "2",
                backgroundColor: {light: "grey-0", dark: "grey-5"},
                boxShadow: "elevation-20",
                maxHeight: "64",
                overflowX: "hidden",
                overflowY: "scroll",
            })}
        >
            {comboBoxState.collection.size === 0 ? (
                <Box
                    paddingX="1.5"
                    paddingY="1.5"
                    display="flex"
                    alignItems="center"
                    gap="2"
                    color="grey-70"
                >
                    <Box padding="1">
                        <MagnifyingGlass size={spacing["4"]} />
                    </Box>
                    <Box>No results</Box>
                </Box>
            ) : (
                Array.from(comboBoxState.collection, item => (
                    <ChatAccountMemberPickerListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                    />
                ))
            )}
        </ul>
    );
}

function ChatAccountMemberPickerListBoxOption({
    comboBoxState,
    item,
}: {
    comboBoxState: ComboBoxState<ChatAccountPickerItem>;
    item: Node<ChatAccountPickerItem>;
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

    return (
        <FocusRing offset="0" isVisible={isFocused && wasFocusVisibleWhenFocused}>
            <li
                {...mergeProps(optionProps, hoverProps)}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    paddingX: "1.5",
                    paddingY: "1.5",
                    borderRadius: "base",
                    color: "grey-text",
                    backgroundColor: isPressed
                        ? {light: "grey-10", dark: "grey-20"}
                        : isHovered
                        ? {light: "grey-5", dark: "grey-10"}
                        : undefined,
                })}
            >
                {item.rendered}
            </li>
        </FocusRing>
    );
}
