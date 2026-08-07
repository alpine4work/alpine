import {finishUploadingAccountAvatar} from "~/server/accounts/finish_uploading_account_avatar.js";
import {getAccountByEmailAddressAsAdmin} from "~/server/accounts/get_account_by_email_address_as_admin.js";
import {getAccountByIdAsAdmin} from "~/server/accounts/get_account_by_id_as_admin.js";
import {optInToTryOnDesktopEmail} from "~/server/accounts/opt_in_to_try_on_desktop_email.js";
import {optOutOfTryOnDesktopEmail} from "~/server/accounts/opt_out_of_try_on_desktop_email.js";
import {regenerateOneTimePasswordSignIn} from "~/server/accounts/regenerate_one_time_password_sign_in.js";
import {saveAccountSignUpProfile} from "~/server/accounts/save_account_sign_up_profile.js";
import {scheduleTryOnDesktopEmail} from "~/server/accounts/schedule_try_on_desktop_email.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {updateAccountReactionCharacter} from "~/server/accounts/update_account_reaction_character.js";
import {updateOurAccountName} from "~/server/accounts/update_our_account_name.js";
import {updateOurAccountSettings} from "~/server/accounts/update_our_account_settings.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getAccount, getAccountIfExists} from "~/server/spaces/get_account.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
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

    updateOurAccountSettings: {
        visibility: ["AppClient"],
        execute: async (context, input, {callId}) => {
            await updateOurAccountSettings(context.actor.authorizeSession(), input.actions, {
                clientRequestToken: callId,
            });
            return {};
        },
    },

    updateOurLastOpenedSpaceId: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await updateOurAccountSettings(context.actor.authorizeSession(), {
                type: "UpdateLastOpenedSpaceId",
                spaceId: input.lastOpenedSpaceId,
            });
            return {};
        },
    },

    updateOurAccountObservedTimeZone: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await updateOurAccountSettings(context.actor.authorizeSession(), {
                type: "UpdateObservedTimeZone",
                timeZone: input.timeZone,
            });
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

    createLifetimeAccessCheckoutSessionUrl: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();

            const result = await sessionContext.billing.createLifetimeAccessCheckoutSessionUrl(
                input.currentPathname,
            );

            return {result};
        },
    },

    regenerateOneTimePasswordSignIn: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {accountId, hasNotSignedUp} = await regenerateOneTimePasswordSignIn(
                context,
                input.emailAddress,
                {toSearchParam: input.toSearchParam},
            );
            return {accountId, hasNotSignedUp};
        },
    },

    signUpAccountWithEmailAddress: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const accountId = await signUpAccountWithEmailAddress(context, input.emailAddress, {
                toSearchParam: input.toSearchParam,
            });
            return {accountId};
        },
    },

    saveAccountSignUpProfile: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await saveAccountSignUpProfile(context, input);
            return {};
        },
    },

    scheduleTryOnDesktopEmail: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await scheduleTryOnDesktopEmail(context.actor.authorizeSession(), input);
            return {};
        },
    },

    optOutOfTryOnDesktopEmail: {
        visibility: ["AppClient"],
        execute: async context => {
            await optOutOfTryOnDesktopEmail(context.actor.authorizeSession());
            return {};
        },
    },

    optInToTryOnDesktopEmail: {
        visibility: ["AppClient"],
        execute: async context => {
            await optInToTryOnDesktopEmail(context.actor.authorizeSession());
            return {};
        },
    },
});
