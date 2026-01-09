import {finishUploadingAccountAvatar} from "~/server/accounts/finish_uploading_account_avatar.js";
import {getAccountByEmailAddressAsAdmin} from "~/server/accounts/get_account_by_email_address_as_admin.js";
import {getAccountByIdAsAdmin} from "~/server/accounts/get_account_by_id_as_admin.js";
import {updateAccountReactionCharacter} from "~/server/accounts/update_account_reaction_character.js";
import {updateOurAccountName} from "~/server/accounts/update_our_account_name.js";
import {updateOurAccountObservedTimeZone} from "~/server/accounts/with_spaces/update_our_account_observed_time_zone.js";
import {updateOurLastOpenedSpaceId} from "~/server/accounts/with_spaces/update_our_last_opened_space_id.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getAccount, getAccountIfExists} from "~/server/spaces/get_account.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import * as definitions from "~/shared/rpc/accounts_rpc_definitions.js";

export default implementRpcs(definitions, {
    getAccount: {
        visibility: "Public",
        execute: async (context, input) => {
            const account = await getAccount(context, input.spaceId, input.accountId);
            return {account};
        },
    },

    getAccounts: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            if (input.accountIds.size === 0) {
                throw new InvalidArgumentError("Must call `getAccounts` with at least one account");
            }

            const accounts = await runAllPromises(
                Array.from(input.accountIds, accountId =>
                    getAccount(context, input.spaceId, accountId),
                ),
            );

            return {accounts};
        },
    },

    getAccountsIfExist: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            if (input.accountIds.size === 0) {
                throw new InvalidArgumentError(
                    "Must call `getAccountsIfExist` with at least one account",
                );
            }

            const accounts = await runAllPromises(
                Array.from(input.accountIds, accountId =>
                    getAccountIfExists(context, input.spaceId, accountId),
                ),
            );

            return {accounts};
        },
    },

    updateOurAccountName: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await updateOurAccountName(
                context.actor.authorizeSession(),
                input.name,
            );

            return {account};
        },
    },

    updateOurLastOpenedSpaceId: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await updateOurLastOpenedSpaceId(
                context.actor.authorizeSession(),
                input.lastOpenedSpaceId,
            );

            return {};
        },
    },

    updateOurAccountObservedTimeZone: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await updateOurAccountObservedTimeZone(
                context.actor.authorizeSession(),
                input.timeZone,
            );
            return {};
        },
    },
    getAccountByIdAsAdmin: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await getAccountByIdAsAdmin(
                context.actor.authorizeSession(),
                input.accountId,
            );

            return {account};
        },
    },

    getAccountByEmailAddressAsAdmin: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await getAccountByEmailAddressAsAdmin(
                context.actor.authorizeSession(),
                input.emailAddress,
            );

            return {account};
        },
    },

    finishUploadingAccountAvatar: {
        visibility: ["EdgeService"],
        execute: async (context, input) => {
            const account = await finishUploadingAccountAvatar(context.actor.authorizeSession(), {
                avatarContent: input.avatarContent,
                accountId: input.accountId,
                avatarId: input.avatarId,
            });
            return {account};
        },
    },

    updateAccountReactionCharacter: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const account = await updateAccountReactionCharacter(
                context.actor.authorizeSession(),
                input.character,
            );
            return {account};
        },
    },

    createLifetimeAccessCheckoutUrl: {
        visibility: ["AppClient"],
        execute: async context => {
            const sessionContext = context.actor.authorizeSession();

            return {
                url: await sessionContext.billing.createLifetimeAccessCheckoutSessionUrl(),
            };
        },
    },
});
