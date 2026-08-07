import {addDays} from "date-fns";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {Context} from "~/shared/context/context.js";
import {UrlPath} from "~/shared/helpers/http/url_path.open_source.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function processSendTryOnDesktopEmail(
    context: Context<ServerProcessContextModules & {email: EmailContextModuleBase}>,
    {
        accountId,
        emailAddress,
        openSpaceId,
    }: {
        accountId: AccountId;
        emailAddress: EmailAddress;
        openSpaceId: SpaceId | null;
    },
) {
    // Check if the user has opted out of the try on desktop email. They've opted out
    // if a `TryOnDesktopEmailOptOut` item exists.
    const item = await AccountsTable.getItemIfExists(context, {
        partitionType: "TryOnDesktopEmailOptOut",
        sortRangeType: "Attributes",
        accountId,
    });
    if (item) return;

    try {
        await AccountsTable.createItem(context, {
            partitionType: "SentTryOnDesktopEmail",
            sortRangeType: "Attributes",
            accountId,
            // We should only send this email once on sign up. We have this item to prevent
            // retries of this job from sending the email multiple times. It should be safe for
            // us to remove the item and reclaim storage after 30 days as we're well after sign
            // up by that point.
            expirationTime: addDays(new Date(), 30),
        });
    } catch (error) {
        if (isDynamoConditionCheckError(error)) return;
        throw error;
    }

    const urlPath = new UrlPath("/auth/sign-in");
    urlPath.searchParams.set("email", emailAddress);
    if (openSpaceId) urlPath.searchParams.set("to", `/home/${openSpaceId}`);

    await context.email.sendImmediately({
        // We use the `Invites` alias since similarly we're prompting people to log into
        // Alpine. We don't want to use the `SignUp` email so it's reserved for
        // transactional emails with a very high open rate.
        fromEmailAddressAlias: "Invites",
        toEmailAddress: emailAddress,
        templateName: "TryOnDesktop",
        templateProps: {
            signInUrl: `${context.constants.edgeServiceUrl}${urlPath.toString()}`,
        },
    });
}
