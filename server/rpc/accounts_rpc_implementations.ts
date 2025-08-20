import {
    getAccountByEmailAddressAsAdmin,
    getAccountByIdAsAdmin,
    registerOurAccountAppleDeviceToken,
    updateAccountAvatar,
    updateOurAccountName,
    updateOurLastOpenedSpaceId,
} from "~/server/accounts/accounts_table.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getAccount, getAccountIfExists} from "~/server/spaces/spaces_table.js";
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

    registerOurAccountAppleDeviceToken: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await registerOurAccountAppleDeviceToken(
                context.actor.authorizeSession(),
                input.deviceToken,
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
            const account = await updateAccountAvatar(context.actor.authorizeSession(), {
                avatarContent: input.avatarContent,
                avatarId: input.avatarId,
            });
            return {account};
        },
    },
});
