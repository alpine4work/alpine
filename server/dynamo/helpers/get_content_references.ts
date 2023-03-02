import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {ContentMention} from "~/shared/content/content_mention";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {ContentReferences} from "~/shared/models/content_references";
import {ExhaustiveStep} from "~/shared/prosemirror/prosemirror_exhaustive_step";

/**
 * Traverse our content, find any referenced data, and load that data. For
 * example, finds all mentions and loads the mentioned accounts.
 */
export function getContentReferencesFromNode(
    context: RequestContext,
    spaceId: SpaceId,
    content: Node,
): Promise<ContentReferences> {
    return getContentReferences(context, spaceId, callback => content.descendants(callback));
}

/**
 * Traverse the array of steps, find any new referenced nodes, and load related
 * data to those nodes. For example, finds all mentions and loads the
 * mentioned accounts.
 */
export function getContentReferencesFromSteps(
    context: RequestContext,
    spaceId: SpaceId,
    steps: ReadonlyArray<Step>,
): Promise<ContentReferences> {
    return getContentReferences(context, spaceId, callback => {
        for (const _step of steps) {
            const step = _step as ExhaustiveStep;
            switch (step.jsonID) {
                case "attr":
                case "addMark":
                case "removeMark":
                case "addNodeMark":
                case "removeNodeMark": {
                    break;
                }
                case "replace":
                case "replaceAround": {
                    step.slice.content.descendants(callback);
                    break;
                }
                default:
                    throw exhaustive(step);
            }
        }
    });
}

async function getContentReferences(
    context: RequestContext,
    spaceId: SpaceId,
    iterate: (callback: (node: Node) => void) => void,
): Promise<ContentReferences> {
    const accountPromiseById = new Map<AccountId, Promise<AccountModel>>();

    iterate(node => {
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
