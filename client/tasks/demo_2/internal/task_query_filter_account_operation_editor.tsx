import Fuse from "fuse.js";
import {useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {PrettyNumber} from "~/client/design/pretty_number";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    useExpensivelyLoadAllSpaceAccounts,
    useExpensivelyPreloadAllSpaceAccounts,
} from "~/client/spaces/use_expensively_load_all_space_accounts";
import {TaskCurrentAccountAvatar} from "~/client/tasks/demo_2/internal/task_current_account_avatar";
import {TaskNoAccountAvatar} from "~/client/tasks/demo_2/internal/task_no_account_avatar";
import {
    TaskQueryFilterEditorMultiSelectComboBox,
    TaskQueryFilterEditorMultiSelectComboBoxItem,
} from "~/client/tasks/demo_2/internal/task_query_filter_editor_multi_select_combo_box";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/demo_2/internal/task_query_filter_operator_editor";
import {TaskQueryFilterAccountOperation} from "~/client/tasks/demo_2/task_query_filter";
import {AccountModel} from "~/shared/accounts/account_model";
import {missingAccountName} from "~/shared/accounts/missing_account_name";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {isId} from "~/shared/id/id";
import {AccountId} from "~/shared/id/types/id_types";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references";

export function TaskQueryFilterAccountOperationEditor({
    inputLabel,
    shouldHideNoAccountItem = false,
    filterReferences,
    operation,
    onOperationChange,
}: {
    inputLabel: string;
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
                inputLabel={inputLabel}
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
    inputLabel,
    shouldHideNoAccountItem,
    filterReferences,
    accountIds,
    normalizedAccountIds,
    onAccountIdsChange,
}: {
    inputLabel: string;
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

    const accountByIdRef = useRef<ReadonlyMap<AccountId, AccountModel>>(null);

    return (
        <TaskQueryFilterEditorMultiSelectComboBox
            inputLabel={inputLabel}
            preview={
                <TaskQueryFilterAccountOperationEditorAccountsPreview
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

                onAccountIdsChange(newAccountIds, {accountById: addedAccountById});
            }}
            useSearchedItems={searchInputValue =>
                // The `useSearchedItems()` callback follows the rules of hooks.
                // eslint-disable-next-line react-hooks/rules-of-hooks
                useTaskQueryFilterAccountOperationEditorSearchedItems({
                    searchInputValue,
                    shouldHideNoAccountItem,
                    accountIds,
                    accountByIdRef,
                })
            }
        />
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

function useTaskQueryFilterAccountOperationEditorSearchedItems({
    searchInputValue,
    shouldHideNoAccountItem,
    accountIds,
    accountByIdRef,
}: {
    searchInputValue: string;
    shouldHideNoAccountItem: boolean;
    accountIds: ReadonlySet<AccountId | "CurrentAccount" | "NoAccount">;
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
            TaskQueryFilterEditorMultiSelectComboBoxItem<AccountId | "CurrentAccount" | "NoAccount">
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
                        Me <span className={sprinkles({color: "grey-50"})}>(dynamic)</span>
                    </span>
                </>
            ),
        });

        if (!shouldHideNoAccountItem || initialAccountIds.has("NoAccount")) {
            allItems.push({
                key: "NoAccount",
                textValue: "Nobody",
                node: (
                    <>
                        <TaskNoAccountAvatar />{" "}
                        <span className={sprinkles({color: "grey-60"})}>Nobody</span>
                    </>
                ),
            });
        }

        allItems.sort((item1, item2) => {
            if (item1.key === "NoAccount") return -1;
            if (item2.key === "NoAccount") return 1;

            if (item1.key === "CurrentAccount") return -1;
            if (item2.key === "CurrentAccount") return 1;

            if (item1.key === currentAccount.id) return -1;
            if (item2.key === currentAccount.id) return 1;

            // Sort the selected accounts when the listbox was opened first in our
            // items list.
            if (initialAccountIds.has(item1.key) && !initialAccountIds.has(item2.key)) {
                return -1;
            }
            if (initialAccountIds.has(item2.key) && !initialAccountIds.has(item1.key)) {
                return 1;
            }

            return item1.textValue.localeCompare(item2.textValue);
        });

        return allItems;
    }, [allUnsortedAccounts, currentAccount.id, initialAccountIds, shouldHideNoAccountItem]);

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
