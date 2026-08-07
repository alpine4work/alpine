import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SiteAttributesItem} from "~/server/sites/data/internal/sites_table.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {
    createSiteNotFoundError,
    sitePermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/sites/site_error_messages.js";

export async function authorizeSiteAccessForSiteItem(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    siteAttributesItem: SiteAttributesItem | null,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<void> {
    return unwrapResult(
        await authorizeSiteAccessForSiteItemIfPossible(
            context,
            siteId,
            siteAttributesItem,
            expectedAccessLevel,
            options,
        ),
    );
}

export async function authorizeSiteAccessForSiteItemIfPossible(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    siteAttributesItem: SiteAttributesItem | null,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    if (!siteAttributesItem) return {ok: false, error: createSiteNotFoundError(siteId)};

    const isAccessAuthorized = await evaluateAccessPolicy(
        context,
        siteAttributesItem.spaceId,
        siteAttributesItem.accessPolicy,
        expectedAccessLevel,
        options,
    );

    if (isAccessAuthorized) return okResult;

    return {
        ok: false,
        error: await createAccessPolicyPermissionDeniedError(context, {
            spaceId: siteAttributesItem.spaceId,
            expectedAccessLevel,
            aggregateDedupeKey: siteId,
            displayMessages: sitePermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
        }),
    };
}
