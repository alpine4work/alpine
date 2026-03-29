import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    authorizeSiteAccess,
    authorizeSiteAccessIfPossible,
} from "~/server/sites/data/internal/authorize_site_access.js";
import {getSiteItemForAuthorizationIfExists} from "~/server/sites/data/internal/get_site_item_for_authorization.js";
import {ErrorBase} from "~/shared/error/error.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {createSiteNotFoundError} from "~/shared/sites/site_error_messages.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

export async function getSitePreview(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<SitePreviewModel> {
    const site = await getSitePreviewIfExists(context, siteId, options);
    if (!site) throw createSiteNotFoundError(siteId);

    return site;
}

export async function getSitePreviewIfPossible(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<SitePreviewModel, ErrorBase>> {
    const item = await getSiteItemForAuthorizationIfExists(context, siteId, options);

    if (!item) return {ok: false, error: createSiteNotFoundError(siteId)};

    const result = await authorizeSiteAccessIfPossible(context, item, "View", options);
    if (!result.ok) return result;

    return {
        ok: true,
        value: new SitePreviewModel({
            id: item.siteId,
            spaceId: item.spaceId,
            accessPolicy: item.accessPolicy,
            name: item.name,
            firstEntityId: item.firstEntityId,
            createdTime: item.createdTime,
            version: item.updateLockVersion ?? 0,
        }),
    };
}

export async function getSitePreviewIfExists(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<SitePreviewModel | null> {
    const item = await getSiteItemForAuthorizationIfExists(context, siteId, options);
    if (!item) return null;

    await authorizeSiteAccess(context, item, "View", options);

    return new SitePreviewModel({
        id: item.siteId,
        spaceId: item.spaceId,
        accessPolicy: item.accessPolicy,
        name: item.name,
        firstEntityId: item.firstEntityId,
        createdTime: item.createdTime,
        version: item.updateLockVersion ?? 0,
    });
}
