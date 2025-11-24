import {
    getInteractionModality,
    isFocusVisible,
    setInteractionModality,
    usePress,
} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import classNames from "classnames";
import _Fuse from "fuse.js";
import {CaretDown, MagnifyingGlass, SpinnerGap, X} from "phosphor-react";
import {
    KeyboardEvent,
    RefObject,
    cloneElement,
    createRef,
    isValidElement,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {AriaListBoxOptions, useComboBox, useListBox, useOption} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useIdlyPreloadRpc, useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    fontSizes,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {parseRemLength, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

type ChatAccountPickerItem =
    | {
          readonly type: "Account";
          readonly key: `Account:${AccountId}`;
          readonly textValue: string;
          readonly accountData: AccountModelData;
      }
    | {
          readonly type: "Chat";
          readonly key: `Chat:${ChatId}`;
          readonly textValue: string;
          readonly chat: ChatModel;
          readonly otherAccountDatas: ReadonlyArray<AccountModelData>;
      };

export function ChatAccountPicker({
    selectedAccounts,
    onUpdateSelectedAccounts,
    shouldShowPendingSpinner,
    suggestedChats,
    shouldInitiallyFocus,
    focusMessageInput,
}: {
    selectedAccounts: ReadonlyArray<AccountModel>;
    onUpdateSelectedAccounts: (
        update: (selectedAccounts: ReadonlyArray<AccountModel>) => ReadonlyArray<AccountModel>,
    ) => void;
    shouldShowPendingSpinner: boolean;
    suggestedChats: ReadonlyArray<ChatModel>;
    shouldInitiallyFocus: boolean;
    focusMessageInput: () => void;
}) {
    const platform = usePlatform();
    const accountRegistry = useAccountRegistry();
    const {space, currentAccount} = useSpaceContext();

    const inputRef = useRef<HTMLInputElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const inputElement = assertExists(inputRef.current);

        if (!shouldInitiallyFocus) return;

        return scheduleAfterNavigationAnimation(() => {
            inputElement.focus();
        });
    }, [shouldInitiallyFocus]);

    // Preload accounts since we don't load accounts until the dropdown is open.
    useIdlyPreloadRpc(expensivelyGetAllSpaceAccounts, currentAccount ? {spaceId: space.id} : null);

    const [isComboBoxOpen, setIsComboBoxOpen] = useState(false);

    const allAccounts =
        useLazyLoadRpc(
            expensivelyGetAllSpaceAccounts,
            selectedAccounts.length === 0 || isComboBoxOpen ? {spaceId: space.id} : null,
        ).output?.accounts ?? emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allAccounts]);

    const suggestedChatById = useMemo(() => {
        const suggestedChatById = new Map<ChatId, ChatModel>();
        for (const chat of suggestedChats) suggestedChatById.set(chat.id, chat);
        return suggestedChatById;
    }, [suggestedChats]);

    const allItemsStore = useMemo(() => {
        const itemStores: Array<Store<ChatAccountPickerItem>> = [];

        for (const chat of suggestedChats) {
            assert(chat.accounts.length > 0);

            const otherAccounts = chat.accounts.filter(
                account => account.id !== currentAccount?.id,
            );

            itemStores.push(
                Store.mapMany(
                    otherAccounts.map(account => accountRegistry.getAccountStore(account)),
                    (otherAccountDatas): ChatAccountPickerItem => {
                        const otherAccountNames = joinPrettyConjunctionList(
                            otherAccountDatas.map(accountData =>
                                getAccountShortNameWithoutFullNameTooltip(accountData),
                            ),
                        );

                        return {
                            type: "Chat",
                            key: `Chat:${chat.id}`,
                            textValue: otherAccountNames,
                            chat,
                            otherAccountDatas,
                        };
                    },
                ),
            );
        }

        for (const account of allAccounts) {
            itemStores.push(
                accountRegistry
                    .getAccountStore(account)
                    .map((accountData): ChatAccountPickerItem => {
                        return {
                            type: "Account",
                            key: `Account:${account.id}`,
                            textValue: accountData.name,
                            accountData,
                        };
                    }),
            );
        }

        return Store.mapMany(itemStores, items =>
            items.slice().sort((item1, item2) => {
                if (item1.type === "Chat" && item2.type === "Chat") return 0;
                if (item1.type === "Chat") return -1;
                if (item2.type === "Chat") return 1;

                // Use the sort order from the server. The server returns accounts in
                // affinity order.
                return 0;
            }),
        );
    }, [accountRegistry, allAccounts, currentAccount?.id, suggestedChats]);

    const allItems = useStore(allItemsStore);

    // Remove items that match our selection. Items should help the user
    // autocomplete. Items that won't add to their selection are not useful.
    const itemsWithoutSelection = useMemo(() => {
        const selectedAccountIds = new Set(selectedAccounts.map(account => account.id));

        return allItems.filter(item => {
            switch (item.type) {
                // If an account has been selected, don't show it anymore.
                case "Account": {
                    return !selectedAccountIds.has(item.accountData.id);
                }
                // At least one account in the recommended chat should not already be selected
                // for it to show up.
                case "Chat": {
                    return item.otherAccountDatas.some(
                        accountData => !selectedAccountIds.has(accountData.id),
                    );
                }
                default:
                    throw exhaustive(item);
            }
        });
    }, [allItems, selectedAccounts]);

    const [{searchQuery, shouldCloseComboBox}, setSearchQuery] = useState<{
        searchQuery: string;
        shouldCloseComboBox: boolean;
    }>({searchQuery: "", shouldCloseComboBox: false});

    const itemsSearchIndex = useMemo(
        () => new Fuse(itemsWithoutSelection, {keys: ["textValue"]}),
        [itemsWithoutSelection],
    );

    const searchedItems = useMemo(
        () =>
            searchQuery === ""
                ? // Don't include removed accounts in the initial rendered account list.
                  //
                  // TODO(calebmer): When searching, removed accounts should rank lower. How do
                  // we give them a lower score while still allowing users to find them?
                  itemsWithoutSelection.filter(
                      item =>
                          item.type !== "Account" || item.accountData.space.state.type === "Active",
                  )
                : itemsSearchIndex.search(searchQuery).map(({item}) => item),

        [itemsSearchIndex, itemsWithoutSelection, searchQuery],
    );

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
        // We need to know whether the combobox is open or not to decide whether we
        // should load accounts.
        onOpenChange: setIsComboBoxOpen,

        label: "To",
        menuTrigger: "manual",
        // Don't try to close on blur when there are no selected accounts since the
        // combobox should state open.
        shouldCloseOnBlur: selectedAccounts.length > 0,
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue: searchQuery,
        onInputChange: searchQuery => {
            setSearchQuery({searchQuery, shouldCloseComboBox: false});

            if (!comboBoxState.isOpen) {
                comboBoxState.open();
            }
        },

        items: searchedItems,
        children: item => (
            <Item textValue={item.textValue}>
                <ChatAccountPickerListBoxOptionItem item={item} />
            </Item>
        ),

        onFocus: () => {
            // Open the combobox on focus.
            comboBoxState.open();
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

            // Animate when the combobox loses focus. Losing focus is typically not a
            // direct user interaction. e.g. Clicking outside of the text box. Tabbing out
            // of the text box we consider an indirect interaction since the animation can
            // highlight to the user that their state is going away.
            setShouldOverlayAnimate(true);
        },

        // No key is ever selected by the combobox. Instead when a selection occurs we
        // add it to a list of selected values.
        selectedKey: null,
        onSelectionChange: key => {
            setSearchQuery({searchQuery: "", shouldCloseComboBox: true});

            if (typeof key !== "string") return;

            if (key.startsWith("Account:")) {
                const account = accountById.get(assertId(key.slice("Account:".length)));
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

            if (key.startsWith("Chat:")) {
                const chat = suggestedChatById.get(assertId(key.slice("Chat:".length)));
                if (chat) {
                    onUpdateSelectedAccounts(selectedAccounts => {
                        const selectedAccountIds = new Set(
                            selectedAccounts.map(account => account.id),
                        );
                        return [
                            ...selectedAccounts,
                            // Select accounts from the chat object that haven't been selected yet,
                            // preserving the order of already selected accounts.
                            ...chat.accounts.filter(
                                account =>
                                    account.id !== currentAccount?.id &&
                                    !selectedAccountIds.has(account.id),
                            ),
                        ];
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

        // If there are no selected accounts, we don't ever want to close the combobox.
        if (selectedAccounts.length > 0) {
            comboBoxState.close();
        }

        setSearchQuery({searchQuery, shouldCloseComboBox: false});
    }, [comboBoxState, searchQuery, selectedAccounts.length, shouldCloseComboBox]);

    // If there are no selected accounts, we should always consider the combobox to
    // be open. Our `<Overlay>` component is set to always be visible if
    // `selectedAccounts.length === 0` even if `comboBoxState.isOpen` is false.
    // Catch up `comboBoxState` to this reality in an effect.
    //
    // NOTE(calebmer): Admittedly, this is pretty hacky! I think we've outgrown
    // `react-aria`'s `useCombobox()`. Ideally we'd write our own combobox logic
    // which has first-class support for always-open comboboxes.
    useEffect(() => {
        if (!comboBoxState.isOpen && selectedAccounts.length === 0) {
            comboBoxState.open();
            comboBoxState.selectionManager.setFocusedKey(null);
            if (listBoxRef.current?.parentElement) listBoxRef.current.parentElement.scrollTop = 0;
        }
    }, [comboBoxState, selectedAccounts.length]);

    const {labelProps, inputProps, buttonProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            inputRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            buttonRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            popoverRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            listBoxRef,
            onKeyDown: event => {
                assert(event.currentTarget instanceof HTMLInputElement);

                switch (event.key) {
                    case "ArrowDown":
                    case "ArrowUp":
                    case "Home":
                    case "End": {
                        setInteractionModality("keyboard");
                        break;
                    }

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
                            event.stopPropagation();

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
                            event.stopPropagation();
                            setInteractionModality("keyboard");
                            selectedAccountRefs[selectedAccountRefs.length - 1]?.current?.focus();
                        }
                        break;
                    }

                    case "Tab": {
                        event.preventDefault();
                        event.stopPropagation();

                        // HACK: We're programmatically moving focus, but we're just hijacking
                        // the tab key here, so we should make sure we maintain the
                        // correct interaction modality, but NOT show the focus ring for
                        // this action. Focus rings do not show in pointer modality.
                        const interactionModality = getInteractionModality();
                        setInteractionModality("pointer");
                        focusMessageInput();
                        setInteractionModality(interactionModality);
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

    const selectedAccountDatas = useStore(
        useMemo(
            () =>
                Store.mapMany(
                    selectedAccounts.map(account => accountRegistry.getAccountStore(account)),
                    accounts => accounts,
                ),
            [accountRegistry, selectedAccounts],
        ),
    );

    const selectedAccountsChildren = selectedAccountDatas.map((accountData, index) => {
        const deleteAccount = () => {
            onUpdateSelectedAccounts(selectedAccounts => {
                const newSelectedAccounts = selectedAccounts.filter(
                    otherAccount => otherAccount.id !== accountData.id,
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
                    event.stopPropagation();
                    setInteractionModality("keyboard");
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
                    event.stopPropagation();
                    setInteractionModality("keyboard");
                    selectedAccountRefs[index - 1]?.current?.focus();
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected
                // account is focusable since you use arrow keys to navigate between accounts.
                case "ArrowRight": {
                    event.preventDefault();
                    event.stopPropagation();
                    setInteractionModality("keyboard");
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
                        event.stopPropagation();
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
            <FocusRing key={accountData.id}>
                <Box
                    ref={selectedAccountRefs[index]}
                    cursor="default"
                    height="6"
                    backgroundColor="grey-5"
                    borderRadius="full"
                    display="flex"
                    alignItems="center"
                    tabIndex={index === 0 ? 0 : -1}
                    // On mobile we want taps to fallthrough and focus the combobox input instead of
                    // selecting the account. On mobile you can only press backspace to delete the
                    // last account, you can't delete a specific account (unless you have an
                    // external keyboard, then you can use arrow keys).
                    pointerEvents={platform !== "mobile" ? undefined : "none"}
                    onKeyDown={handleKeyDown}
                >
                    <Box paddingLeft="0.5">
                        <AccountAvatar size="5" account={accountData} />
                    </Box>
                    <Box
                        paddingLeft="1.5"
                        paddingRight={platform !== "mobile" ? "0.5" : "2"}
                        fontSize={{desktop: "100", mobile: "50"}}
                    >
                        {accountData.name}
                    </Box>
                    {platform !== "mobile" && (
                        // On mobile this button is too small. So the only way to delete people is via
                        // pressing backspace on the keyboard.
                        <Box paddingRight="0.5">
                            <IconButton
                                size="xs"
                                variant="quiet-above-grey-5-background"
                                // The user focuses the pill as a whole and hits the delete key to delete using
                                // the keyboard.
                                isTabbable={false}
                                description="Remove"
                                withoutTooltip={true}
                                onPress={deleteAccount}
                            >
                                <X size={spacing["2.5"]} />
                            </IconButton>
                        </Box>
                    )}
                </Box>
            </FocusRing>
        );
    });

    const {pressProps: backdropPressProps} = usePress({
        // Backdrop doesn't receive focus.
        preventFocusOnPress: true,

        onPressStart: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                assertExists(inputRef.current).focus();

                // As a convenience, if you tap on this element while it's already focused but
                // the combobox isn't open then open the combobox. After you select an option
                // the combobox closes but the user may want to select another account.
                if (!comboBoxState.isOpen) {
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

                // As a convenience, if you tap on this element while it's already focused but
                // the combobox isn't open then open the combobox. After you select an option
                // the combobox closes but the user may want to select another account.
                if (!comboBoxState.isOpen) {
                    comboBoxState.open();
                }
            }
        },
    });

    return (
        <OverlayAnimated
            // Force the overlay to be open if there are no selected accounts. In an effect
            // we call `comboBoxState.open()` even when `selectedAccounts.length` is 0 but
            // before that we want to make sure the overlay is visible so it doesn't
            // flash in.
            isVisible={comboBoxState.isOpen || selectedAccounts.length === 0}
            disableAnimationIn={true}
            disableAnimationOut={!shouldOverlayAnimate}
            placement="bottom-start"
            sameWidth={true}
            offset="-1"
            overlay={
                <Box ref={popoverRef} position="relative">
                    <ChatAccountPickerListBox
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
                <Box data-testid="ChatAccountPickerInput" display="flex" alignItems="flex-start">
                    <label
                        {...labelProps}
                        className={sprinkles({
                            flexShrink: "0",
                            display: "flex",
                            alignItems: "center",
                            // Smaller on mobile since we render the navigation bar above.
                            height: platform !== "mobile" ? "12" : "10",
                            paddingLeft: {desktop: "4", mobile: "2"},
                            paddingRight: {desktop: "3", mobile: "1.5"},
                            fontSize: {desktop: "100", mobile: "50"},
                            color: "grey-50",
                        })}
                    >
                        {comboBoxProps.label}
                        <span aria-hidden={true}>:</span>
                    </label>
                    <Box
                        position="relative"
                        zIndex="0"
                        flexGrow="1"
                        display="flex"
                        flexWrap="wrap"
                        rowGap="1.5"
                        columnGap={{desktop: "1.5", mobile: "1"}}
                        // Smaller on mobile since we render the navigation bar above.
                        paddingY={platform !== "mobile" ? "3" : "2"}
                        cursor="text"
                    >
                        <div
                            {...backdropPressProps}
                            className={sprinkles({
                                position: "absolute",
                                zIndex: "-10",
                                inset: "0",
                                cursor: "text",
                            })}
                        />
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
                                    (parseRemLength("6") -
                                        parseRemLength(fontSizes["100"].lineHeight)) /
                                    2
                                }rem`,
                                paddingBottom: `${
                                    (parseRemLength("6") -
                                        parseRemLength(fontSizes["100"].lineHeight)) /
                                    2
                                }rem`,
                            }}
                            placeholder={
                                selectedAccounts.length === 0 ? "Search for people…" : undefined
                            }
                            // By default `<input>` elements have a `min-width` determined by the `size`
                            // property. We want our `<input>`s `min-width` to be determined by our CSS
                            // so set it to a small value as not to matter.
                            // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                            size={1}
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
                                } else if (
                                    event.key === "Escape" &&
                                    selectedAccounts.length === 0
                                ) {
                                    // Since the combobox will never close when there are no selected accounts, let
                                    // the escape key press propagate up. If we're in a peek that means closing
                                    // the peek.
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
                                    document.activeElement === event.target &&
                                    !comboBoxState.isOpen
                                ) {
                                    comboBoxState.open();
                                }
                            }}
                        />
                    </Box>
                    <Box
                        flexShrink="0"
                        // Smaller on mobile since we render the navigation bar above.
                        height={platform !== "mobile" ? "12" : "10"}
                        paddingLeft={{desktop: "3", mobile: "1.5"}}
                        paddingRight={{mobile: screenPaddingX.mobile, desktop: "4"}}
                        display="flex"
                        alignItems="center"
                        gap="2"
                    >
                        <Box width="4" height="4">
                            {shouldShowPendingSpinner && (
                                <SpinnerGap
                                    className={spinAnimationClassName}
                                    color={colorSchemeVars["grey-70"]}
                                    size={spacing["4"]}
                                />
                            )}
                        </Box>
                        <Box
                            // Redundant and takes up too much space on mobile. The user can tap on the
                            // input to open the dropdown.
                            //
                            // We still need it in the DOM, though, or else `react-aria` gets confused.
                            display={platform === "mobile" ? "none" : undefined}
                        >
                            <IconButton
                                {...buttonProps}
                                // The button has its own label so we don't need one from `react-aria`.
                                aria-labelledby={undefined}
                                ref={buttonRef}
                                size="sm"
                                description="Toggle"
                                withoutTooltip={true}
                            >
                                <CaretDown />
                            </IconButton>
                        </Box>
                    </Box>
                </Box>
            </FocusRing>
        </OverlayAnimated>
    );
}

function ChatAccountPickerListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    comboBoxState: ComboBoxState<ChatAccountPickerItem>;
    listBoxRef: RefObject<HTMLUListElement | null>;
    listBoxProps: AriaListBoxOptions<ChatAccountPickerItem>;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const {listBoxProps} = useListBox(
        {
            ..._listBoxProps,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            scrollRef,
        },
        comboBoxState,
        listBoxRef,
    );

    return (
        <div
            // `useScrollbar()` is on a `<div>` wrapping the `<ul>` so `useScrollbar()`
            // doesn't need to add a resize listener to every child. This means we need to
            // provide `useListBox()` a `scrollRef` if we want to scroll to the
            // focused option.
            ref={useMergedRefs(useScrollbar(), scrollRef)}
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    borderRadius: "1.5",
                    padding: "1",
                    marginX: "2",
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-20",
                    maxHeight: {desktop: "64", mobile: "48"},
                    overflowX: "hidden",
                    overflowY: "auto",
                    position: "relative",
                }),
            )}
        >
            <ul {...listBoxProps} ref={listBoxRef}>
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
                        <ChatAccountPickerListBoxOption
                            key={item.key}
                            comboBoxState={comboBoxState}
                            item={item}
                        />
                    ))
                )}
            </ul>
        </div>
    );
}

function ChatAccountPickerListBoxOption({
    comboBoxState,
    item,
}: {
    comboBoxState: ComboBoxState<ChatAccountPickerItem>;
    item: Node<ChatAccountPickerItem>;
}) {
    const optionRef = useRef(null);
    const {optionProps, isFocused, isPressed, isHovered} = useOption(
        {
            key: item.key,
            // By default `@react-aria/listbox` allows you to press on the combobox trigger
            // then drag up and release to select an item. This is not a common interaction
            // and not something we want to support (our `<MenuButton>` doesn't support
            // this). Furthermore, on mobile it means if you press an option in a combobox
            // then scroll and release that option will be selected! Instead the scroll
            // should cancel the press. We really want to disable that behavior since it
            // feels broken.
            disallowsDifferentPressOrigin: true,
        },
        comboBoxState,
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    assert(isValidElement(item.rendered));

    return (
        <FocusRing offset="inset" isVisible={isFocused && wasFocusVisibleWhenFocused}>
            <li
                {...optionProps}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    paddingX: "1.5",
                    paddingY: "1.5",
                    borderRadius: "1",
                    color: "grey-100",
                    backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                })}
            >
                {cloneElement(item.rendered, {isPressed} as any)}
            </li>
        </FocusRing>
    );
}

function ChatAccountPickerListBoxOptionItem({
    item,
    isPressed,
}: {
    item: ChatAccountPickerItem;
    isPressed?: boolean;
}) {
    assert(
        typeof isPressed === "boolean",
        "Expected to be rendered by <ChatAccountMemberPickerListBoxOption> which provides extra props",
    );

    switch (item.type) {
        case "Account": {
            return (
                <Box display="flex" alignItems="center" gap="2">
                    <AccountAvatar account={item.accountData} size="6" />
                    <Box fontStyle="truncate">{item.accountData.name}</Box>
                </Box>
            );
        }
        case "Chat": {
            const {otherAccountDatas} = item;
            assert(otherAccountDatas.length > 0);

            return (
                <Box display="flex" alignItems="center" gap="2">
                    <Box position="relative" width="6" height="6">
                        <Box position="absolute" top="0" left="-1">
                            <AccountAvatar account={otherAccountDatas[0]!} size="5" />
                        </Box>
                        <Box
                            position="absolute"
                            bottom="-1"
                            right="-1"
                            width="5"
                            height="5"
                            borderRadius="full"
                            style={{
                                boxShadow: `0px 0px 0px 2px ${backgroundColorVar}`,
                            }}
                        >
                            <Box
                                width="5"
                                height="5"
                                borderRadius="full"
                                backgroundColor={isPressed ? "grey-20" : "grey-10"}
                                color="grey-70"
                                fontSize="50"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                            >
                                <Box style={{transform: "scale(0.8)"}}>
                                    +{otherAccountDatas.length - 1}
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                    <Box fontStyle="truncate">{item.textValue}</Box>
                </Box>
            );
        }
        default:
            throw exhaustive(item);
    }
}
