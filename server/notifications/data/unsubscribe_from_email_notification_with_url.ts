import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {Context} from "~/shared/context/context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Unsubscribe a space account from an email notification using a signed URL. Will
 * throw an InvalidArgumentError if the signed URL is invalid or expired.
 */
export async function unsubscribeFromEmailNotificationWithUrl(
    context: Context<ServerActionContextModules & {email: EmailContextModuleBase}>,
    {
        signedUrl,
    }: {
        signedUrl: string;
    },
) {
    let urlParts;
    try {
        const url = new URL(signedUrl);
        urlParts = await context.email.getPartsFromSignedUnsubscribeUrl(url);
    } catch (error) {
        throw new InvalidArgumentError("Invalid unsubscribe URL", {cause: error});
    }

    const currentTime = new Date();

    switch (urlParts.emailType) {
        case "NotificationDigest": {
            const inboxItem = await InboxTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId: urlParts.spaceId,
                accountId: urlParts.accountId,
            });

            // If their inbox was deleted or the account doesn't have an inbox for this space,
            // they won't receive notifications anyway, so there's nothing to unsubscribe from.
            if (!inboxItem) return;

            await InboxTable.updateItem(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "InboxAttributes",
                    spaceId: urlParts.spaceId,
                    accountId: urlParts.accountId,
                },
                item => {
                    if (item.digestNotificationsOptedOutTime !== null) return item;
                    return item.update({digestNotificationsOptedOutTime: currentTime});
                },
                {initialItem: inboxItem},
            );
            break;
        }
        default:
            throw exhaustive(urlParts.emailType);
    }
}
