import {getInteractionModality} from "@react-aria/interactions";
import classNames from "classnames";
import _Fuse from "fuse.js";
import {Ref, forwardRef, useImperativeHandle, useMemo, useRef, useState} from "react";
import {useComboBox} from "react-aria";
import {ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useTouchSlop} from "~/client/design/use_touch_slop.js";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
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
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {sprinkles, tasksStyles} from "~/shared/styles/styles.js";

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
      }
    | {
          readonly type: "Typing";
          readonly initialAssigneeAccountId: AccountId | null;
          readonly value: string;
          readonly hasChanged: boolean;
          readonly shouldSelect: boolean;
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
        color = "grey-text",
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
        color?: "grey-text" | "grey-60";
        avatarSize?: "5" | "4";
        shouldDisplayShortName?: boolean;
        isTabbable?: boolean;
        onArrowLeftLeaveKeyDown?: () => void;
        onArrowRightLeaveKeyDown?: () => void;
    },
    ref: Ref<TaskAssigneeInputRef>,
) {
    const isMobile = useIsMobile();
    const accountStore = useAccountClientStore();
    const {currentAccount} = useSpaceContext();

    const [inputState, setInputState] = useState<TaskAssigneeInputState>({
        type: "Selection",
        disableAnimationOut: false,
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        if (inputState.type === "Typing" && inputState.shouldSelect) {
            assertExists(inputRef.current).select();
            setInputState({...inputState, shouldSelect: false});
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
                ? allItems
                : itemsSearchIndex.search(inputValue).map(({item}) => item),

        [allItems, inputState, inputValue, itemsSearchIndex],
    );

    const selectedKey = assigneeAccountData ? `Account:${assigneeAccountData.id}` : "Null";

    const comboBoxProps: ComboBoxStateOptions<TaskAssigneeInputItem> = {
        // We need to know whether the combobox is open or not to decide whether we
        // should load accounts.
        onOpenChange: setShouldLoadAccounts,

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
                        initialAssigneeAccountId: assigneeAccountData?.id ?? null,
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
                        initialAssigneeAccountId: assigneeAccountData?.id ?? null,
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
        children: item => (
            <Item textValue={item.accountData?.name ?? ""}>
                <TaskAssigneeInputListBoxOptionItem item={item} />
            </Item>
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

    useImperativeHandle(
        ref,
        () => ({
            focus: () => assertExists(inputRef.current).focus(),
        }),
        [],
    );

    return (
        <div
            className={sprinkles({marginLeft: avatarSize === "5" ? "-0.5" : undefined})}
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
                        <TaskAssigneeInputListBox
                            comboBoxState={comboBoxState}
                            listBoxRef={listBoxRef}
                            listBoxProps={listBoxProps}
                            selectedKey={selectedKey}
                        />
                    </div>
                }
            >
                <FocusRing isVisibleWhenFocusWithin>
                    <div
                        className={classNames(
                            !isReadOnly ? tasksStyles.textCursorNotInheritedClassName : undefined,
                            sprinkles({
                                maxWidth: "full",
                                // Height of 9 for 45px on mobile to meet the [minimum recommended touch hit
                                // target size][1].
                                //
                                // [1]: https://developer.apple.com/design/human-interface-guidelines/buttons#Best-practices
                                height: isMobile ? "9" : avatarSize,
                                marginY: isMobile
                                    ? avatarSize === "5"
                                        ? "-2"
                                        : "-2.5"
                                    : avatarSize === "5"
                                    ? "-0.5"
                                    : undefined,
                                overflow: "hidden",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: avatarSize === "5" ? "1.5" : "1",
                            }),
                        )}
                        style={{
                            // `display: inline-flex` creates an inline layout which adds extra space
                            // below the element. Adding `vertical-align` stops the space from being added.
                            // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                            verticalAlign: "top",
                        }}
                        onPointerDown={event => {
                            // If the backdrop of this element was clicked and the input is focused then
                            // don't let a click unfocus it.
                            if (event.target === event.currentTarget) {
                                event.preventDefault();
                            }

                            // Make sure the input focuses on press. iOS Safari seems to require a double
                            // tap before the input focuses. Possibly because hover events are attached
                            // somewhere.
                            assertExists(inputRef.current).focus();

                            // Make sure to reopen the combobox whenever the pointer clicks the input.
                            if (!isReadOnly) {
                                comboBoxState.open();
                            }
                        }}
                    >
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
                        />
                    </div>
                </FocusRing>
            </OverlayAnimated>
        </div>
    );
}
