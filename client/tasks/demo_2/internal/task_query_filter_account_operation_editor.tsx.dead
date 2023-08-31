import _Fuse from "fuse.js";
import {MutableRefObject, useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    useExpensivelyLoadAllSpaceAccounts,
    useExpensivelyPreloadAllSpaceAccounts,
} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {TaskCurrentAccountAvatar} from "~/client/tasks/demo_2/internal/task_current_account_avatar.js";
import {TaskMissingAccountAvatar} from "~/client/tasks/demo_2/internal/task_missing_account_avatar.js";
import {
    TaskQueryFilterEditorMultiSelectComboBox,
    TaskQueryFilterEditorMultiSelectComboBoxItem,
} from "~/client/tasks/demo_2/internal/task_query_filter_editor_multi_select_combo_box.js";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/demo_2/internal/task_query_filter_operator_editor.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFindIndex} from "~/shared/helpers/iterable/iterable_find_index.js";
import {isId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles.js";
import {TaskQueryFilterAccountOperation} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export function TaskQueryFilterAccountOperationEditor({
    inputLabel,
    shouldHideMissingAccountItem = false,
    filterReferences,
    operation,
    onOperationChange,
}: {
    inputLabel: string;
    shouldHideMissingAccountItem?: boolean;
    filterReferences: TaskQueryFilterReferences;
    operation: TaskQueryFilterAccountOperation;
    onOperationChange: (
        operation: TaskQueryFilterAccountOperation,
        mergeFilterReferences?: TaskQueryFilterReferences,
    ) => void;
}) {
    useExpensivelyPreloadAllSpaceAccounts();

    const {currentAccount} = useSpaceContext();

    const accountIds = useMemo(() => {
        const accountIds = new Set<AccountId | "CurrentAccount" | "MissingAccount">();

        for (const account of operation.accounts) {
            switch (account.type) {
                case "Account":
                    accountIds.add(account.accountId);
                    break;
                case "CurrentAccount":
                    accountIds.add("CurrentAccount");
                    break;
                case "MissingAccount":
                    accountIds.add("MissingAccount");
                    break;
                default:
                    throw exhaustive(account);
            }
        }

        return accountIds;
    }, [operation.accounts]);

    const normalizedAccountIds: ReadonlySet<AccountId | "MissingAccount"> = useMemo(() => {
        if (!accountIds.has("CurrentAccount"))
            return accountIds as ReadonlySet<AccountId | "MissingAccount">;

        const normalizedAccountIds = new Set(accountIds);
        normalizedAccountIds.delete("CurrentAccount");
        normalizedAccountIds.add(currentAccount.id);

        return normalizedAccountIds as ReadonlySet<AccountId | "MissingAccount">;
    }, [accountIds, currentAccount.id]);

    const oneOfOperatorLabel = normalizedAccountIds.size > 1 ? "is one of" : "is";
    const noneOfOperatorLabel = normalizedAccountIds.size > 1 ? "is not one of" : "is not";

    const accountByIdRef = useRef<ReadonlyMap<AccountId, AccountModel>>(null);

    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={
                    operation.type === "OneOf" ? oneOfOperatorLabel : noneOfOperatorLabel
                }
                allOperators={[
                    {
                        label: oneOfOperatorLabel,
                        isSelected: operation.type === "OneOf",
                        onPress: () => {
                            onOperationChange({
                                type: "OneOf",
                                accounts: operation.accounts,
                            });
                        },
                    },
                    {
                        label: noneOfOperatorLabel,
                        isSelected: operation.type === "NoneOf",
                        onPress: () => {
                            onOperationChange({
                                type: "NoneOf",
                                accounts: operation.accounts,
                            });
                        },
                    },
                ]}
            />
            <TaskQueryFilterEditorMultiSelectComboBox
                inputLabel={inputLabel}
                preview={
                    <TaskQueryFilterAccountOperationEditorPreview
                        filterReferences={filterReferences}
                        normalizedAccountIds={normalizedAccountIds}
                    />
                }
                selectedKeys={accountIds}
                onSelectedKeysChange={newAccountIds => {
                    const addedAccountIds = new Set(newAccountIds);
                    for (const accountId of accountIds) addedAccountIds.delete(accountId);

                    const addedAccountById = new Map<AccountId, AccountModel>();

                    for (const accountId of addedAccountIds) {
                        if (typeof accountId === "string" && isId<AccountId>(accountId)) {
                            const account = accountByIdRef.current?.get(accountId);
                            if (account) addedAccountById.set(account.id, account);
                        }
                    }

                    onOperationChange(
                        {
                            type: operation.type,
                            accounts: Array.from(newAccountIds, accountId => {
                                if (accountId === "CurrentAccount") {
                                    return {type: "CurrentAccount"};
                                } else if (accountId === "MissingAccount") {
                                    return {type: "MissingAccount"};
                                } else {
                                    return {type: "Account", accountId};
                                }
                            }),
                        },
                        {accountById: addedAccountById},
                    );
                }}
                useSearchedItems={searchInputValue =>
                    // The `useSearchedItems()` callback follows the rules of hooks.
                    // eslint-disable-next-line react-hooks/rules-of-hooks
                    useTaskQueryFilterAccountOperationEditorSearchedItems({
                        searchInputValue,
                        shouldHideMissingAccountItem,
                        accountIds,
                        accountByIdRef,
                    })
                }
            />
        </>
    );
}

function TaskQueryFilterAccountOperationEditorPreview({
    filterReferences,
    normalizedAccountIds,
}: {
    filterReferences: TaskQueryFilterReferences;
    normalizedAccountIds: ReadonlySet<AccountId | "MissingAccount">;
}) {
    const {currentAccount} = useSpaceContext();

    if (normalizedAccountIds.size === 0) {
        return <Box style={inputPlaceholderStyles}>anyone</Box>;
    }

    const getAccountIfExists = (accountId: AccountId) =>
        accountId === currentAccount.id
            ? currentAccount
            : filterReferences.accountById.get(accountId);

    const renderMissingAccount = () => (
        <>
            <TaskMissingAccountAvatar size="3" />{" "}
            <Box paddingLeft="1" color="grey-60">
                nobody
            </Box>
        </>
    );

    const renderSingleAccount = (account: AccountModel) => (
        <>
            <AccountAvatar size="3" account={account} />{" "}
            <Box paddingLeft="1">
                {account.id === currentAccount.id
                    ? "me"
                    : getAccountShortNameWithoutFullNameTooltip(account)}
            </Box>
        </>
    );

    if (normalizedAccountIds.size === 1) {
        const firstStep = normalizedAccountIds[Symbol.iterator]().next();
        assert(!firstStep.done);

        if (firstStep.value === "MissingAccount") {
            return renderMissingAccount();
        } else {
            const account = getAccountIfExists(firstStep.value);
            if (!account) return <>{missingAccountName}</>;
            return renderSingleAccount(account);
        }
    }

    const hasMissingAccount = normalizedAccountIds.has("MissingAccount");
    const accountCountWithMissingAccounts = normalizedAccountIds.size - (hasMissingAccount ? 1 : 0);

    const accounts = Array.from(
        filterMapIterable(normalizedAccountIds, accountId => {
            if (accountId === "MissingAccount") return null;
            return getAccountIfExists(accountId) ?? null;
        }),
    );

    const previewWithoutMissingAccount =
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
                <Box paddingLeft={accounts.length > 0 ? "1" : undefined}>
                    <PrettyNumber
                        number={accountCountWithMissingAccounts}
                        label="person"
                        pluralLabel="people"
                    />
                </Box>
            </>
        );

    if (!hasMissingAccount) {
        return previewWithoutMissingAccount;
    }

    return (
        <>
            {previewWithoutMissingAccount}
            <Box color="grey-60" paddingLeft="1" paddingRight="1.5">
                or
            </Box>
            {renderMissingAccount()}
        </>
    );
}

function useTaskQueryFilterAccountOperationEditorSearchedItems({
    searchInputValue,
    shouldHideMissingAccountItem,
    accountIds,
    accountByIdRef,
}: {
    searchInputValue: string;
    shouldHideMissingAccountItem: boolean;
    accountIds: ReadonlySet<AccountId | "CurrentAccount" | "MissingAccount">;
    accountByIdRef: MutableRefObject<ReadonlyMap<AccountId, AccountModel> | null>;
}) {
    const {currentAccount} = useSpaceContext();
    const allUnsortedAccounts = useExpensivelyLoadAllSpaceAccounts();
    const isLoading = !allUnsortedAccounts;

    useEffect(() => {
        accountByIdRef.current = new Map(
            allUnsortedAccounts?.map(account => [account.id, account]),
        );

        return () => {
            accountByIdRef.current = null;
        };
    }, [accountByIdRef, allUnsortedAccounts]);

    const [initialAccountIds] = useState(() => accountIds);

    const allItems = useMemo(() => {
        const allItems: Array<
            TaskQueryFilterEditorMultiSelectComboBoxItem<
                AccountId | "CurrentAccount" | "MissingAccount"
            >
        > = (allUnsortedAccounts ?? []).map(account => ({
            key: account.id,
            textValue: account.name,
            node: (
                <>
                    <AccountAvatar size="5" account={account} />
                    <Box flexGrow="1" fontStyle="truncate">
                        {account.name}
                    </Box>
                </>
            ),
        }));

        allItems.push({
            key: "CurrentAccount",
            textValue: "Me (dynamic)",
            node: (
                <>
                    <TaskCurrentAccountAvatar />{" "}
                    <span>
                        Me{" "}
                        <Tooltip
                            content="Whoever you share this view with will see their tasks instead of yours"
                            placement="bottom"
                        >
                            <span className={sprinkles({color: "grey-50"})}>(dynamic*)</span>
                        </Tooltip>
                    </span>
                </>
            ),
        });

        if (!shouldHideMissingAccountItem || initialAccountIds.has("MissingAccount")) {
            allItems.push({
                key: "MissingAccount",
                textValue: "Nobody",
                node: (
                    <>
                        <TaskMissingAccountAvatar />{" "}
                        <span className={sprinkles({color: "grey-60"})}>Nobody</span>
                    </>
                ),
            });
        }

        allItems.sort((item1, item2) => {
            if (item1.key === "MissingAccount") return -1;
            if (item2.key === "MissingAccount") return 1;

            if (item1.key === "CurrentAccount") return -1;
            if (item2.key === "CurrentAccount") return 1;

            if (item1.key === currentAccount.id) return -1;
            if (item2.key === currentAccount.id) return 1;

            // Sort the selected accounts when the listbox was opened first in our
            // items list.
            const isInitialAccount1 = initialAccountIds.has(item1.key);
            const isInitialAccount2 = initialAccountIds.has(item2.key);

            if (isInitialAccount1 && !isInitialAccount2) return -1;
            if (isInitialAccount2 && !isInitialAccount1) return 1;

            if (isInitialAccount1 && isInitialAccount2) {
                return (
                    iterableFindIndex(initialAccountIds, accountId => accountId === item1.key) -
                    iterableFindIndex(initialAccountIds, accountId => accountId === item2.key)
                );
            }

            return item1.textValue.localeCompare(item2.textValue);
        });

        return allItems;
    }, [allUnsortedAccounts, currentAccount.id, initialAccountIds, shouldHideMissingAccountItem]);

    const itemsSearchIndex = useMemo(() => new Fuse(allItems, {keys: ["textValue"]}), [allItems]);

    return useMemo(() => {
        if (isLoading) return {isLoading: true as const};

        return {
            isLoading: false as const,
            searchedItems:
                searchInputValue === ""
                    ? allItems
                    : itemsSearchIndex.search(searchInputValue).map(({item}) => item),
        };
    }, [allItems, isLoading, itemsSearchIndex, searchInputValue]);
}
