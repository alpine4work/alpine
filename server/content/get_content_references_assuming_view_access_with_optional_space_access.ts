import {Node} from "prosemirror-model";
import {getContentReferences} from "~/server/content/get_content_references.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {dangerouslyGetAccountStubIfExistsWithoutAuthorization} from "~/server/spaces/dangerously_get_account_stub_if_exists_without_authorization.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Same as `getContentReferencesForNode()` except when the actor doesn't have
 * space access we return account stubs for referenced accounts instead of the
 * full `AccountModel`. Account stubs only reveal an account's name and avatar.
 *
 * IMPORTANT: It's only safe to use this function if you've authorized that the
 * actor has view access to the content. Since we'll dangerously load account
 * stubs assuming you've already authorized access.
 */
export async function getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer,
    content: Node,
    options?: {withPreloadedFiles?: boolean},
): Promise<ContentReferences> {
    const referencedIds = getContentReferencedIdsForNode(content);

    // If the actor has space access we can fetch content references as normal.
    // However, if the actor doesn't have space access (but has view access) then
    // when we fetch accounts we want to return stubs that only reveal the
    // account's name.
    if ((await authorizeSpaceAccessIfPossible(context, spaceId)).ok) {
        return getContentReferences(context, spaceId, fileAuthorizer, referencedIds, options);
    } else {
        const [contentReferences, accounts] = await runAllPromises([
            getContentReferences(
                context,
                spaceId,
                fileAuthorizer,
                {
                    ...referencedIds,
                    // We can't load the full account with `getAccountIfExists()` since that
                    // requires space access.
                    accountIds: emptySet,
                },
                options,
            ),
            runAllPromises(
                mapIterable(referencedIds.accountIds, accountId => {
                    // In this code path, the we assume the actor has been granted view access to
                    // the content but they don't have access to the space. (Probably the content
                    // has a `accessPolicy.urlGrant`.) In this case, the actor is allowed to see the
                    // name, and only the name, of any mentioned account. Fetch account stubs for
                    // all referenced `AccountId`s.
                    return dangerouslyGetAccountStubIfExistsWithoutAuthorization(
                        context,
                        spaceId,
                        accountId,
                    );
                }),
            ),
        ]);

        const accountById = new Map(
            filterMapIterable(accounts, account => {
                if (!account) return;
                return [account.id, account];
            }),
        );

        return {...contentReferences, accountById};
    }
}
