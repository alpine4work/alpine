import {compareAsc, compareDesc} from "date-fns";
import {CaretDown} from "phosphor-react";
import {useMemo, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {
    useAccountModel,
    useAccountRegistry,
} from "~/client/web/accounts/account_registry_context.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useRevalidator} from "~/client/web/remix/use_revalidator.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {SettingsInvitePeopleModal} from "~/client/web/settings/settings_invite_people_modal.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    expensivelyGetAllSpaceAccounts as expensivelyGetAllSpaceAccountsRpc,
    moveSpaceOwner,
    removeSpaceAccount,
    updateSpaceAccountRole,
} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    AccountModel,
    AccountModelData,
    AccountModelDataWithActiveState,
    AccountModelDataWithInvitePendingState,
    AccountModelDataWithRemovedState,
} from "~/shared/spaces/account_model.js";
import {SpaceRole, hasSpaceRole} from "~/shared/spaces/space_model.js";
import {Store} from "~/shared/store/store.js";

const LoaderSchema = Schema.object({
    allAccounts: Schema.array(AccountModel.schema),
});

export async function loader({context, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const allAccounts = await expensivelyGetAllSpaceAccounts(
        await context.actor.authenticate(),
        spaceId,
        {consistency: "Strong"},
    );

    return jsonWithSchema(LoaderSchema, {allAccounts});
}

export default function SpacePeopleSettingsRoute() {
    const {allAccounts} = useLoaderDataWithSchema(LoaderSchema);
    const {currentAccount, space} = useSpaceContextAndRequireSpaceAccess();
    const currentAccountData = useAccountModel(currentAccount);
    const appContext = useAppContext();
    const accountRegistry = useAccountRegistry();
    const {revalidate} = useRevalidator();

    // Add `accounts` to the RPC cache so future RPC calls have access to them
    // and we can skip any preloads but don't read `accounts` from the RPC
    // cache since it may have eventually consistent data that overrides our strongly
    // consistent `accounts` loaded from the server!
    useLazyLoadRpc(
        expensivelyGetAllSpaceAccountsRpc,
        {spaceId: space.id},
        {initialOutput: useMemo(() => ({accounts: allAccounts}), [allAccounts])},
    );

    const [modalState, setModalState] = useState<
        | {
              type: "ConfirmOwner";
              accountData: AccountModelData;
          }
        | {
              type: "ConfirmDelete";
              accountData: AccountModelData;
          }
        | {
              type: "SendInvites";
          }
        | null
    >(null);

    // Make sure we sync our fetched accounts data with accountStore to get the latest
    // and consistent data across the application.
    const allAccountsDatas = useStore(
        useMemo(
            () =>
                Store.many(
                    (allAccounts ?? []).map(account => accountRegistry.getAccountStore(account)),
                ),
            [accountRegistry, allAccounts],
        ),
    );

    // check "Admin" access for currently logged in account.
    const hasAdminAccess = hasSpaceRole(currentAccountData.space.role, "Admin");

    const {
        activeAccounts,
        removedAccounts,
        inviteRejectedAsSpamAccounts,
        ownerAccount,
        invitedAccounts,
    } = useMemo(() => {
        const activeAccounts: Array<AccountModelDataWithActiveState> = [];
        const removedAccounts: Array<AccountModelDataWithRemovedState> = [];
        const inviteRejectedAsSpamAccounts: Array<AccountModelDataWithRemovedState> = [];
        const invitedAccounts: Array<AccountModelDataWithInvitePendingState> = [];

        let ownerAccount: AccountModelData | undefined;

        for (const account of allAccountsDatas) {
            if (account.space.state.type === "Removed") {
                if (account.space.state.reason === "InviteRejectedAsSpam") {
                    inviteRejectedAsSpamAccounts.push(account as AccountModelDataWithRemovedState);
                } else {
                    removedAccounts.push(account as AccountModelDataWithRemovedState);
                }
            } else if (account.space.state.type === "InvitePending") {
                invitedAccounts.push(account as AccountModelDataWithInvitePendingState);
            } else if (account.space.state.type === "Active") {
                activeAccounts.push(account as AccountModelDataWithActiveState);
            }

            // We only allow one owner per space
            if (account.space.role === "Owner") {
                ownerAccount = account;
            }
        }

        activeAccounts.sort((account1, account2) => {
            return compareAsc(account1.space.addedTime, account2.space.addedTime);
        });

        invitedAccounts.sort((account1, account2) => {
            return compareAsc(account1.space.state.invitedTime, account2.space.state.invitedTime);
        });

        removedAccounts.sort((account1, account2) =>
            compareDesc(account1.space.state.removedTime, account2.space.state.removedTime),
        );

        return {
            activeAccounts,
            removedAccounts,
            inviteRejectedAsSpamAccounts,
            ownerAccount,
            invitedAccounts,
        };
    }, [allAccountsDatas]);

    const onSendInvitesSuccess = () => {
        // TODO: update this to use the promise that is now available
        // TODO: revalidate does not return a promise, so we can't wait for it to finish. We
        // should create some method of waiting for the data to come back before closing the modal.
        // This would be a great UX improvement as we don't want users to see flashes of new data
        // coming in after the modal closes.

        // If we've sent any new invites, revalidate to refetch the loader data.
        void revalidate();
    };

    const handleConfirmMoveOwner = async () => {
        assert(modalState?.type === "ConfirmOwner");

        const {newOwnerAccount, oldOwnerAccount} = await moveSpaceOwner(appContext, {
            spaceId: space.id,
            newOwnerAccountId: modalState.accountData.id,
        });

        accountRegistry.immediatelyUpdateAccountStoreIfExists(newOwnerAccount);
        accountRegistry.immediatelyUpdateAccountStoreIfExists(oldOwnerAccount);
        setModalState(null);
    };

    const handleConfirmRemoveAccount = async () => {
        assert(modalState?.type === "ConfirmDelete");

        const removedAccount = await removeSpaceAccount(appContext, {
            spaceId: space.id,
            accountId: modalState.accountData.id,
        });
        accountRegistry.immediatelyUpdateAccountStoreIfExists(removedAccount.account);

        setModalState(null);
    };

    const roleOptions: Array<SpaceRole> = ["Member", "Admin"];

    if (currentAccountData.space.role === "Owner") {
        roleOptions.push("Owner");
    }

    const handleRoleChange = async (account: AccountModelData, newRole: SpaceRole) => {
        assert(hasAdminAccess, "Only the space owner and admins can update roles");

        // handle move owner case
        if (newRole === "Owner") {
            // if the current account is not the owner, then we can't change the owner.
            assert(currentAccountData.space.role === "Owner");
            setModalState({type: "ConfirmOwner", accountData: account});
        } else {
            const updatedAccount = await updateSpaceAccountRole(appContext, {
                spaceId: space.id,
                accountId: account.id,
                role: newRole,
            });
            accountRegistry.immediatelyUpdateAccountStoreIfExists(updatedAccount.account);
        }
    };

    const handleRemoveAccount = async (accountData: AccountModelData) => {
        // Can't remove the owner
        assert(!ownerAccount || accountData.id !== ownerAccount.id, "Can’t remove owner");
        // Only owner and admins can remove members
        assert(hasAdminAccess, "Only the space owner and admins can remove members");

        setModalState({type: "ConfirmDelete", accountData: accountData});
    };

    return (
        <Box display="flex" flexDirection="column" gap="10">
            <Box display="flex" flexDirection="column" gap="6">
                <Box
                    display="flex"
                    flexDirection="row"
                    justifyContent="space-between"
                    alignItems="flex-start"
                >
                    <Box display="flex" flexDirection="column" gap="1">
                        <Box fontSize="200" fontStyle="bold" userSelect="text">
                            Members
                        </Box>
                        <Box fontSize="75" color="grey-60" userSelect="text">
                            Everyone with access to your space. Only admins can invite people.
                        </Box>
                    </Box>
                    {hasAdminAccess && (
                        <Button
                            onPress={() => {
                                setModalState({
                                    type: "SendInvites",
                                });
                            }}
                            pressErrorTitle="Failed to invite email"
                            variant="accent"
                        >
                            Invite
                        </Button>
                    )}
                </Box>
                <Box>
                    {activeAccounts.map((account, index) => (
                        <Box
                            key={account.id}
                            height="14"
                            borderTop={index === 0 ? "grey-5" : undefined}
                            borderBottom="grey-5"
                            display="flex"
                            alignItems="center"
                            gap="3"
                        >
                            <AccountAvatar account={account} size="8" />
                            <Box fontStyle="semi-bold" fontSize="100" userSelect="text">
                                {account.name}
                            </Box>
                            <Box flexGrow="1" />
                            {account.space.role === "Owner" || !hasAdminAccess ? (
                                <Box flexShrink="0">{account.space.role}</Box>
                            ) : (
                                <Box flexShrink="0" marginRight="-2">
                                    <MenuButton
                                        placement="bottom-end"
                                        actions={[
                                            [
                                                ...roleOptions.map(roleOption => ({
                                                    isSelected: roleOption === account.space.role,
                                                    label: roleOption,
                                                    onPress: async () =>
                                                        await handleRoleChange(account, roleOption),
                                                    pressErrorTitle: "Can’t change role",
                                                })),
                                            ],
                                            [
                                                {
                                                    label: "Remove from space",
                                                    onPress: () => handleRemoveAccount(account),
                                                    pressErrorTitle: "Can’t remove member",
                                                },
                                            ],
                                        ]}
                                    >
                                        <Button
                                            height="6"
                                            paddingX="2"
                                            icon={<CaretDown />}
                                            iconPlacement="start"
                                        >
                                            {account.space.role}
                                        </Button>
                                    </MenuButton>
                                </Box>
                            )}
                        </Box>
                    ))}
                    {invitedAccounts.map(account => (
                        <Box
                            key={account.id}
                            height="14"
                            borderBottom="grey-5"
                            display="flex"
                            alignItems="center"
                            gap="3"
                        >
                            <AccountAvatar account={account} size="8" />
                            <Box
                                fontStyle="truncate-semi-bold"
                                fontSize="100"
                                userSelect="text"
                                data-testid={
                                    process.env.NODE_ENV === "production"
                                        ? undefined
                                        : "InviteAccountName"
                                }
                            >
                                {account.name}
                            </Box>
                            <Box flexGrow="1" />
                            {!hasAdminAccess ? (
                                <Box flexShrink="0">Invited</Box>
                            ) : (
                                <Box flexShrink="0" marginRight="-2">
                                    <MenuButton
                                        placement="bottom-end"
                                        actions={[
                                            [
                                                {
                                                    label: "Cancel invite",
                                                    onPress: () => handleRemoveAccount(account),
                                                    pressErrorTitle: "Couldn’t cancel invite",
                                                },
                                            ],
                                        ]}
                                    >
                                        <Button
                                            height="6"
                                            paddingX="2"
                                            icon={<CaretDown />}
                                            iconPlacement="start"
                                        >
                                            Invited
                                        </Button>
                                    </MenuButton>
                                </Box>
                            )}
                        </Box>
                    ))}
                </Box>
            </Box>
            {removedAccounts.length > 0 && (
                <Box>
                    <Box display="flex" flexDirection="column" gap="6">
                        <Box display="flex" flexDirection="column" gap="1">
                            <Box fontSize="200" fontStyle="bold" userSelect="text">
                                Removed members
                            </Box>
                            <Box fontSize="75" color="grey-60" userSelect="text">
                                People who were members of this space but no longer have access.
                            </Box>
                        </Box>
                        <Box>
                            {removedAccounts.map((account, index) => {
                                return (
                                    <Box
                                        key={account.id}
                                        height="14"
                                        borderTop={index === 0 ? "grey-5" : undefined}
                                        borderBottom="grey-5"
                                        display="flex"
                                        alignItems="center"
                                        gap="3"
                                    >
                                        <AccountAvatar account={account} size="8" />
                                        <Box fontStyle="semi-bold" fontSize="100" userSelect="text">
                                            {account.name}
                                        </Box>
                                        <Box flexGrow="1" />
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                </Box>
            )}
            {inviteRejectedAsSpamAccounts.length > 0 && (
                <Box>
                    <Box display="flex" flexDirection="column" gap="6">
                        <Box display="flex" flexDirection="column" gap="1">
                            <Box fontSize="200" fontStyle="bold" userSelect="text">
                                Rejected invites
                            </Box>
                            <Box fontSize="75" color="grey-60" userSelect="text">
                                People who were invited to this space but rejected the invite as
                                spam.
                            </Box>
                        </Box>
                        <Box>
                            {inviteRejectedAsSpamAccounts.map((account, index) => {
                                return (
                                    <Box
                                        key={account.id}
                                        height="14"
                                        borderTop={index === 0 ? "grey-5" : undefined}
                                        borderBottom="grey-5"
                                        display="flex"
                                        alignItems="center"
                                        gap="3"
                                    >
                                        <Box opacity="60">
                                            <AccountAvatar account={account} size="8" />
                                        </Box>
                                        <Box fontStyle="semi-bold" fontSize="100" userSelect="text">
                                            {account.name}
                                        </Box>
                                        <Box flexGrow="1" />
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                </Box>
            )}
            {modalState?.type === "ConfirmOwner" && (
                <ModalDialog
                    title="Change owner"
                    description={`Are you sure you want to make ${
                        modalState.accountData.name
                    } the new owner of this space?
                    You won’t be the owner anymore and you won’t be allowed to change who’s the owner again.
                    Only ${getAccountShortNameWithoutFullNameTooltip(
                        modalState.accountData,
                    )} will be allowed
                    to change the owner. You’ll still be an admin so you’ll be able to invite people.`}
                    onClose={() => {
                        setModalState(null);
                    }}
                    primaryButtonLabel="I understand, downgrade me from owner to admin"
                    primaryButtonPressErrorTitle="Couldn’t confirm owner change"
                    onPrimaryButtonPress={handleConfirmMoveOwner}
                    cancelButtonLabel="Cancel"
                    onCancelButtonPress={() => {
                        setModalState(null);
                    }}
                    initiallyFocus="Cancel"
                />
            )}
            {modalState?.type === "ConfirmDelete" && (
                <ModalDialog
                    title="Remove member"
                    description={`Are you sure you want to remove ${modalState.accountData.name} from this space?`}
                    onClose={() => {
                        setModalState(null);
                    }}
                    primaryButtonLabel="Remove"
                    primaryButtonPressErrorTitle="Couldn’t remove member"
                    onPrimaryButtonPress={handleConfirmRemoveAccount}
                    cancelButtonLabel="Cancel"
                    onCancelButtonPress={() => {
                        setModalState(null);
                    }}
                />
            )}
            {/* We use a custom invite dialog */}
            {modalState?.type === "SendInvites" && (
                <SettingsInvitePeopleModal
                    spaceId={space.id}
                    onClose={() => setModalState(null)}
                    onSuccess={onSendInvitesSuccess}
                />
            )}
        </Box>
    );
}
