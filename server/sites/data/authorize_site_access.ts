import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSiteAccessAndReturnItemIfPossible} from "~/server/sites/data/internal/authorize_site_access_and_return_item.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";

export async function authorizeSiteAccess(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId}> {
    const {spaceId} = unwrapResult(
        await authorizeSiteAccessAndReturnItemIfPossible(
            context,
            siteId,
            expectedAccessLevel,
            options,
        ),
    );

    return {spaceId};
}
