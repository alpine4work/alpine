import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccessLevel, AccessPolicy} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {sitePermissionDeniedErrorDisplayMessageByExpectedAccessLevel} from "~/shared/sites/site_error_messages.js";

export async function authorizeSiteAccess(
    context: ServerMinimalActionContext,
    siteItem: {spaceId: SpaceId; accessPolicy: AccessPolicy} & ({id: SiteId} | {siteId: SiteId}),
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<void> {
    unwrapResult(
        await authorizeSiteAccessIfPossible(context, siteItem, expectedAccessLevel, options),
    );
}

export async function authorizeSiteAccessIfPossible(
    context: ServerMinimalActionContext,
    siteItem: {spaceId: SpaceId; accessPolicy: AccessPolicy} & ({id: SiteId} | {siteId: SiteId}),
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    const isAccessAuthorized = await evaluateAccessPolicy(
        context,
        siteItem.spaceId,
        siteItem.accessPolicy,
        expectedAccessLevel,
        options,
    );

    if (isAccessAuthorized) return okResult;

    return {
        ok: false,
        error: await createAccessPolicyPermissionDeniedError(context, {
            spaceId: siteItem.spaceId,
            expectedAccessLevel,
            aggregateDedupeKey: "id" in siteItem ? siteItem.id : siteItem.siteId,
            displayMessages: sitePermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
        }),
    };
}
