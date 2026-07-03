import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSiteAccessAndReturnItemIfPossible} from "~/server/sites/data/internal/authorize_site_access_and_return_item.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";

export async function authorizeSiteAccess(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId}> {
    return unwrapResult(
        await authorizeSiteAccessIfPossible(context, siteId, expectedAccessLevel, options),
    );
}

export async function authorizeSiteAccessIfPossible(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId}, ErrorBase>> {
    const result = await authorizeSiteAccessAndReturnItemIfPossible(
        context,
        siteId,
        expectedAccessLevel,
        options,
    );

    if (!result.ok) return result;

    return {ok: true, value: {spaceId: result.value.spaceId}};
}
