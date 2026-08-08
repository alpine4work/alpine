import {createAlphaSpaceAsAdmin} from "~/server/alpha/alpha_access_table.js";
import {getOurAccountInboxes} from "~/server/notifications/data/get_our_account_inboxes.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getPossiblyStaleAccountSearchAffinityEntityIds} from "~/server/search/data/table/search_entity_actions.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {addSpaceAccount} from "~/server/spaces/add_space_account.js";
import {createSpace} from "~/server/spaces/create/create_space.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {finishUploadingSpaceAvatar} from "~/server/spaces/finish_uploading_space_avatar.js";
import {getOurAccountSpaceIds} from "~/server/spaces/get_our_account_space_ids.js";
import {getSpaceIfPossible} from "~/server/spaces/get_space.js";
import {instantiateBotSpaceAccount} from "~/server/spaces/instantiate_bot_space_account.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/invite_email_addresses_to_space.js";
import {loadSpaceInviteContent} from "~/server/spaces/load_space_invite_content.js";
import {moveSpaceAccountOwnerRole} from "~/server/spaces/move_space_account_owner_role.js";
import {rejectSpaceAccountInviteAsSpam} from "~/server/spaces/reject_space_account_invite_as_spam.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {updateSpaceAccountRole} from "~/server/spaces/update_space_account_role.js";
import {updateSpaceAccountSettings} from "~/server/spaces/update_space_account_settings.js";
import {updateSpaceName} from "~/server/spaces/update_space_name.js";
import {updateSpaceThemeColor} from "~/server/spaces/update_space_theme_color.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
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

            const pointsByAccountId = new Map<AccountId, number>();
            for (const {id, points} of sortedAccountIds) {
                pointsByAccountId.set(id, points);
            }

            const sortedAccounts = [...accounts].sort((account1, account2) => {
                const points1 = pointsByAccountId.get(account1.id);
                const points2 = pointsByAccountId.get(account2.id);

                if (points1 !== undefined && points2 !== undefined) return points2 - points1;

                if (points1 !== undefined && points2 === undefined) return -1;
                if (points1 === undefined && points2 !== undefined) return 1;

                return account1.initialData.name.localeCompare(account2.initialData.name);
            });

            const affinityPoints: Array<number> = [];

            // Collect all affinity points then stop at the first account that doesn't have
            // affinity points.
            for (const account of sortedAccounts) {
                const points = pointsByAccountId.get(account.id);
                if (points !== undefined) {
                    affinityPoints.push(points);
                } else {
                    break;
                }
            }

            return {accounts: sortedAccounts, affinityPoints};
        },
    },

    createAlphaSpaceAsAdmin: {
        visibility: ["AppClient"],
        execute: (unauthenticatedContext, input) => {
            const context = unauthenticatedContext.actor.authorizeSession();
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

    addSpaceAccount: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await addSpaceAccount(context.actor.authorizeSession(), input);
            return {account};
        },
    },

    getOurAccountSpaces: {
        visibility: ["AppClient"],
        execute: async unauthenticatedContext => {
            const context = unauthenticatedContext.actor.authorizeSession();

            const {spaceIds, invitePendingSpaceIds} = await getOurAccountSpaceIds(context);

            const [spaceResults, inboxes] = await runAllPromises([
                runAllPromises(
                    mapIterable(
                        concatIterables(
                            mapIterable(spaceIds, spaceId => ({spaceId, isInvitePending: false})),
                            mapIterable(invitePendingSpaceIds, spaceId => ({
                                spaceId,
                                isInvitePending: true,
                            })),
                        ),
                        async ({spaceId, isInvitePending}) => {
                            // In case we read stale a stale list of `SpaceId`s that includes a space we lost
                            // access to.
                            const spaceResult = await getSpaceIfPossible(context, spaceId, {
                                allowInvitePending: isInvitePending,
                            });

                            if (!spaceResult) return null;
                            if (!spaceResult.ok) return null;

                            return {
                                space: spaceResult.value,
                                isInvitePending,
                            };
                        },
                    ),
                ),
                getOurAccountInboxes(context, spaceIds),
            ]);

            const inboxBySpaceId = new Map(inboxes.map(inbox => [inbox.model.spaceId, inbox]));

            return {
                spaces: filterMapArray(spaceResults, spaceResult => {
                    if (!spaceResult) return;

                    const inbox = inboxBySpaceId.get(spaceResult.space.id) ?? null;

                    return {
                        space: spaceResult.space,
                        inbox,
                        isInvitePending: spaceResult.isInvitePending,
                    };
                }),
            };
        },
    },

    loadSpaceInviteContent: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return await loadSpaceInviteContent(context.actor.authorizeSession(), input.spaceId);
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

    updateSpaceThemeColor: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const space = await updateSpaceThemeColor(
                context.actor.authorizeSession(),
                input.spaceId,
                input.themeColor,
            );
            return {
                space,
            };
        },
    },

    updateSpaceAccountRole: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            // The updateSpaceAccountRole function from spaces_table.ts will handle all
            // permission checks (actor is owner/admin, target is not owner, etc.) and the
            // actual update.
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
                affinityPoints,
                invalidEmailAddresses,
                rejectedAsSpamEmailAddresses,
                alreadyMemberEmailAddresses,
                requiresAdminAccessEmailAddresses,
                unexpectedFailureEmailAddresses,
            } = await inviteEmailAddressesToSpace(context.actor.authorizeSession(), {
                emailAddresses: input.emailAddresses,
                spaceId: input.spaceId,
            });
            return {
                accounts,
                affinityPoints,
                errors: {
                    invalidEmailAddresses: Array.from(invalidEmailAddresses),
                    rejectedAsSpamEmailAddresses: Array.from(rejectedAsSpamEmailAddresses),
                    alreadyMemberEmailAddresses: Array.from(alreadyMemberEmailAddresses.keys()),
                    requiresAdminAccessEmailAddresses: Array.from(
                        requiresAdminAccessEmailAddresses,
                    ),
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

    createSpace: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const space = await createSpace(context.actor.authorizeSession(), input);
            return {space};
        },
    },

    instantiateBotSpaceAccount: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await instantiateBotSpaceAccount(
                context.actor.authorizeSession(),
                input,
            );

            return {account};
        },
    },
});
