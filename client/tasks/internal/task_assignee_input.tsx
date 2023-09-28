import {getInteractionModality, isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import classNames from "classnames";
import _Fuse from "fuse.js";
import {Check, MagnifyingGlass} from "phosphor-react";
import {
    Ref,
    RefObject,
    cloneElement,
    forwardRef,
    isValidElement,
    useImperativeHandle,
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
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {InputWithAutoGrowingWidth} from "~/client/helpers/input_with_auto_growing_width.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {useExpensivelyLoadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {TaskMissingAccountAvatar} from "~/client/tasks/internal/task_missing_account_avatar.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    colorSchemeVars,
    greyElevated2ClassName,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

const nullAssigneeLabel = "Nobody";

type TaskAssigneeInputItem =
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
          readonly value: string;
          readonly hasChanged: boolean;
          readonly shouldSelect: boolean;
      };

export type TaskAssigneeInputRef = {
    focus(): void;
};

const TaskAssigneeInputForwardRef = forwardRef(TaskAssigneeInput);
export {TaskAssigneeInputForwardRef as TaskAssigneeInput};

function TaskAssigneeInput(
    {
        assigneeAccountData,
        onAssigneeAccountChange,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        color = "grey-text",
        avatarSize = "5",
        shouldDisplayShortName,
        onArrowLeftLeaveKeyDown,
        onArrowRightLeaveKeyDown,
    }: {
        assigneeAccountData: AccountModelData | null;
        onAssigneeAccountChange: (assigneeAccount: AccountModel | null) => void;
        "aria-label"?: string;
        "aria-labelledby"?: string;
        color?: "grey-text" | "grey-60";
        avatarSize?: "5" | "4";
        shouldDisplayShortName?: boolean;
        onArrowLeftLeaveKeyDown?: () => void;
        onArrowRightLeaveKeyDown?: () => void;
    },
    ref: Ref<TaskAssigneeInputRef>,
) {
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

    const allUnsortedAccounts = useExpensivelyLoadAllSpaceAccounts() ?? emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allUnsortedAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allUnsortedAccounts]);

    const allItems = useStore(
        useMemo(() => {
            return Store.mapMany(
                allUnsortedAccounts.map(account => accountStore.getAccountStore(account)),
                allUnsortedAccountDatas => {
                    const allItems: Array<TaskAssigneeInputItem> = allUnsortedAccountDatas.map(
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

                        return item1.accountData.name.localeCompare(item2.accountData.name);
                    });

                    return allItems;
                },
            );
        }, [accountStore, allUnsortedAccounts, currentAccount.id]),
    );

    const itemsSearchIndex = useMemo(
        () =>
            new Fuse(allItems, {
                keys: [{name: "name", getFn: item => item.accountData?.name ?? nullAssigneeLabel}],
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
        menuTrigger: "focus",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue,
        onInputChange: inputValue => {
            setInputState(inputState => {
                // Must be in a typing state to accept new typing changes.
                if (inputState.type !== "Typing") return inputState;

                return {type: "Typing", value: inputValue, hasChanged: true, shouldSelect: false};
            });
        },

        onFocus: () => {
            // Select all text on focus.
            assertExists(inputRef.current).select();

            // When focused, switch to a typing state.
            setInputState(inputState => {
                if (inputState.type === "Typing") return inputState;
                return {type: "Typing", value: inputValue, hasChanged: false, shouldSelect: false};
            });
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
            <Item textValue={item.accountData?.name ?? nullAssigneeLabel}>
                <TaskAssigneeInputListBoxOptionItem item={item} />
            </Item>
        ),

        selectedKey,
        onSelectionChange: key => {
            assert(typeof key === "string");

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
                        value: getSelectionInputValue(
                            newAssigneeAccount
                                ? accountStore.getAccountStore(newAssigneeAccount).getSnapshot()
                                : null,
                        ),
                        hasChanged: false,
                        shouldSelect: true,
                    };
                });
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
        <Box
            marginLeft={avatarSize === "5" ? "-0.5" : undefined}
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
                    inputState.type === "Selection" && inputState.disableAnimationOut
                }
                placement="bottom-start"
                overlay={
                    <Box ref={popoverRef} position="relative">
                        <TaskAssigneeInputListBox
                            comboBoxState={comboBoxState}
                            listBoxRef={listBoxRef}
                            listBoxProps={listBoxProps}
                            selectedKey={selectedKey}
                        />
                    </Box>
                }
            >
                <FocusRing isVisibleWhenFocusWithin>
                    <Box
                        maxWidth="full"
                        height={avatarSize}
                        marginY={avatarSize === "5" ? "-0.5" : undefined}
                        overflow="hidden"
                        display="inline-flex"
                        alignItems="center"
                        gap={avatarSize === "5" ? "1.5" : "1"}
                        className={tasksStyles.textCursorNotInheritedClassName}
                        style={{
                            // `display: inline-block` creates an inline layout which adds extra space
                            // below the element. Adding `vertical-align` stops the space from being added.
                            // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                            verticalAlign: "top",
                        }}
                        onPointerDown={event => {
                            // If the backdrop of this element was clicked and the input is focused then
                            // don't let a click unfocus it.
                            if (event.target === event.currentTarget) {
                                event.preventDefault();
                                assertExists(inputRef.current).focus();
                            }

                            // Make sure to reopen the combobox whenever the pointer clicks the input.
                            comboBoxState.open();
                        }}
                    >
                        <Box flexShrink="0" pointerEvents="none">
                            {assigneeAccountData ? (
                                <AccountAvatar size={avatarSize} account={assigneeAccountData} />
                            ) : (
                                <TaskMissingAccountAvatar size={avatarSize} />
                            )}
                        </Box>
                        <InputWithAutoGrowingWidth
                            {...inputProps}
                            ref={inputRef}
                            placeholder={
                                assigneeAccountData ? selectionInputValue : nullAssigneeLabel
                            }
                            className={sprinkles({color, height: "4"})}
                        />
                    </Box>
                </FocusRing>
            </OverlayAnimated>
        </Box>
    );
}

function TaskAssigneeInputListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskAssigneeInputItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskAssigneeInputItem>;
    selectedKey: string;
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
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-20",
                    width: "48",
                    maxHeight: "64",
                    overflowX: "hidden",
                    overflowY: "auto",
                }),
            )}
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
                    <TaskAssigneeInputListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                        selectedKey={selectedKey}
                    />
                ))
            )}
        </ul>
    );
}

function TaskAssigneeInputListBoxOption({
    comboBoxState,
    item,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskAssigneeInputItem>;
    item: Node<TaskAssigneeInputItem>;
    selectedKey: string;
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
                    padding: "1.5",
                    borderRadius: "base",
                    color: "grey-text",
                    backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                })}
            >
                {cloneElement(item.rendered, {
                    isSelected: selectedKey === item.key,
                    isPressed,
                } as any)}
            </li>
        </FocusRing>
    );
}

function TaskAssigneeInputListBoxOptionItem({
    item,
    isSelected,
    isPressed,
}: {
    item: TaskAssigneeInputItem;
    isSelected?: boolean;
    isPressed?: boolean;
}) {
    assert(
        typeof isSelected === "boolean" && typeof isPressed === "boolean",
        "Expected to be rendered by <TaskAssigneeInputListBoxOption> which provides extra props",
    );

    switch (item.type) {
        case "Account": {
            return (
                <Box display="flex" alignItems="center" gap="1.5">
                    <AccountAvatar account={item.accountData} size="5" />
                    <Box flexGrow="1" fontStyle="truncate">
                        {item.accountData.name}
                    </Box>
                    {isSelected && (
                        <Box flexShrink="0" marginLeft="2">
                            <Check
                                size={spacing["3"]}
                                color={
                                    isPressed
                                        ? colorSchemeVars["grey-text"]
                                        : colorSchemeVars["grey-70"]
                                }
                            />
                        </Box>
                    )}
                </Box>
            );
        }
        case "Null": {
            return (
                <Box display="flex" alignItems="center" gap="1.5">
                    <TaskMissingAccountAvatar />
                    <Box flexGrow="1" fontStyle="truncate" color="grey-60">
                        {nullAssigneeLabel}
                    </Box>
                    {isSelected && (
                        <Box flexShrink="0" marginLeft="2">
                            <Check
                                size={spacing["3"]}
                                color={
                                    isPressed
                                        ? colorSchemeVars["grey-text"]
                                        : colorSchemeVars["grey-70"]
                                }
                            />
                        </Box>
                    )}
                </Box>
            );
        }
        default:
            throw exhaustive(item);
    }
}
