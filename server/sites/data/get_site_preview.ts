import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSiteAccessAndReturnItemIfExists} from "~/server/sites/data/internal/authorize_site_access_and_return_item.js";
import {createSitePreviewModelFromItem} from "~/server/sites/data/internal/create_site_preview_model_from_item.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
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
): Promise<Result<SitePreviewModel, ErrorBase> | null> {
    const result = await authorizeSiteAccessAndReturnItemIfExists(context, siteId, "View", options);

    if (!result) return null;
    if (!result.ok) return result;

    return {
        ok: true,
        value: createSitePreviewModelFromItem(result.value),
    };
}

export async function getSitePreviewIfExists(
    context: ServerMinimalActionContext,
    siteId: SiteId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<SitePreviewModel | null> {
    const result = await authorizeSiteAccessAndReturnItemIfExists(context, siteId, "View", options);
    if (!result) return null;

    const item = unwrapResult(result);

    return createSitePreviewModelFromItem(item);
}
