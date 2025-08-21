import {createAlphaSpaceAsAdmin} from "~/server/alpha/alpha_access_table.js";
import {getOurAccountInboxes} from "~/server/notifications/data/notifications_table.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getPossiblyStaleAccountSearchAffinityEntityIds} from "~/server/search/data/table/search_entity_table.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/invite_email_addresses_to_space.js";
import {
    acceptSpaceAccountInvite,
    expensivelyGetAllSpaceAccounts,
    finishUploadingSpaceAvatar,
    getOurAccountSpaceIds,
    getSpaceIfPossible,
    moveSpaceAccountOwnerRole,
    rejectSpaceAccountInviteAsSpam,
    removeSpaceAccount,
    updateSpaceAccountRole,
    updateSpaceAccountSettings,
    updateSpaceName,
} from "~/server/spaces/spaces_table.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import * as definitions from "~/shared/rpc/spaces_rpc_definitions.js";

export default implementRpcs(definitions, {
    expensivelyGetAllSpaceAccounts: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const [accounts, sortedAccountIds] = await runAllPromises([
                expensivelyGetAllSpaceAccounts(context, input.spaceId),

                // We return all accounts sorted in affinity order.
                getPossiblyStaleAccountSearchAffinityEntityIds(
                    context.actor.authorizeSession(),
                    input.spaceId,
                ),
            ]);

            const sortedIndexByAccountId = new Map<AccountId, number>();
            for (let i = 0; i < sortedAccountIds.length; i++) {
                sortedIndexByAccountId.set(sortedAccountIds[i]!, i);
            }

            const sortedAccounts = [...accounts].sort((account1, account2) => {
                const sortedIndex1 = sortedIndexByAccountId.get(account1.id);
                const sortedIndex2 = sortedIndexByAccountId.get(account2.id);

                if (sortedIndex1 !== undefined && sortedIndex2 !== undefined)
                    return sortedIndex1 - sortedIndex2;

                if (sortedIndex1 !== undefined && sortedIndex2 === undefined) return -1;
                if (sortedIndex1 === undefined && sortedIndex2 !== undefined) return 1;

                return account1.initialData.name.localeCompare(account2.initialData.name);
            });

            return {accounts: sortedAccounts};
        },
    },

    createAlphaSpaceAsAdmin: {
        visibility: ["AppClient"],
        execute: (context, input) => {
            return createAlphaSpaceAsAdmin(context, input);
        },
    },

    removeSpaceAccount: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await removeSpaceAccount(context, input);
            return {account};
        },
    },

    getOurAccountSpaces: {
        visibility: ["AppClient"],
        execute: async unauthenticatedContext => {
            const context = unauthenticatedContext.actor.authorizeSession();

            const {spaceIds} = await getOurAccountSpaceIds(context);

            const [spaces, inboxes] = await runAllPromises([
                runAllPromises(
                    Array.from(spaceIds, async spaceId => {
                        // In case we read stale a stale list of `SpaceId`s that includes a space we
                        // lost access to.
                        const spaceResult = await getSpaceIfPossible(context, spaceId);

                        if (!spaceResult) return null;
                        if (!spaceResult.ok) return null;

                        return spaceResult.value;
                    }),
                ),
                getOurAccountInboxes(context, spaceIds),
            ]);

            const inboxBySpaceId = new Map(inboxes.map(inbox => [inbox.model.spaceId, inbox]));

            return {
                spaces: filterMapArray(spaces, space => {
                    if (!space) return;

                    const inbox = inboxBySpaceId.get(space.id) ?? null;
                    return {space, inbox};
                }),
            };
        },
    },

    updateSpaceAccountSettings: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await updateSpaceAccountSettings(
                context.actor.authorizeSession(),
                input.spaceId,
                input.update,
            );
            return {};
        },
    },

    updateSpaceName: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const space = await updateSpaceName(
                context.actor.authorizeSession(),
                input.spaceId,
                input.name,
            );
            return {
                space,
            };
        },
    },

    updateSpaceAccountRole: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            // The updateSpaceAccountRole function from spaces_table.ts will handle all permission
            // checks (actor is owner/admin, target is not owner, etc.) and the actual update.
            const account = await updateSpaceAccountRole(context.actor.authorizeSession(), {
                spaceId: input.spaceId,
                accountId: input.accountId,
                role: input.role,
            });

            return {account};
        },
    },

    moveSpaceOwner: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {newOwnerAccount, oldOwnerAccount} = await moveSpaceAccountOwnerRole(
                context.actor.authorizeSession(),
                {
                    spaceId: input.spaceId,
                    newOwnerAccountId: input.newOwnerAccountId,
                },
            );

            return {
                newOwnerAccount,
                oldOwnerAccount,
            };
        },
    },

    inviteEmailAddressesToSpace: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {
                accounts,
                invalidEmailAddresses,
                rejectedAsSpamEmailAddresses,
                alreadyMemberEmailAddresses,
                unexpectedFailureEmailAddresses,
            } = await inviteEmailAddressesToSpace(context.actor.authorizeSession(), {
                emailAddresses: input.emailAddresses,
                spaceId: input.spaceId,
            });
            return {
                accounts,
                errors: {
                    invalidEmailAddresses,
                    rejectedAsSpamEmailAddresses,
                    alreadyMemberEmailAddresses,
                    unexpectedFailureEmailAddresses,
                },
            };
        },
    },

    rejectSpaceAccountInviteAsSpam: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await rejectSpaceAccountInviteAsSpam(
                context.actor.authorizeSession(),
                input.spaceId,
            );
            return {account};
        },
    },

    acceptSpaceAccountInvite: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await acceptSpaceAccountInvite(
                context.actor.authorizeSession(),
                input.spaceId,
            );
            return {account};
        },
    },

    finishUploadingSpaceAvatar: {
        visibility: ["EdgeService"],
        execute: async (context, input) => {
            const space = await finishUploadingSpaceAvatar(context.actor.authorizeSession(), input);
            return {space};
        },
    },
});
