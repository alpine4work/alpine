import {ServerActionContext} from "~/server/context/server_action_context.js";
import {InboxEntriesIndex} from "~/server/notifications/data/internal/inbox_table.js";
import {
    authorizeNotBotSpaceAccount,
    authorizeSpaceAccess,
    getAccountWithoutAvatar,
} from "~/server/spaces/spaces_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {getInboxEntryDisplayContent} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {getEncodedInboxEntryPath} from "~/shared/notifications/inbox_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const digestEntryDisplayLimit = 8;

/**
 * Gets the content for a digest notification email for the given inbox.
 */
export async function getNotificationDigestContent(
    context: ServerActionContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
) {
    await runAllPromises([
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
        authorizeSpaceAccess(context, spaceId),
    ]);

    const [currentAccount, entries] = await runAllPromises([
        getAccountWithoutAvatar(context, spaceId, accountId),
        InboxEntriesIndex.realtimeQuery(context, {
            partitionKey: {spaceId, accountId},
            endSortKey: {
                isArchived: false,
                generation: InboxEntriesIndex.sortKeyAttributes.generation.maxValue,
                enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
            },
            // We add 51 to the limit so we can display the count of remaining entries, up to 50+
            limit: digestEntryDisplayLimit + 51,
        }),
    ]);

    const parsedEntries = entries.items.slice(0, digestEntryDisplayLimit).map(entry => {
        const entryDisplay = getInboxEntryDisplayContent({
            entry: entry.model,
            locale: defaultLocale,
            currentAccount,
        });
        const selectedSearchParam = getEncodedInboxEntryPath(entry.model, "wide");

        const summary = entryDisplay.summary.map(item => {
            if (typeof item === "string") {
                return item;
            } else {
                assert(
                    item instanceof AccountModel,
                    "Received non-account item in InboxEntryDisplayContentSummary",
                );
                return {
                    type: "Account",
                    name: getAccountShortNameWithoutFullNameTooltip(item.initialData),
                } as const;
            }
        });

        const showLatestMessage =
            entryDisplay.latestMessage && entryDisplay.latestMessage.contentTextSnippet.length > 0;
        return {
            url: new URL(
                `/s/${entry.model.spaceId}/inbox?selected=${selectedSearchParam}`,
                context.constants.edgeServiceUrl,
            ),
            summary,
            preview: showLatestMessage
                ? `${getAccountShortNameWithoutFullNameTooltip(
                      entryDisplay.latestMessage.author.initialData,
                  )}: ${entryDisplay.latestMessage.contentTextSnippet}`
                : null,
            brandIconType: entryDisplay.brandIconType,
            time: entryDisplay.time,
            loudNotificationCount: entry.model.loudNotificationCount,
            firstAccount: entryDisplay.firstAccount.initialData,
            secondAccount: entryDisplay.secondAccount?.initialData,
        };
    });

    const remainingEntryCount = Math.max(entries.items.length - digestEntryDisplayLimit, 0);
    const digestContent = {
        inboxUrl: new URL(`/s/${spaceId}/inbox`, context.constants.edgeServiceUrl),
        digestEntries: parsedEntries,
        remainingEntryCount,
    };

    return digestContent;
}
