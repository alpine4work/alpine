import {isFocusVisible, setInteractionModality, usePress} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import classNames from "classnames";
import _Fuse from "fuse.js";
import {CaretDown, MagnifyingGlass} from "phosphor-react";
import {
    Dispatch,
    KeyboardEvent,
    Memo,
    Ref,
    RefObject,
    SetStateAction,
    createRef,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {AriaListBoxOptions, useComboBox, useListBox, useOption} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {useStore} from "~/client/helpers/use_store.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {
    colorSchemeVars,
    greyElevated2ClassName,
    overlayFadeOutAnimationDurationMs,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

type ShareOverlayAccountInputItem = {
    readonly key: AccountId;
    readonly accountData: AccountModelData;
};

let isClosingComboBox = false;

export type ShareOverlayAccountInputRef = {
    focus(): void;
    isComboBoxOpen(): boolean;
    closeComboBox(): void;
};

const ShareOverlayAccountInputForwardRef = forwardRef(ShareOverlayAccountInput);
export {ShareOverlayAccountInputForwardRef as ShareOverlayAccountInput};

function ShareOverlayAccountInput(
    {
        allAccounts,
        accountById,
        selectedAccounts,
        onSelectedAccountsChange,
        excludeAccountId,
        accessLevel,
    }: {
        allAccounts: ReadonlyArray<AccountModel>;
        accountById: ReadonlyMap<AccountId, AccountModel>;
        selectedAccounts: ReadonlyArray<AccountModel>;
        onSelectedAccountsChange: Dispatch<SetStateAction<ReadonlyArray<AccountModel>>>;
        excludeAccountId?: Memo<(accountId: AccountId) => boolean>;
        accessLevel?: {
            accessLevelText: Record<AccessLevel, string>;
            accessLevel: AccessLevel;
            minAccessLevel?: AccessLevel;
            onAccessLevelChange: (accessLevel: AccessLevel) => void;
            isAltKeyDown: boolean;
        };
    },
    ref: Ref<ShareOverlayAccountInputRef>,
) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const accountRegistry = useAccountRegistry();

    const inputRef = useRef<HTMLInputElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const [buttonsRef, buttonsSize] = useResizeObserver();

    const itemsWithExcludedAccounts = useStore(
        useMemo(() => {
            return Store.mapMany(
                allAccounts.map(account => accountRegistry.getAccountStore(account)),
                allAccountDatas =>
                    filterMapArray(
                        allAccountDatas,
                        (accountData): ShareOverlayAccountInputItem | undefined => {
                            // Don't allow sharing with an account that was removed.
                            if (accountData.space.state.type !== "Active") return;

                            return {
                                key: accountData.id,
                                accountData,
                            };
                        },
                    ),
            );
        }, [accountRegistry, allAccounts]),
    );

    const [searchQuery, setSearchQuery] = useState("");

    const items = useMemo(() => {
        const selectedAccountIds = new Set<AccountId>(selectedAccounts.map(account => account.id));

        return itemsWithExcludedAccounts.filter(
            item => !excludeAccountId?.(item.key) && !selectedAccountIds.has(item.key),
        );
    }, [selectedAccounts, itemsWithExcludedAccounts, excludeAccountId]);

    const itemsSearchIndex = useMemo(
        () =>
            new Fuse(items, {
                keys: [
                    {
                        name: "name",
                        getFn: item => item.accountData.name,
                    },
                ],
            }),
        [items],
    );

    const searchedItems = useMemo(
        () =>
            searchQuery === "" ? items : itemsSearchIndex.search(searchQuery).map(({item}) => item),
        [items, itemsSearchIndex, searchQuery],
    );

    const [disableAnimationOut, setDisableAnimationOut] = useState(true);
    useEffect(() => {
        if (disableAnimationOut) return;

        const timeout = createTimeout(() => {
            setDisableAnimationOut(true);
        }, overlayFadeOutAnimationDurationMs);
        return () => {
            timeout.clear();
        };
    }, [disableAnimationOut]);

    const comboBoxProps: ComboBoxStateOptions<ShareOverlayAccountInputItem> = {
        label: "Add people",
        menuTrigger: "manual",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue: searchQuery,
        onInputChange: searchQuery => {
            setSearchQuery(searchQuery);

            if (!comboBoxState.isOpen) {
                comboBoxState.open();
            }
        },

        items: searchedItems,
        children: item => (
            <Item textValue={item.accountData.name}>
                <ShareOverlayAccountInputListBoxOptionItem item={item} />
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
            setDisableAnimationOut(false);
        },

        // No key is ever selected by the combobox. Instead when a selection occurs we
        // add it to a list of selected values.
        selectedKey: null,
        onSelectionChange: key => {
            if (isClosingComboBox) return;

            setSearchQuery("");

            if (typeof key === "string") {
                const account = accountById.get(assertId(key));
                if (account) {
                    onSelectedAccountsChange(selectedAccounts => {
                        // If the account already exists in the selection, don't add it a second time.
                        if (selectedAccounts.some(otherAccount => otherAccount.id === account.id)) {
                            return selectedAccounts;
                        }
                        return [...selectedAccounts, account];
                    });
                }
            }

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
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => {
                assertExists(inputRef.current).focus();
            },
            isComboBoxOpen: () => comboBoxState.isOpen,
            closeComboBox: () => {
                // Animate closing the combobox from an component component. If a parent
                // component wants to close our combobox it's unlikely that action is the
                // result of a direct user interaction so we'll want to animate.
                setDisableAnimationOut(false);

                comboBoxState.close();
            },
        }),
        [comboBoxState],
    );

    const {labelProps, inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            inputRef,
            buttonRef,
            popoverRef,
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

                            onSelectedAccountsChange(selectedAccounts => {
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
            onSelectedAccountsChange(selectedAccounts => {
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
                        setSearchQuery(searchQuery + event.key);
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
                    <Box paddingLeft="1.5" paddingRight="2" fontSize="75">
                        {accountData.name}
                    </Box>
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
            isVisible={comboBoxState.isOpen}
            disableAnimationIn={true}
            disableAnimationOut={disableAnimationOut}
            placement="bottom-start"
            sameWidth={true}
            offset="2"
            // Set a constant `overflowBottom` value instead of relying on the current
            // keyboard height (which will be updated asynchronously after `isEditing` is
            // true). This stops the overlay placement from jumping around while the
            // keyboard opens. The value was calculated based on the keyboard height in
            // iOS. We may need to change this constant if the keyboard height for iOS
            // changes or the Android keyboard height is bigger.
            overflowBottom={platform === "mobile" ? "18rem" : undefined}
            overflowTop={navigationBarHeight}
            overlay={
                <Box ref={popoverRef} position="relative">
                    <ShareOverlayAccountInputListBox
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
                    data-testid="ShareOverlayAccountInput"
                    position="relative"
                    zIndex="0"
                    minHeight="10"
                    borderRadius="1.5"
                    style={{
                        // Use `box-shadow` instead of `border` so drawing the border doesn't take
                        // space in the layout.
                        boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                    }}
                >
                    <Box
                        position="relative"
                        zIndex="0"
                        display="flex"
                        alignItems="center"
                        flexWrap="wrap"
                        rowGap="1.5"
                        columnGap="1.5"
                        paddingY="2"
                        paddingLeft="2"
                        style={{
                            paddingRight:
                                (buttonsSize?.width ?? 0) + convertRemLengthToPx("2", spacingScale),
                        }}
                    >
                        <label
                            {...labelProps}
                            className={sprinkles({
                                display: "block",
                                position: "absolute",
                                top: "0",
                                left: "0",
                                opacity: "0",
                                width: "0",
                                height: "0",
                            })}
                        >
                            {comboBoxProps.label}
                        </label>
                        <Box
                            {...backdropPressProps}
                            position="absolute"
                            zIndex="-10"
                            inset="0"
                            cursor="text"
                        />
                        {selectedAccountsChildren}
                        <input
                            {...inputProps}
                            ref={inputRef}
                            className={sprinkles({
                                height: "6",
                                flexGrow: "1",
                                display: "block",
                                minWidth:
                                    searchQuery.length > 10 || selectedAccounts.length === 0
                                        ? "full"
                                        : "4",
                                paddingLeft:
                                    searchQuery.length > 0 || selectedAccounts.length === 0
                                        ? "1"
                                        : "0",
                                backgroundColor: "transparent",
                            })}
                            placeholder={selectedAccounts.length === 0 ? "Add people…" : undefined}
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
                    {accessLevel &&
                        (() => {
                            const actions: Array<MenuAction> = [];
                            const minAccessLevel = accessLevel.minAccessLevel ?? "View";

                            if (hasAccessLevel("Manage", minAccessLevel)) {
                                actions.push({
                                    isSelected: accessLevel.accessLevel === "Manage",
                                    label: accessLevel.accessLevelText.Manage,
                                    onPress: () => accessLevel.onAccessLevelChange("Manage"),
                                });
                            }

                            if (
                                (accessLevel.isAltKeyDown &&
                                    hasAccessLevel("Edit", minAccessLevel)) ||
                                // We need to show the edit access level without holding alt when
                                // `minAccessLevel` is `Edit` otherwise there will be no access level selector
                                // even when you're allowed to change access level to `Manage`.
                                minAccessLevel === "Edit"
                            ) {
                                actions.push({
                                    isSelected: accessLevel.accessLevel === "Edit",
                                    label: accessLevel.accessLevelText.Edit,
                                    onPress: () => accessLevel.onAccessLevelChange("Edit"),
                                });
                            }

                            if (hasAccessLevel("Comment", minAccessLevel)) {
                                actions.push({
                                    isSelected: accessLevel.accessLevel === "Comment",
                                    label: accessLevel.accessLevelText.Comment,
                                    onPress: () => accessLevel.onAccessLevelChange("Comment"),
                                });
                            }

                            if (hasAccessLevel("View", minAccessLevel)) {
                                actions.push({
                                    isSelected: accessLevel.accessLevel === "View",
                                    label: accessLevel.accessLevelText.View,
                                    onPress: () => accessLevel.onAccessLevelChange("View"),
                                });
                            }

                            if (actions.length <= 1) return;

                            return (
                                <Box
                                    ref={buttonsRef}
                                    className={pointerEventsNoneNotInheritedClassName}
                                    position="absolute"
                                    zIndex="10"
                                    top="2"
                                    right="2"
                                    height="6"
                                    display="flex"
                                    alignItems="center"
                                    gap="2"
                                >
                                    <MenuButton
                                        placement="bottom-end"
                                        // Align this menu to the right edge of the input. So it's consistent with the
                                        // access level menus from account grants. We can do this thanks to the add
                                        // button's fixed width. This helps the design especially on mobile where
                                        // otherwise the overlay is pushed to the right side of the screen.
                                        offsetAlong="2"
                                        actions={actions}
                                    >
                                        <Button
                                            height="6"
                                            paddingX="2"
                                            icon={<CaretDown />}
                                            iconPlacement="end"
                                        >
                                            {accessLevel.accessLevelText[accessLevel.accessLevel]}
                                        </Button>
                                    </MenuButton>
                                </Box>
                            );
                        })()}
                </Box>
            </FocusRing>
        </OverlayAnimated>
    );
}

function ShareOverlayAccountInputListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    comboBoxState: ComboBoxState<ShareOverlayAccountInputItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<ShareOverlayAccountInputItem>;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const {listBoxProps} = useListBox({..._listBoxProps, scrollRef}, comboBoxState, listBoxRef);

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
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-20",
                    maxHeight: "48",
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
                        <ShareOverlayAccountInputListBoxOption
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

function ShareOverlayAccountInputListBoxOption({
    comboBoxState,
    item,
}: {
    comboBoxState: ComboBoxState<ShareOverlayAccountInputItem>;
    item: Node<ShareOverlayAccountInputItem>;
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
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

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
                {item.rendered}
            </li>
        </FocusRing>
    );
}

function ShareOverlayAccountInputListBoxOptionItem({item}: {item: ShareOverlayAccountInputItem}) {
    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <AccountAvatar account={item.accountData} size="5" />
            <Box flexGrow="1" fontStyle="truncate">
                {item.accountData.name}
            </Box>
        </Box>
    );
}
