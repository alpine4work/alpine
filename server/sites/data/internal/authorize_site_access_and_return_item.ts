import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {getSiteItemForAuthorizationIfExists} from "~/server/sites/data/internal/get_site_item_for_authorization.js";
import {SiteAttributesItem} from "~/server/sites/data/internal/sites_table.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {
    createSiteNotFoundError,
    sitePermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/sites/site_error_messages.js";

export async function authorizeSiteAccessAndReturnItem(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<DynamoItem<SiteAttributesItem>> {
    return unwrapResult(
        await authorizeSiteAccessAndReturnItemIfPossible(
            context,
            siteId,
            expectedAccessLevel,
            options,
        ),
    );
}

export async function authorizeSiteAccessAndReturnItemIfExists(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<DynamoItem<SiteAttributesItem>, ErrorBase> | null> {
    const siteAttributesItem = await getSiteItemForAuthorizationIfExists(context, siteId, options);

    if (!siteAttributesItem) return null;

    const isAccessAuthorized = await evaluateAccessPolicy(
        context,
        siteAttributesItem.spaceId,
        siteAttributesItem.accessPolicy,
        expectedAccessLevel,
        options,
    );

    if (isAccessAuthorized) return {ok: true, value: siteAttributesItem};

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

export async function authorizeSiteAccessAndReturnItemIfPossible(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<DynamoItem<SiteAttributesItem>, ErrorBase>> {
    const result = await authorizeSiteAccessAndReturnItemIfExists(
        context,
        siteId,
        expectedAccessLevel,
        options,
    );
    if (!result) return {ok: false, error: createSiteNotFoundError(siteId)} as const;
    return result;
}
