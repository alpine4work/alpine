import {redirect} from "@remix-run/node";
import {deserializeAccountIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {getOurAccountSpaceIdsAndLastOpenedSpaceId} from "~/server/accounts/with_spaces/get_our_last_opened_space_id.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";

/**
 * This route automatically redirects from `/mention/:accountId` to
 * `/chat/with/:accountId/:spaceId` for a space you're in with the account.
 * Eventually we'll want a dedicated account profile pages but for now we go to the
 * 1:1 chat.
 */
export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    if (process.env.NODE_ENV !== "production") {
        throw new InternalError(
            "Development only warning: If you\u2019re linking to an account then instead of navigating to `/mention/:accountId` you should navigate directly to `/chat/with/:accountId/:spaceId`. It\u2019s a slight optimization since we don\u2019t need to perform a `redirect()` network roundtrip on the client",
        );
    }

    const accountId = deserializeAccountIdForLoader(params.accountId ?? null);

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const {lastOpenedSpaceId, spaceIds} = await getOurAccountSpaceIdsAndLastOpenedSpaceId(context);

    if (
        lastOpenedSpaceId !== null &&
        (await isAccountMemberOfSpace(context, lastOpenedSpaceId, accountId))
    ) {
        // IMPORTANT: If you're updating this then also go and update
        // `account.$accountId.$spaceId.tsx` too.
        return redirect(`/chat/with/${accountId}/${lastOpenedSpaceId}`);
    }

    const spaceIdsWithAccount = (
        await runAllPromises(
            mapIterable(spaceIds, async spaceId => {
                if (await isAccountMemberOfSpace(context, spaceId, accountId)) {
                    return spaceId;
                }

                return null;
            }),
        )
    ).filter(isNonNullable);

    if (spaceIdsWithAccount.length === 0) {
        throw new FailedPreconditionError("No shared spaces with account", {
            displayMessage: errorDisplayMessage`You\u2019re not in any shared spaces with this account.`,
        });
    }

    // IMPORTANT: If you're updating this then also go and update
    // `account.$accountId.$spaceId.tsx` too.
    return redirect(`/chat/with/${accountId}/${spaceIdsWithAccount[0]!}`);
}
