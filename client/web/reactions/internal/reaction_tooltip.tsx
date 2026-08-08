import {ReactElement, Ref, forwardRef, useMemo} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useElementWithRef} from "~/client/web/helpers/refs/use_element_with_ref.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.open_source.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

const ReactionTooltipForwardRef = forwardRef(ReactionTooltip);
export {ReactionTooltipForwardRef as ReactionTooltip};

function ReactionTooltip(
    {
        reactions,
        introduction,
        withContextMenuInstructions,
        children,
    }: {
        reactions: ReadonlyArray<{readonly accountId: AccountId}>;
        introduction?: string;
        withContextMenuInstructions?: boolean;
        children: ReactElement;
    },
    ref: Ref<HTMLElement>,
) {
    const {space, currentAccount} = useSpaceContext();
    const element = useElementWithRef(children, ref);

    const allAccounts =
        useLazyLoadRpc(
            expensivelyGetAllSpaceAccounts,
            currentAccount && reactions.length > 0 ? {spaceId: space.id} : null,
            {
                // Only fetch our space accounts once. Won't refetch as subsequent
                // `<ReactionParty>` components mount. Also won't refetch if the user hides the
                // window then comes back.
                //
                // We render `<ReactionParty>` a lot so we don't want it making a bunch of RPC
                // calls every time it mounts.
                onlyFetchIfNotAvailable: true,
            },
        ).output?.accounts ?? emptyArray;

    if (!currentAccount) {
        return element;
    }

    return (
        <Tooltip
            isDisabled={reactions.length === 0}
            placement="top-start"
            content={
                <ReactionTooltipContent
                    allAccounts={allAccounts}
                    currentAccount={currentAccount}
                    introduction={introduction}
                    withContextMenuInstructions={withContextMenuInstructions}
                    reactions={reactions}
                />
            }
        >
            {element}
        </Tooltip>
    );
}

function ReactionTooltipContent({
    allAccounts,
    currentAccount,
    reactions,
    introduction,
    withContextMenuInstructions,
}: {
    allAccounts: ReadonlyArray<AccountModel>;
    currentAccount: AccountModel;
    reactions: ReadonlyArray<{readonly accountId: AccountId}>;
    introduction: string | undefined;
    withContextMenuInstructions: boolean | undefined;
}) {
    const {locale} = useClientInfo();
    const accountRegistry = useAccountRegistry();

    const string = useStore(
        useMemo(() => {
            return computeStore(get => {
                if (reactions.length === 0) return "";

                // If there's only one reaction, use the full name of the account.
                if (reactions.length === 1) {
                    if (reactions[0]!.accountId === currentAccount.id) {
                        return introduction ? `${introduction} you` : "You";
                    }

                    const {accountId} = reactions[0]!;

                    const account =
                        allAccounts.find(account => account.id === accountId) ??
                        AccountModel.getUnknown();

                    return (
                        (introduction ? `${introduction} ` : "") +
                        get(accountRegistry.getAccountStore(account)).name
                    );
                }

                const reactionAccountIds = new Set(
                    mapIterable(reactions, entry => entry.accountId),
                );

                const maxAccountNameCount = 4;

                const accountNames = Array.from(
                    sliceIterable(
                        // Iterate through `allAccounts` which should be in affinity order so we show
                        // accounts the user has the most affinity for first.
                        filterMapIterable(allAccounts, account =>
                            account.id !== currentAccount.id && reactionAccountIds.has(account.id)
                                ? getAccountShortNameWithoutFullNameTooltip(
                                      get(accountRegistry.getAccountStore(account)),
                                  )
                                : undefined,
                        ),
                        0,
                        maxAccountNameCount,
                    ),
                );

                if (reactionAccountIds.has(currentAccount.id)) {
                    accountNames.unshift(introduction ? "you" : "You");
                }

                // Use the unknown account name for any accounts we didn't find in `allAccounts`.
                while (
                    accountNames.length < maxAccountNameCount &&
                    reactionAccountIds.size > accountNames.length
                ) {
                    accountNames.push(AccountModel.getUnknownData().name);
                }

                if (reactionAccountIds.size > accountNames.length) {
                    accountNames.push(
                        printPrettyNumber(
                            locale,
                            reactionAccountIds.size - accountNames.length,
                            "other",
                        ),
                    );
                }

                return (
                    (introduction ? `${introduction} ` : "") +
                    joinPrettyConjunctionList(accountNames)
                );
            });
        }, [accountRegistry, allAccounts, currentAccount.id, introduction, locale, reactions]),
    );

    return (
        <>
            {string}
            {withContextMenuInstructions && (
                <>
                    {" "}
                    <Box display="inline" fontSize="25" color="grey-50">
                        (right click for more)
                    </Box>
                </>
            )}
        </>
    );
}
