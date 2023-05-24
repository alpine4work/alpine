import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {getAccountIfExists} from "~/server/dynamo/accounts_table";
import {ActionContext} from "~/server/dynamo/context/action_context";
import {AccountModel} from "~/shared/accounts/account_model";
import {ContentMention} from "~/shared/content/content_mention";
import {ContentReferences} from "~/shared/content/content_references";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {
    ProsemirrorVisitor,
    visitProsemirrorNode,
    visitProsemirrorStep,
} from "~/shared/prosemirror/prosemirror_visitor";

/**
 * Traverse our content, find any referenced data, and load that data. For
 * example, finds all mentions and loads the mentioned accounts.
 */
export function getContentReferencesForNode(
    context: ActionContext,
    spaceId: SpaceId,
    content: Node,
): Promise<ContentReferences> {
    return getContentReferences(context, spaceId, visitor => {
        visitProsemirrorNode(content, visitor);
    });
}

/**
 * Traverse the array of steps, find any new referenced nodes, and load related
 * data to those nodes. For example, finds all mentions and loads the
 * mentioned accounts.
 */
export function getContentReferencesForSteps(
    context: ActionContext,
    spaceId: SpaceId,
    steps: ReadonlyArray<Step>,
): Promise<ContentReferences> {
    return getContentReferences(context, spaceId, visitor => {
        for (const step of steps) {
            visitProsemirrorStep(step, visitor);
        }
    });
}

async function getContentReferences(
    context: ActionContext,
    spaceId: SpaceId,
    visit: (visitor: ProsemirrorVisitor) => void,
): Promise<ContentReferences> {
    const accountPromiseById = new Map<AccountId, Promise<AccountModel | null>>();

    visit({
        visitNode: node => {
            if (node.type.name === "mention") {
                const mention: ContentMention = node.attrs.mention;

                const accountPromise = getOrSetDefaultMapValue(
                    accountPromiseById,
                    mention.accountId,
                    // You may have copy/pasted some content from a different space. In that case a
                    // mentioned user may not exist.
                    () => getAccountIfExists(context, spaceId, mention.accountId),
                );

                // We await all promises below.
                void accountPromise;
            }
        },
    });

    const accounts = await runAllPromises(accountPromiseById.values());
    const accountById = new Map(
        filterMapIterable(accounts, account => {
            if (!account) return null;
            return [account.id, account];
        }),
    );

    return {
        accountById,
    };
}
