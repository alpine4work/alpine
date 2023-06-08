import {isFocusVisible, usePress} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import Fuse from "fuse.js";
import {Check, MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
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
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {useOutsidePress} from "~/client/design/helpers/use_outside_press";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {PrettyNumber} from "~/client/design/pretty_number";
import {defaultTooltipOffset} from "~/client/design/tooltip";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    useExpensivelyLoadAllSpaceAccounts,
    useExpensivelyPreloadAllSpaceAccounts,
} from "~/client/spaces/use_expensively_load_all_space_accounts";
import {TaskCurrentAccountAvatar} from "~/client/tasks/demo_2/internal/task_current_account_avatar";
import {TaskNoAccountAvatar} from "~/client/tasks/demo_2/internal/task_no_account_avatar";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/demo_2/internal/task_query_filter_operator_editor";
import {TaskQueryFilterAccountOperation} from "~/client/tasks/demo_2/task_query_filter";
import {AccountModel} from "~/shared/accounts/account_model";
import {missingAccountName} from "~/shared/accounts/missing_account_name";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {noop} from "~/shared/helpers/control/noop";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {isId} from "~/shared/id/id";
import {AccountId} from "~/shared/id/types/id_types";
import {
    colorSchemeVars,
    inputPlaceholderStyles,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references";

export function TaskQueryFilterAccountOperationEditor({
    label,
    shouldHideNoAccountItem = false,
    filterReferences,
    operation,
    onOperationChange,
}: {
    label: string;
    shouldHideNoAccountItem?: boolean;
    filterReferences: TaskQueryFilterReferences;
    operation: TaskQueryFilterAccountOperation;
    onOperationChange: (
        operation: TaskQueryFilterAccountOperation,
        mergeFilterReferences?: TaskQueryFilterReferences,
    ) => void;
}) {
    const {currentAccount} = useSpaceContext();

    const accountIds = useMemo(() => {
        const accountIds = new Set<AccountId | "CurrentAccount" | "NoAccount">();

        for (const account of operation.accounts) {
            switch (account.type) {
                case "Account":
                    accountIds.add(account.accountId);
                    break;
                case "CurrentAccount":
                    accountIds.add("CurrentAccount");
                    break;
                case "NoAccount":
                    accountIds.add("NoAccount");
                    break;
                default:
                    throw exhaustive(account);
            }
        }

        return accountIds;
    }, [operation.accounts]);

    const normalizedAccountIds: ReadonlySet<AccountId | "NoAccount"> = useMemo(() => {
        if (!accountIds.has("CurrentAccount"))
            return accountIds as ReadonlySet<AccountId | "NoAccount">;

        const normalizedAccountIds = new Set(accountIds);
        normalizedAccountIds.delete("CurrentAccount");
        normalizedAccountIds.add(currentAccount.id);

        return normalizedAccountIds as ReadonlySet<AccountId | "NoAccount">;
    }, [accountIds, currentAccount.id]);

    const oneOfOperatorLabel = normalizedAccountIds.size > 1 ? "is one of" : "is";
    const noneOfOperatorLabel = normalizedAccountIds.size > 1 ? "is not one of" : "is not";

    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={
                    operation.type === "OneOf" ? oneOfOperatorLabel : noneOfOperatorLabel
                }
                allOperators={[
                    {
                        label: oneOfOperatorLabel,
                        onPress: () => {
                            onOperationChange({
                                type: "OneOf",
                                accounts: operation.accounts,
                            });
                        },
                    },
                    {
                        label: noneOfOperatorLabel,
                        onPress: () => {
                            onOperationChange({
                                type: "NoneOf",
                                accounts: operation.accounts,
                            });
                        },
                    },
                ]}
            />
            <TaskQueryFilterAccountOperationEditorAccounts
                label={label}
                shouldHideNoAccountItem={shouldHideNoAccountItem}
                filterReferences={filterReferences}
                accountIds={accountIds}
                normalizedAccountIds={normalizedAccountIds}
                onAccountIdsChange={(accountIds, mergeFilterReferences) => {
                    onOperationChange(
                        {
                            type: operation.type,
                            accounts: Array.from(accountIds, accountId => {
                                if (accountId === "CurrentAccount") {
                                    return {type: "CurrentAccount"};
                                } else if (accountId === "NoAccount") {
                                    return {type: "NoAccount"};
                                } else {
                                    return {type: "Account", accountId};
                                }
                            }),
                        },
                        mergeFilterReferences,
                    );
                }}
            />
        </>
    );
}

function TaskQueryFilterAccountOperationEditorAccounts({
    label,
    shouldHideNoAccountItem,
    filterReferences,
    accountIds,
    normalizedAccountIds,
    onAccountIdsChange,
}: {
    label: string;
    shouldHideNoAccountItem: boolean;
    filterReferences: TaskQueryFilterReferences;
    accountIds: ReadonlySet<AccountId | "CurrentAccount" | "NoAccount">;
    normalizedAccountIds: ReadonlySet<AccountId | "NoAccount">;
    onAccountIdsChange: (
        accountIds: ReadonlySet<AccountId | "CurrentAccount" | "NoAccount">,
        mergeFilterReferences: TaskQueryFilterReferences,
    ) => void;
}) {
    useExpensivelyPreloadAllSpaceAccounts();

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
                    maxHeight="64"
                    overflow="hidden"
                    borderRadius="md"
                    backgroundColor={{light: "grey-0", dark: "grey-5"}}
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                >
                    <TaskQueryFilterAccountOperationEditorOverlay
                        label={label}
                        shouldHideNoAccountItem={shouldHideNoAccountItem}
                        selectedAccountIds={accountIds}
                        onSelectedAccountIdsChange={onAccountIdsChange}
                        onCloseWithoutAnimation={() => overlayTriggerState.close()}
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
                            gap: "1",
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
                        <TaskQueryFilterAccountOperationEditorAccountsPreview
                            filterReferences={filterReferences}
                            normalizedAccountIds={normalizedAccountIds}
                        />
                    </span>
                </button>
            </FocusRing>
        </OverlayAnimated>
    );
}

function TaskQueryFilterAccountOperationEditorAccountsPreview({
    filterReferences,
    normalizedAccountIds,
}: {
    filterReferences: TaskQueryFilterReferences;
    normalizedAccountIds: ReadonlySet<AccountId | "NoAccount">;
}) {
    const {currentAccount} = useSpaceContext();

    if (normalizedAccountIds.size === 0) {
        return <span style={inputPlaceholderStyles}>anyone</span>;
    }

    const getAccountIfExists = (accountId: AccountId) =>
        accountId === currentAccount.id
            ? currentAccount
            : filterReferences.accountById.get(accountId);

    const renderSingleAccount = (account: AccountModel) => (
        <>
            <AccountAvatar size="3" account={account} />{" "}
            {account.id === currentAccount.id
                ? "me"
                : getAccountShortNameWithoutFullNameTooltip(account)}
        </>
    );

    if (normalizedAccountIds.size === 1) {
        const firstStep = normalizedAccountIds[Symbol.iterator]().next();
        assert(!firstStep.done);

        if (firstStep.value === "NoAccount") {
            return (
                <>
                    <TaskNoAccountAvatar size="3" />{" "}
                    <span className={sprinkles({color: "grey-60"})}>nobody</span>
                </>
            );
        } else {
            const account = getAccountIfExists(firstStep.value);
            if (!account) return <>{missingAccountName}</>;
            return renderSingleAccount(account);
        }
    }

    const hasNoAccount = normalizedAccountIds.has("NoAccount");
    const accountCountWithMissingAccounts = normalizedAccountIds.size - (hasNoAccount ? 1 : 0);

    const accounts = Array.from(
        filterMapIterable(normalizedAccountIds, accountId => {
            if (accountId === "NoAccount") return null;
            return getAccountIfExists(accountId) ?? null;
        }),
    );

    const previewWithoutNoAccount =
        accountCountWithMissingAccounts === 1 && accounts[0] ? (
            renderSingleAccount(accounts[0])
        ) : (
            <>
                {accounts.length > 0 && (
                    <AccountAvatarPile
                        size="3"
                        previewAccounts={accounts.slice(0, 3)}
                        accountCount={accounts.length}
                        getAllAccounts={() => accounts}
                    />
                )}
                <PrettyNumber
                    number={accountCountWithMissingAccounts}
                    label="person"
                    pluralLabel="people"
                />
            </>
        );

    if (!hasNoAccount) {
        return previewWithoutNoAccount;
    }

    return (
        <>
            {previewWithoutNoAccount}{" "}
            <span className={sprinkles({color: "grey-60", marginRight: "0.5"})}>or</span>{" "}
            <TaskNoAccountAvatar size="3" />{" "}
            <span className={sprinkles({color: "grey-60"})}>nobody</span>
        </>
    );
}

type TaskQueryFilterAccountOperationEditorItem =
    | {
          readonly type: "Account";
          readonly key: AccountId;
          readonly account: AccountModel;
      }
    | {
          readonly type: "CurrentAccount";
          readonly key: "CurrentAccount";
      }
    | {
          readonly type: "NoAccount";
          readonly key: "NoAccount";
      };

function TaskQueryFilterAccountOperationEditorOverlay({
    label,
    shouldHideNoAccountItem,
    selectedAccountIds,
    onSelectedAccountIdsChange,
    onCloseWithoutAnimation,
}: {
    label: string;
    shouldHideNoAccountItem: boolean;
    selectedAccountIds: ReadonlySet<AccountId | "CurrentAccount" | "NoAccount">;
    onSelectedAccountIdsChange: (
        selectedAccountIds: ReadonlySet<AccountId | "CurrentAccount" | "NoAccount">,
        mergeFilterReferences: TaskQueryFilterReferences,
    ) => void;
    onCloseWithoutAnimation: () => void;
}) {
    const {currentAccount} = useSpaceContext();
    const allUnsortedAccounts = useExpensivelyLoadAllSpaceAccounts();

    const accountById = useMemo(
        () => new Map(allUnsortedAccounts?.map(account => [account.id, account])),
        [allUnsortedAccounts],
    );

    const [initialSelectedAccountIds] = useState(() => selectedAccountIds);

    const allItems = useMemo(() => {
        const allItems: Array<TaskQueryFilterAccountOperationEditorItem> = (
            allUnsortedAccounts ?? []
        ).map(account => ({
            type: "Account",
            key: account.id,
            account,
        }));

        allItems.push({type: "CurrentAccount", key: "CurrentAccount"});

        if (!shouldHideNoAccountItem || initialSelectedAccountIds.has("NoAccount")) {
            allItems.push({type: "NoAccount", key: "NoAccount"});
        }

        allItems.sort((item1, item2) => {
            if (item1.type === "NoAccount") return -1;
            if (item2.type === "NoAccount") return 1;

            if (item1.type === "CurrentAccount") return -1;
            if (item2.type === "CurrentAccount") return 1;

            if (item1.account.id === currentAccount.id) return -1;
            if (item2.account.id === currentAccount.id) return 1;

            // Sort the selected accounts when the listbox was opened first in our
            // items list.
            if (
                initialSelectedAccountIds.has(item1.account.id) &&
                !initialSelectedAccountIds.has(item2.account.id)
            ) {
                return -1;
            }
            if (
                initialSelectedAccountIds.has(item2.account.id) &&
                !initialSelectedAccountIds.has(item1.account.id)
            ) {
                return 1;
            }

            return item1.account.name.localeCompare(item2.account.name);
        });

        return allItems;
    }, [
        allUnsortedAccounts,
        currentAccount.id,
        initialSelectedAccountIds,
        shouldHideNoAccountItem,
    ]);

    const getItemTextValue = useCallback((item: TaskQueryFilterAccountOperationEditorItem) => {
        switch (item.type) {
            case "Account":
                return item.account.name;
            case "NoAccount":
                return "Nobody";
            case "CurrentAccount":
                return "Me (dynamic)";
            default:
                throw exhaustive(item);
        }
    }, []);

    const itemsSearchIndex = useMemo(
        () =>
            new Fuse(allItems, {
                keys: [{name: "name", getFn: getItemTextValue}],
            }),
        [allItems, getItemTextValue],
    );

    const [inputValue, setInputValue] = useState("");

    const searchedItems = useMemo(
        () =>
            inputValue === ""
                ? allItems
                : itemsSearchIndex.search(inputValue).map(({item}) => item),

        [allItems, inputValue, itemsSearchIndex],
    );

    const listChildren = (item: TaskQueryFilterAccountOperationEditorItem) => (
        <Item textValue={getItemTextValue(item)}>
            <TaskQueryFilterAccountOperationEditorListBoxOptionItem item={item} />
        </Item>
    );

    const {collection, selectionManager, disabledKeys} = useListState({
        items: searchedItems,
        children: listChildren,

        selectionMode: "multiple",
        selectedKeys: selectedAccountIds,
        onSelectionChange: newSelectedAccountIds => {
            // Ignore "all" selections. Doesn't make sense for this input.
            if (newSelectedAccountIds === "all") return;

            const addedAccountIds = new Set(newSelectedAccountIds);
            for (const accountId of selectedAccountIds) addedAccountIds.delete(accountId);

            const addedAccountById = new Map<AccountId, AccountModel>();

            for (const accountId of addedAccountIds) {
                if (typeof accountId === "string" && isId<AccountId>(accountId)) {
                    const account = accountById.get(accountId);
                    if (account) addedAccountById.set(account.id, account);
                }
            }

            onSelectedAccountIdsChange(
                newSelectedAccountIds as ReadonlySet<AccountId | "CurrentAccount" | "NoAccount">,
                {accountById: addedAccountById},
            );

            onCloseWithoutAnimation();
        },
    });

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const comboBoxState: ComboBoxState<TaskQueryFilterAccountOperationEditorItem> = {
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
            "aria-label": label,
            inputRef,
            popoverRef,
            listBoxRef,
            autoFocus: false,
            shouldFocusWrap: false,
            items: searchedItems,
            children: listChildren,
        },
        comboBoxState,
    );

    // Autofocus our input.
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
                    placeholder={label}
                />
            </FocusRing>
            <Box
                ref={popoverRef}
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
            >
                {!allUnsortedAccounts ? (
                    <Box paddingY="7" display="flex" justifyContent="center">
                        <SpinnerGap
                            className={spinAnimationClassName}
                            color={colorSchemeVars["grey-70"]}
                            size={spacing["4"]}
                        />
                    </Box>
                ) : (
                    <TaskQueryFilterAccountOperationEditorListBox
                        comboBoxState={comboBoxState}
                        listBoxRef={listBoxRef}
                        listBoxProps={listBoxProps}
                    />
                )}
            </Box>
        </>
    );
}

function TaskQueryFilterAccountOperationEditorListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    comboBoxState: ComboBoxState<TaskQueryFilterAccountOperationEditorItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskQueryFilterAccountOperationEditorItem>;
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
                    <TaskQueryFilterAccountOperationEditorListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                    />
                ))
            )}
        </ul>
    );
}

function TaskQueryFilterAccountOperationEditorListBoxOption({
    comboBoxState,
    item,
}: {
    comboBoxState: ComboBoxState<TaskQueryFilterAccountOperationEditorItem>;
    item: Node<TaskQueryFilterAccountOperationEditorItem>;
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
                    alignItems: "center",
                    gap: "1.5",
                })}
            >
                <Box
                    width="3"
                    height="3"
                    border={!isSelected ? "grey-20" : undefined}
                    borderRadius="sm"
                    backgroundColor={!isSelected ? "grey-0" : {light: "grey-80", dark: "grey-90"}}
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
                {item.rendered}
            </li>
        </FocusRing>
    );
}

function TaskQueryFilterAccountOperationEditorListBoxOptionItem({
    item,
}: {
    item: TaskQueryFilterAccountOperationEditorItem;
}) {
    switch (item.type) {
        case "CurrentAccount": {
            return (
                <>
                    <TaskCurrentAccountAvatar />{" "}
                    <span>
                        Me <span className={sprinkles({color: "grey-50"})}>(dynamic)</span>
                    </span>
                </>
            );
        }
        case "NoAccount": {
            return (
                <>
                    <TaskNoAccountAvatar />{" "}
                    <span className={sprinkles({color: "grey-60"})}>Nobody</span>
                </>
            );
        }
        case "Account": {
            return (
                <>
                    <AccountAvatar size="5" account={item.account} />
                    <Box flexGrow="1" fontStyle="truncate">
                        {item.account.name}
                    </Box>
                </>
            );
        }
        default:
            throw exhaustive(item);
    }
}
