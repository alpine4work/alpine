import {isFocusVisible} from "@react-aria/interactions";
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
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {joinPrettyConjunctionList} from "~/client/design/pretty_conjunction_list.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {useExpensivelyLoadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    fontSizes,
    greyElevated2ClassName,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

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
    withMobileLayout,
}: {
    selectedAccounts: ReadonlyArray<AccountModel>;
    onUpdateSelectedAccounts: (
        update: (selectedAccounts: ReadonlyArray<AccountModel>) => ReadonlyArray<AccountModel>,
    ) => void;
    shouldShowPendingSpinner: boolean;
    suggestedChats: ReadonlyArray<ChatModel>;
    withMobileLayout: boolean;
}) {
    const accountStore = useAccountClientStore();
    const {currentAccount} = useSpaceContext();
    const allUnsortedAccounts = useExpensivelyLoadAllSpaceAccounts() ?? emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allUnsortedAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allUnsortedAccounts]);

    const suggestedChatById = useMemo(() => {
        const suggestedChatById = new Map<ChatId, ChatModel>();
        for (const chat of suggestedChats) suggestedChatById.set(chat.id, chat);
        return suggestedChatById;
    }, [suggestedChats]);

    const allItemsStore = useMemo(() => {
        const itemStores: Array<Store<ChatAccountPickerItem>> = [];

        for (const chat of suggestedChats) {
            assert(chat.accounts.length > 0);

            const otherAccounts = chat.accounts.filter(account => account.id !== currentAccount.id);

            itemStores.push(
                Store.mapMany(
                    otherAccounts.map(account => accountStore.getAccountStore(account)),
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

        for (const account of allUnsortedAccounts) {
            itemStores.push(
                accountStore.getAccountStore(account).map((accountData): ChatAccountPickerItem => {
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
                return item1.textValue.localeCompare(item2.textValue);
            }),
        );
    }, [accountStore, allUnsortedAccounts, currentAccount.id, suggestedChats]);

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
                ? itemsWithoutSelection
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
        label: "To",
        menuTrigger: "input",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue: searchQuery,
        onInputChange: searchQuery => setSearchQuery({searchQuery, shouldCloseComboBox: false}),

        items: searchedItems,
        children: item => (
            <Item textValue={item.textValue}>
                <ChatAccountPickerListBoxOptionItem item={item} />
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
                                    account.id !== currentAccount.id &&
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

    const selectedAccountDatas = useStore(
        useMemo(
            () =>
                Store.mapMany(
                    selectedAccounts.map(account => accountStore.getAccountStore(account)),
                    accounts => accounts,
                ),
            [accountStore, selectedAccounts],
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
                    selectedAccountRefs[index - 1]?.current?.focus();
                    break;
                }
                // Arrow keys navigate through selected accounts. Only the first selected
                // account is focusable since you use arrow keys to navigate between accounts.
                case "ArrowRight": {
                    event.preventDefault();
                    event.stopPropagation();
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
                    // The first selected account is focusable via tab and you can use arrow keys
                    // to focus the others.
                    tabIndex={index === 0 ? 0 : -1}
                    onKeyDown={handleKeyDown}
                >
                    <Box paddingLeft="0.5">
                        <AccountAvatar size="5" account={accountData} />
                    </Box>
                    <Box paddingLeft="1.5" paddingRight="0.5" fontSize="100">
                        {accountData.name}
                    </Box>
                    <Box paddingRight="1">
                        <IconButton
                            size="xs"
                            variant="quiet-above-grey-5-background"
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
                <Box
                    data-testid="ChatAccountPickerInput"
                    // Border radius for the focus ring
                    borderTopRadius={!withMobileLayout ? "md" : undefined}
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
                        <span aria-hidden={true}>:</span>
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
                            // The button has its own label so we don't need one from `react-aria`.
                            aria-labelledby={undefined}
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

function ChatAccountPickerListBox({
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
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    borderRadius: "md",
                    padding: "1",
                    marginX: "2",
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-20",
                    maxHeight: "64",
                    overflowX: "hidden",
                    overflowY: "auto",
                }),
            )}
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
                    <ChatAccountPickerListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                    />
                ))
            )}
        </ul>
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
                    paddingX: "1.5",
                    paddingY: "1.5",
                    borderRadius: "base",
                    color: "grey-text",
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
