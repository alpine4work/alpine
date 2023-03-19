import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import Fuse from "fuse.js";
import {CaretDown, MagnifyingGlass, SpinnerGap, X} from "phosphor-react";
import {KeyboardEvent, RefObject, createRef, useEffect, useMemo, useRef, useState} from "react";
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
import {useExpensivelyLoadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {isId} from "~/shared/id/id";
import {AccountId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {
    colorSchemeVars,
    fontSizes,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles";

type ChatAccountPickerItem = {
    readonly key: string;
    readonly account: AccountModel;
};

export function ChatAccountPicker({
    selectedAccounts,
    onUpdateSelectedAccounts,
    shouldShowPendingSpinner,
}: {
    selectedAccounts: ReadonlyArray<AccountModel>;
    onUpdateSelectedAccounts: (
        update: (selectedAccounts: ReadonlyArray<AccountModel>) => ReadonlyArray<AccountModel>,
    ) => void;
    shouldShowPendingSpinner: boolean;
}) {
    const _allAccounts = useExpensivelyLoadAllSpaceAccounts();

    const allAccounts = useMemo(() => {
        if (!_allAccounts) return null;

        const accountById = new Map<AccountId, AccountModel>();

        // Sort accounts by name using the user's current locale. Ideally we would sort
        // by relevance to the user but this is the simple thing to do for now.
        const accounts = Array.from(_allAccounts, account => {
            accountById.set(account.id, account);
            return account;
        }).sort((account1, account2) => account1.name.localeCompare(account2.name));

        // Build Fuse search index...
        const fuse = new Fuse(accounts, {keys: ["name"], includeScore: true});

        return {accountById, accounts, fuse};
    }, [_allAccounts]);

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
        if (selectedAccounts.length > 0)
            searchedAccounts = searchedAccounts.filter(account1 =>
                selectedAccounts.every(account2 => account1.id !== account2.id),
            );

        return searchedAccounts;
    }, [allAccounts, searchQuery, selectedAccounts]);

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
        menuTrigger: "input",
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
                const account = allAccounts?.accountById.get(key);

                if (account) {
                    onUpdateSelectedAccounts(selectedAccounts => {
                        // If the account already exists in the selection, don't add it a second time.
                        if (selectedAccounts.some(otherAccount => otherAccount.id === account.id)) {
                            return selectedAccounts;
                        }
                        return [...selectedAccounts, account];
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
            onKeyDown: event => {
                assert(event.currentTarget instanceof HTMLInputElement);
                switch (event.key) {
                    // If we are at the beginning of the combobox text input, the backspace key
                    // will delete the last selected account.
                    case "Backspace": {
                        if (
                            selectedAccounts.length > 0 &&
                            event.currentTarget.selectionStart ===
                                event.currentTarget.selectionEnd &&
                            event.currentTarget.selectionStart === 0
                        ) {
                            event.preventDefault();
                            onUpdateSelectedAccounts(selectedAccounts => {
                                if (selectedAccounts.length === 0) return selectedAccounts;
                                return selectedAccounts.slice(0, -1);
                            });
                        }
                        break;
                    }
                    // If we are at the beginning of the combobox text input, the arrow left key
                    // will focus a previously selected account if we have one.
                    case "ArrowLeft": {
                        if (
                            selectedAccountRefs.length > 0 &&
                            event.currentTarget.selectionStart ===
                                event.currentTarget.selectionEnd &&
                            event.currentTarget.selectionStart === 0
                        ) {
                            event.preventDefault();
                            selectedAccountRefs[selectedAccountRefs.length - 1]?.current?.focus();
                        }
                        break;
                    }
                }
            },
        },
        comboBoxState,
    );

    const selectedAccountsLength = selectedAccounts.length;
    const selectedAccountRefs = useMemo(
        () => createArrayWithLength(selectedAccountsLength, () => createRef<HTMLDivElement>()),
        [selectedAccountsLength],
    );

    const selectedAccountsChildren = selectedAccounts.map((account, index) => {
        const deleteAccount = () => {
            onUpdateSelectedAccounts(selectedAccounts => {
                const newSelectedAccounts = selectedAccounts.filter(
                    otherAccount => otherAccount.id !== account.id,
                );
                return newSelectedAccounts.length !== selectedAccounts.length
                    ? newSelectedAccounts
                    : selectedAccounts;
            });
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            switch (event.key) {
                // Backspace or delete will remove our selected account.
                case "Backspace":
                case "Delete": {
                    event.preventDefault();
                    deleteAccount();
                    if (index + 1 < selectedAccountRefs.length) {
                        selectedAccountRefs[index + 1]?.current?.focus();
                    } else {
                        inputRef.current?.focus();
                    }
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected
                // account is focusable since you use arrow keys to navigate between accounts.
                case "ArrowLeft": {
                    event.preventDefault();
                    selectedAccountRefs[index - 1]?.current?.focus();
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected
                // account is focusable since you use arrow keys to navigate between accounts.
                case "ArrowRight": {
                    event.preventDefault();
                    if (index + 1 < selectedAccountRefs.length) {
                        selectedAccountRefs[index + 1]?.current?.focus();
                    } else {
                        inputRef.current?.focus();
                    }
                    break;
                }
                default: {
                    // If the user presses a letter then interpret that as the user trying to
                    // replace the focused account. So delete the selected account and add the text
                    // to our search input.
                    if (/^[0-9a-zA-Z]$/.test(event.key)) {
                        event.preventDefault();
                        deleteAccount();
                        setSearchQuery(({searchQuery}) => ({
                            searchQuery: searchQuery + event.key,
                            shouldCloseComboBox: false,
                        }));
                        inputRef.current?.focus();
                    }
                    break;
                }
            }
        };

        return (
            <FocusRing key={account.id}>
                <Box
                    ref={selectedAccountRefs[index]}
                    cursor="default"
                    height="6"
                    backgroundColor="grey-5"
                    borderRadius="full"
                    display="flex"
                    alignItems="center"
                    // The first selected account is focusable via tab and you can use arrow keys
                    // to focus the others.
                    tabIndex={index === 0 ? 0 : -1}
                    onKeyDown={handleKeyDown}
                >
                    <Box paddingLeft="0.5">
                        <AccountAvatar size="5" account={account} />
                    </Box>
                    <Box paddingLeft="1.5" paddingRight="0.5" fontSize="100">
                        {account.name}
                    </Box>
                    <Box paddingRight="1">
                        <IconButton
                            size="xs"
                            variant="quiet-on-grey-5-background"
                            // The user focuses the pill as a whole and hits the delete key to delete using
                            // the keyboard.
                            disableKeyboardFocus={true}
                            description="Remove"
                            withoutTooltip={true}
                            onPress={deleteAccount}
                        >
                            <X size={addRemLengths(spacing["2"], spacing["0.5"])} />
                        </IconButton>
                    </Box>
                </Box>
            </FocusRing>
        );
    });

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
                offset="inset"
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
                    // Border radius for the focus ring
                    borderTopRadius={{desktop: "md"}}
                    display="flex"
                    alignItems="flex-start"
                >
                    <label
                        {...labelProps}
                        className={sprinkles({
                            flexShrink: "0",
                            display: "flex",
                            alignItems: "center",
                            height: "10",
                            paddingLeft: "4",
                            paddingRight: "3",
                            fontSize: "100",
                            color: "grey-50",
                        })}
                    >
                        {comboBoxProps.label}
                    </label>
                    <Box
                        flexGrow="1"
                        display="flex"
                        flexWrap="wrap"
                        gap="1.5"
                        paddingY="2"
                        cursor="text"
                        onClick={event => {
                            if (event.currentTarget === event.target) {
                                assertExists(inputRef.current).focus();

                                // Make sure to open the combobox as well as an affordance for pointer users.
                                comboBoxState.open();
                            }
                        }}
                    >
                        {selectedAccountsChildren}
                        <input
                            {...inputProps}
                            ref={inputRef}
                            className={sprinkles({
                                flexGrow: "1",
                                display: "block",
                                minWidth: searchQuery.length > 0 ? "48" : "4",
                                fontSize: "100",
                            })}
                            style={{
                                background: "none",
                                paddingTop: `${
                                    (parseRemLengthNumber(spacing["6"]) -
                                        parseRemLengthNumber(fontSizes["100"].lineHeight)) /
                                    2
                                }rem`,
                                paddingBottom: `${
                                    (parseRemLengthNumber(spacing["6"]) -
                                        parseRemLengthNumber(fontSizes["100"].lineHeight)) /
                                    2
                                }rem`,
                            }}
                            placeholder={
                                selectedAccounts.length === 0
                                    ? "Who do you want to send a message to?"
                                    : undefined
                            }
                            // By default `<input>` elements have a `min-width` determined by the `size`
                            // property. We want our `<input>`s `min-width` to be determined by our CSS
                            // so set it to a small value as not to matter.
                            // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                            size={1}
                            // Open the combobox when the user presses on the input as an affordance for
                            // pointer users. For keyboard users you need to press an arrow key or type.
                            //
                            // This has the added benefit of allowing the user to open the combobox again
                            // while the input is focused if they are quickly selecting accounts to message
                            // with their pointer.
                            onPointerDown={() => {
                                comboBoxState.open();
                            }}
                        />
                    </Box>
                    <Box flexShrink="0" padding="3" display="flex" alignItems="center" gap="2">
                        <Box width="4" height="4">
                            {shouldShowPendingSpinner && (
                                <SpinnerGap
                                    className={spinAnimationClassName}
                                    color={colorSchemeVars["grey-70"]}
                                    size={spacing["4"]}
                                />
                            )}
                        </Box>
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
