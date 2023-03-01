import {Node} from "prosemirror-model";
import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {ContentMention} from "~/shared/content/content_mention";
import {ContentReferences} from "~/shared/content/content_references";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";

/**
 * Traverse our content, find any referenced data, and load that data. For
 * example, finds all mentions and loads the mentioned accounts.
 *
 * We need a `spaceId` context to help determine whether you have access to the
 * data you're requesting.
 */
export async function getContentReferences(
    context: RequestContext,
    spaceId: SpaceId,
    content: Node,
): Promise<ContentReferences> {
    const accountPromiseById = new Map<AccountId, Promise<AccountModel>>();

    content.descendants(node => {
        if (node.type.name === "mention") {
            const mention: ContentMention = node.attrs.mention;

            const accountPromise = getOrSetDefaultMapValue(
                accountPromiseById,
                mention.accountId,
                () => getAccountOrThrow(context, spaceId, mention.accountId),
            );

            // We await all promises below.
            void accountPromise;
        }
    });

    const accounts = await runAllPromises(accountPromiseById.values());
    const accountById = new Map(accounts.map(account => [account.id, account]));

    return {
        accountById,
    };
}
