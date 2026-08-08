import _Fuse from "fuse.js";
import {Memo, ReactNode, useMemo, useState} from "react";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {PrettyNumber} from "~/client/web/design/pretty_number.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useIdlyPreloadRpc, useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {inputPlaceholderStyles, sprinkles} from "~/client/web/styles/styles.js";
import {TaskCurrentAccountAvatar} from "~/client/web/tasks/internal/task_current_account_avatar.js";
import {TaskQueryFilterEditorMultiSelectComboBox} from "~/client/web/tasks/internal/task_query_filter_editor_multi_select_combo_box.js";
import {TaskQueryFilterOperatorEditor} from "~/client/web/tasks/internal/task_query_filter_operator_editor.js";
import {TaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {TaskMissingAccountAvatar} from "~/client/web/tasks/task_missing_account_avatar.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.open_source.js";
import {iterableFindIndex} from "~/shared/helpers/iterable/iterable_find_index.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskQueryFilterAccountOperation} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    emptyTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

type TaskQueryFilterAccountOperationEditorMultiSelectComboBoxItem =
    | {
          readonly type: "Account";
          readonly key: AccountId;
          readonly textValue: string;
          readonly accountData: AccountModelData;
          readonly node: ReactNode;
      }
    | {
          readonly type: "CurrentAccount";
          readonly key: "CurrentAccount";
          readonly textValue: string;
          readonly node: ReactNode;
      }
    | {
          readonly type: "MissingAccount";
          readonly key: "MissingAccount";
          readonly textValue: string;
          readonly node: ReactNode;
      };

export function TaskQueryFilterAccountOperationEditor({
    queryReferencesForUrlGrant,
    inputLabel,
    shouldHideMissingAccountItem = false,
    filterReferences,
    operation,
    onOperationChange,
}: {
    queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
    inputLabel: string;
    shouldHideMissingAccountItem?: boolean;
    filterReferences: TaskQueryFilterReferences;
    operation: TaskQueryFilterAccountOperation;
    onOperationChange: (
        operation: TaskQueryFilterAccountOperation,
        options?: {mergeFilterReferences?: TaskQueryFilterReferences},
    ) => void;
}) {
    const {space, currentAccount} = useSpaceContext();

    useIdlyPreloadRpc(expensivelyGetAllSpaceAccounts, currentAccount ? {spaceId: space.id} : null);

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

    const normalizedAccountIds: Memo<ReadonlySet<AccountId | "MissingAccount">> = useMemo(() => {
        if (!accountIds.has("CurrentAccount"))
            return accountIds as ReadonlySet<AccountId | "MissingAccount">;

        const normalizedAccountIds = new Set(accountIds);
        normalizedAccountIds.delete("CurrentAccount");
        if (currentAccount) normalizedAccountIds.add(currentAccount.id);

        return normalizedAccountIds as ReadonlySet<AccountId | "MissingAccount">;
    }, [accountIds, currentAccount]);

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
            <TaskQueryFilterEditorMultiSelectComboBox<TaskQueryFilterAccountOperationEditorMultiSelectComboBoxItem>
                inputLabel={inputLabel}
                preview={
                    <TaskQueryFilterAccountOperationEditorPreview
                        filterReferences={filterReferences}
                        normalizedAccountIds={normalizedAccountIds}
                    />
                }
                selectedKeys={accountIds}
                onSelectedKeysChange={(newAccountIds, searchedItems) => {
                    const addedReferencedAccountIds = new Set(newAccountIds);
                    for (const accountId of accountIds) addedReferencedAccountIds.delete(accountId);
                    addedReferencedAccountIds.delete("CurrentAccount");
                    addedReferencedAccountIds.delete("MissingAccount");

                    const addedReferencedAccountById = new Map<AccountId, AccountModel>();

                    for (const item of searchedItems) {
                        if (item.type !== "Account") continue;
                        if (!addedReferencedAccountIds.delete(item.key)) continue;

                        addedReferencedAccountById.set(
                            item.key,
                            new AccountModel(item.accountData),
                        );

                        // Once we've found all the added accounts we can exit our loop.
                        if (addedReferencedAccountIds.size === 0) break;
                    }

                    // All `addedAccountIds` should have been found in `searchedItems`.
                    assert(addedReferencedAccountIds.size === 0);

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
                        {
                            mergeFilterReferences: {
                                ...emptyTaskQueryFilterReferences,
                                accountById: addedReferencedAccountById,
                            },
                        },
                    );
                }}
                useSearchedItems={searchInputValue =>
                    // The `useSearchedItems()` callback follows the rules of hooks.
                    // eslint-disable-next-line react-compiler/react-compiler
                    // eslint-disable-next-line react-hooks/rules-of-hooks
                    useTaskQueryFilterAccountOperationEditorSearchedItems({
                        queryReferencesForUrlGrant,
                        searchInputValue,
                        shouldHideMissingAccountItem,
                        accountIds,
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
    normalizedAccountIds: Memo<ReadonlySet<AccountId | "MissingAccount">>;
}) {
    const {currentAccount} = useSpaceContext();
    const accountRegistry = useAccountRegistry();

    const store = useMemo(() => {
        return computeStore(get => {
            if (normalizedAccountIds.size === 0) {
                return <Box style={inputPlaceholderStyles}>anyone</Box>;
            }

            const getAccountIfExists = (accountId: AccountId) =>
                accountId === currentAccount?.id
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
                        {account.id === currentAccount?.id
                            ? "me"
                            : getAccountShortNameWithoutFullNameTooltip(
                                  get(accountRegistry.getAccountStore(account)),
                              )}
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
            const accountCountWithMissingAccounts =
                normalizedAccountIds.size - (hasMissingAccount ? 1 : 0);

            const accounts = Array.from(
                filterMapIterable(normalizedAccountIds, accountId => {
                    if (accountId === "MissingAccount") return;
                    return getAccountIfExists(accountId);
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
        });
    }, [accountRegistry, currentAccount, filterReferences.accountById, normalizedAccountIds]);

    return useStore(store);
}

function useTaskQueryFilterAccountOperationEditorSearchedItems({
    queryReferencesForUrlGrant,
    searchInputValue,
    shouldHideMissingAccountItem,
    accountIds,
}: {
    queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
    searchInputValue: string;
    shouldHideMissingAccountItem: boolean;
    accountIds: ReadonlySet<AccountId | "CurrentAccount" | "MissingAccount">;
}) {
    const platform = usePlatform();
    const {space, currentAccount} = useSpaceContext();
    const accountRegistry = useAccountRegistry();

    // If `currentAccount` is non-null then `queryReferencesForUrlGrant` should be
    // null. Since the list of accounts we show the user should be loaded from the
    // server. Not from query references.
    if (currentAccount !== null) {
        assert(queryReferencesForUrlGrant === null);
    }

    const allAccounts = useLazyLoadRpc(
        expensivelyGetAllSpaceAccounts,
        currentAccount ? {spaceId: space.id} : null,
    ).output?.accounts;
    const isLoading = currentAccount && !allAccounts;

    const [initialAccountIds] = useState(accountIds);

    const allItemsStore = useMemo(() => {
        let accountDatasStore: Store<ReadonlyArray<AccountModelData>>;
        if (!queryReferencesForUrlGrant) {
            accountDatasStore = Store.many(
                (allAccounts ?? []).map(account => accountRegistry.getAccountStore(account)),
            );
        } else {
            accountDatasStore = new ConstStore(
                Array.from(queryReferencesForUrlGrant.accountById.values()).sort(
                    (account1, account2) => defaultCompareStrings(account1.name, account2.name),
                ),
            );
        }

        return accountDatasStore.map(accountDatas => {
            const allItems: Array<TaskQueryFilterAccountOperationEditorMultiSelectComboBoxItem> =
                accountDatas.map(accountData => ({
                    type: "Account",
                    key: accountData.id,
                    textValue: accountData.name,
                    accountData,
                    node: (
                        <>
                            <AccountAvatar size="5" account={accountData} />
                            <Box flexGrow="1" paddingY="0.5" fontStyle="truncate">
                                {accountData.name}
                            </Box>
                        </>
                    ),
                }));

            if (currentAccount) {
                allItems.push({
                    type: "CurrentAccount",
                    key: "CurrentAccount",
                    textValue: "Me (dynamic)",
                    node: (
                        <>
                            <TaskCurrentAccountAvatar />
                            <Box flexGrow="1" paddingY="0.5" fontStyle="truncate">
                                Me{" "}
                                <Tooltip
                                    content="Whoever you share this view with will see their tasks instead of yours"
                                    placement="bottom"
                                >
                                    <span className={sprinkles({color: "grey-50"})}>
                                        (dynamic{platform !== "mobile" && "*"})
                                    </span>
                                </Tooltip>
                            </Box>
                        </>
                    ),
                });
            }

            if (!shouldHideMissingAccountItem || initialAccountIds.has("MissingAccount")) {
                allItems.push({
                    type: "MissingAccount",
                    key: "MissingAccount",
                    textValue: "Nobody",
                    node: (
                        <>
                            <TaskMissingAccountAvatar />
                            <Box flexGrow="1" paddingY="0.5" fontStyle="truncate" color="grey-60">
                                Nobody
                            </Box>
                        </>
                    ),
                });
            }

            allItems.sort((item1, item2) => {
                if (item1.key === "MissingAccount") return -1;
                if (item2.key === "MissingAccount") return 1;

                if (item1.key === "CurrentAccount") return -1;
                if (item2.key === "CurrentAccount") return 1;

                if (item1.key === currentAccount?.id) return -1;
                if (item2.key === currentAccount?.id) return 1;

                // Sort the selected accounts when the listbox was opened first in our items list.
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

                // Use the sort order from the server. The server returns accounts in affinity
                // order.
                return 0;
            });

            return allItems;
        });
    }, [
        accountRegistry,
        allAccounts,
        currentAccount,
        initialAccountIds,
        platform,
        queryReferencesForUrlGrant,
        shouldHideMissingAccountItem,
    ]);

    const allItems = useStore(allItemsStore);

    const itemsSearchIndex = useMemo(() => new Fuse(allItems, {keys: ["textValue"]}), [allItems]);

    return useMemo(() => {
        if (isLoading) return {isLoading: true as const};

        return {
            isLoading: false as const,
            searchedItems:
                searchInputValue === ""
                    ? // Don't include removed accounts in the initial rendered account list.
                      //
                      // TODO(calebmer): When searching, removed accounts should rank lower. How do we
                      // give them a lower score while still allowing users to find them?
                      allItems.filter(
                          item =>
                              item.type !== "Account" ||
                              item.accountData.space.state.type !== "Removed",
                      )
                    : itemsSearchIndex.search(searchInputValue).map(({item}) => item),
        };
    }, [allItems, isLoading, itemsSearchIndex, searchInputValue]);
}
