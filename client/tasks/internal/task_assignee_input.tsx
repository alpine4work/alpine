import {getInteractionModality, usePress} from "@react-aria/interactions";
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
import {flushSync} from "react-dom";
import {ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/design/input_with_auto_growing_width.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    useExpensivelyLoadAllSpaceAccounts,
    useExpensivelyPreloadAllSpaceAccounts,
} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {
    TaskAssigneeInputListBox,
    TaskAssigneeInputListBoxOptionItem,
} from "~/client/tasks/internal/task_assignee_input_list_box.js";
import {TaskMissingAccountAvatar} from "~/client/tasks/internal/task_missing_account_avatar.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {sprinkles} from "~/shared/styles/styles.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export const nullTaskAssigneeInputLabel = "Nobody";

export type TaskAssigneeInputItem =
    | {
          readonly type: "Account";
          readonly key: `Account:${AccountId}`;
          readonly accountData: AccountModelData;
      }
    | {
          readonly type: "Null";
          readonly key: "Null";
          readonly accountData?: undefined;
      };

type TaskAssigneeInputState =
    | {
          readonly type: "Selection";
          readonly disableAnimationOut: boolean;
          readonly shouldBlurRef: MutableRefObject<boolean>;
      }
    | {
          readonly type: "Typing";
          readonly initialAssigneeAccountId: AccountId | null;
          readonly value: string;
          readonly hasChanged: boolean;
          readonly disableAnimationOut: boolean;
          readonly shouldSelectRef: MutableRefObject<boolean>;
      };

export type TaskAssigneeInputRef = {
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

const TaskAssigneeInputForwardRef = forwardRef(TaskAssigneeInput);
export {TaskAssigneeInputForwardRef as TaskAssigneeInput};

let isClosingComboBox = false;

function TaskAssigneeInput(
    {
        assigneeAccountData,
        onAssigneeAccountChange,
        isReadOnly,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        color = "grey-100",
        avatarSize = "5",
        shouldDisplayShortName,
        isTabbable = true,
        onArrowLeftLeaveKeyDown,
        onArrowRightLeaveKeyDown,
    }: {
        assigneeAccountData: AccountModelData | null;
        onAssigneeAccountChange: (assigneeAccount: AccountModel | null) => void;
        isReadOnly?: boolean;
        "aria-label"?: string;
        "aria-labelledby"?: string;
        color?: "grey-100" | "grey-60";
        avatarSize?: "5" | "4";
        shouldDisplayShortName?: boolean;
        isTabbable?: boolean;
        onArrowLeftLeaveKeyDown?: () => void;
        onArrowRightLeaveKeyDown?: () => void;
    },
    ref: Ref<TaskAssigneeInputRef>,
) {
    const isMobile = useIsMobile();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const accountStore = useAccountClientStore();
    const {currentAccount} = useSpaceContext();

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const [inputState, setInputState] = useState<TaskAssigneeInputState>({
        type: "Selection",
        disableAnimationOut: false,
        shouldBlurRef: {current: false},
    });

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

    const getSelectionInputValue = (assigneeAccountData: AccountModelData | null) =>
        assigneeAccountData
            ? shouldDisplayShortName
                ? getAccountShortNameWithoutFullNameTooltip(assigneeAccountData)
                : assigneeAccountData.name
            : "";

    const selectionInputValue = getSelectionInputValue(assigneeAccountData);

    const inputValue = inputState.type === "Selection" ? selectionInputValue : inputState.value;

    // Preload accounts since we don't load accounts until the dropdown is open.
    useExpensivelyPreloadAllSpaceAccounts();

    const [shouldLoadAccounts, setShouldLoadAccounts] = useState(false);
    const allAccounts =
        useExpensivelyLoadAllSpaceAccounts({isDisabled: !shouldLoadAccounts}) ?? emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allAccounts]);

    const allItems = useStore(
        useMemo(() => {
            return Store.mapMany(
                allAccounts.map(account => accountStore.getAccountStore(account)),
                allAccountDatas => {
                    const allItems: Array<TaskAssigneeInputItem> = allAccountDatas.map(
                        accountData => ({
                            type: "Account",
                            key: `Account:${accountData.id}`,
                            accountData,
                        }),
                    );

                    allItems.push({type: "Null", key: "Null"});

                    allItems.sort((item1, item2) => {
                        if (item1.type === "Null") return -1;
                        if (item2.type === "Null") return 1;

                        if (item1.accountData.id === currentAccount.id) return -1;
                        if (item2.accountData.id === currentAccount.id) return 1;

                        // Use the sort order from the server. The server returns accounts in
                        // affinity order.
                        return 0;
                    });

                    return allItems;
                },
            );
        }, [accountStore, allAccounts, currentAccount.id]),
    );

    const itemsSearchIndex = useMemo(
        () =>
            new Fuse(allItems, {
                keys: [
                    {
                        name: "name",
                        getFn: item => item.accountData?.name ?? nullTaskAssigneeInputLabel,
                    },
                ],
            }),
        [allItems],
    );

    const searchedItems = useMemo(
        () =>
            inputValue === "" || inputState.type === "Selection" || !inputState.hasChanged
                ? // Don't include removed accounts in the initial rendered account list.
                  //
                  // TODO(calebmer): When searching, removed accounts should rank lower. How do
                  // we give them a lower score while still allowing users to find them?
                  allItems.filter(item => !item.accountData || !item.accountData.space.wasRemoved)
                : itemsSearchIndex.search(inputValue).map(({item}) => item),

        [allItems, inputState, inputValue, itemsSearchIndex],
    );

    const selectedKey = assigneeAccountData ? `Account:${assigneeAccountData.id}` : "Null";

    const comboBoxProps: ComboBoxStateOptions<TaskAssigneeInputItem> = {
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
                    initialAssigneeAccountId: inputState.initialAssigneeAccountId,
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
            if (isOpen && !isMobile) {
                inputElement.select();
            }

            // We need to know whether the combobox is open or not to decide whether we
            // should load accounts.
            setShouldLoadAccounts(isOpen);
        },

        onFocus: () => {
            // Open the combobox on focus.
            //
            // Wait an animation frame before opening the combobox and make sure we're
            // still focused.
            //
            // In Chrome, if the user focuses an element then leaves to another app (e.g.
            // clicks into the inspector panel) then clicks back into the page Chrome will
            // `blur` when the user clicks out then dispatch `focus` + `blur` when the user
            // clicks back in. We don't want to open the combo box if Chrome is dispatching
            // `focus` + `blur` in rapid succession when the user refocuses the window
            // since it looks janky to open then animate shut.
            requestAnimationFrame(() => {
                if (!inputRef.current) return;
                const inputElement = inputRef.current;

                if (document.activeElement === inputElement) {
                    // Open the combobox on focus.
                    //
                    // `flushSync()` since this is in response to a user interaction. React would be
                    // able to use the right priority if we set state directly in `onFocus` but
                    // since we've deferred we need to set the right priority ourselves.
                    flushSync(() => comboBoxState.open());
                }
            });

            // When focused, switch to a typing state.
            setInputState(inputState => {
                if (inputState.type === "Typing") return inputState;
                return {
                    type: "Typing",
                    initialAssigneeAccountId: assigneeAccountData?.id ?? null,
                    value: !isMobile ? inputValue : "",
                    hasChanged: false,
                    disableAnimationOut: false,
                    shouldSelectRef: {current: false},
                };
            });
        },

        onBlur: () => {
            // When unfocused, switch back to a selection state discarding any typed value.
            setInputState(inputState => {
                if (inputState.type === "Selection") return inputState;
                return {
                    type: "Selection",
                    disableAnimationOut: false,
                    shouldBlurRef: {current: false},
                };
            });
        },

        onKeyDown: event => {
            const inputElement = assertExists(inputRef.current);

            switch (event.key) {
                case "Backspace": {
                    if (
                        assigneeAccountData &&
                        inputState.type === "Typing" &&
                        inputState.value.length === 0
                    ) {
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
            (item: TaskAssigneeInputItem) => (
                <Item textValue={item.accountData?.name ?? ""}>
                    <TaskAssigneeInputListBoxOptionItem item={item} />
                </Item>
            ),
            [],
        ),

        selectedKey,
        onSelectionChange: key => {
            if (isClosingComboBox) return;

            assert(typeof key === "string");

            // Don't re-select the selected key.
            //
            // This fires when tabbing through an assignee field and throws an error if we
            // don't return here because `accountById` is empty.
            if (key === selectedKey) return;

            let newAssigneeAccount: AccountModel | null;
            if (key === "Null") {
                newAssigneeAccount = null;
            } else {
                const accountId = assertId<AccountId>(key.slice("Account:".length));
                newAssigneeAccount = assertExists(accountById.get(accountId));
            }

            if (!newAssigneeAccount) {
                if (assigneeAccountData) {
                    onAssigneeAccountChange(null);
                }
            } else {
                if (assigneeAccountData?.id !== newAssigneeAccount.id) {
                    onAssigneeAccountChange(newAssigneeAccount);
                }
            }

            // Keep focus in the input if we're using a keyboard interaction modality.
            if (getInteractionModality() !== "pointer") {
                setInputState(inputState => {
                    if (inputState.type !== "Typing") return inputState;
                    return {
                        type: "Typing",
                        initialAssigneeAccountId: newAssigneeAccount?.id ?? null,
                        value: getSelectionInputValue(
                            newAssigneeAccount
                                ? accountStore.getAccountStore(newAssigneeAccount).getSnapshot()
                                : null,
                        ),
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

    // If the assignee changed while the user was focused and typing, reset the
    // input to the new selection.
    //
    // This commonly happens when the user makes a selection then hits cmd-z.
    if (
        inputState.type === "Typing" &&
        inputState.initialAssigneeAccountId !== (assigneeAccountData?.id ?? null)
    ) {
        setInputState({
            type: "Typing",
            initialAssigneeAccountId: assigneeAccountData?.id ?? null,
            value: getSelectionInputValue(assigneeAccountData),
            hasChanged: false,
            disableAnimationOut: true,
            shouldSelectRef: {current: true},
        });

        comboBoxState.close();
    }

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

    const insetMarginY = isMobile
        ? avatarSize === "5"
            ? "2.5"
            : "2"
        : avatarSize === "5"
        ? "0.5"
        : undefined;

    return (
        <div
            className={sprinkles({
                // Height of 9 for 45px on mobile to meet the [minimum recommended touch hit
                // target size][1].
                //
                // [1]: https://developer.apple.com/design/human-interface-guidelines/buttons#Best-practices
                height: isMobile ? "9" : avatarSize,
                marginY: insetMarginY ? `-${insetMarginY}` : undefined,
                marginLeft: avatarSize === "5" ? "-0.5" : undefined,
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
                offsetAlong={avatarSize === "5" ? "-2.5" : "-3"}
                disableAnimationIn={true}
                disableAnimationOut={inputState.disableAnimationOut}
                // Prefer rendering the overlay above the input on mobile since the keyboard
                // will open below the input causing an overlay rendered below to jump up.
                placement={isMobile ? "top-start" : "bottom-start"}
                // The overlay blocks interaction with everything outside the overlay. Except
                // the combobox input. We still want to render the overlay in our current
                // overlay scope so that it animates smoothly with scroll animations (important
                // on mobile when we need to avoid the keyboard).
                isBlocking={true}
                withoutRootBlockingScope={true}
                withoutBlockingTarget={true}
                overlay={
                    <div ref={popoverRef} className={sprinkles({position: "relative"})}>
                        <TaskAssigneeInputListBox
                            comboBoxState={comboBoxState}
                            listBoxRef={listBoxRef}
                            listBoxProps={listBoxProps}
                            selectedKey={selectedKey}
                        />
                    </div>
                }
            >
                <FocusRing insetY={isMobile ? insetMarginY : undefined} isVisibleWhenFocusWithin>
                    <div
                        className={sprinkles({
                            position: "relative",
                            zIndex: "0",
                            maxWidth: "full",
                            height: "full",
                            overflow: "hidden",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: avatarSize === "5" ? "1.5" : "1",
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
                        <div className={sprinkles({flexShrink: "0", pointerEvents: "none"})}>
                            {assigneeAccountData ? (
                                <AccountAvatar size={avatarSize} account={assigneeAccountData} />
                            ) : (
                                <TaskMissingAccountAvatar size={avatarSize} />
                            )}
                        </div>
                        <InputWithAutoGrowingWidth
                            {...inputProps}
                            ref={inputRef}
                            tabIndex={!isTabbable ? -1 : undefined}
                            placeholder={
                                assigneeAccountData
                                    ? selectionInputValue
                                    : nullTaskAssigneeInputLabel
                            }
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
                                    document.activeElement === event.target &&
                                    !comboBoxState.isOpen
                                ) {
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
