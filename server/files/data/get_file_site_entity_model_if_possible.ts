import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getFileEntityIfPossible} from "~/server/files/data/get_file_entity_if_possible.js";
import {getSitePreviewIfPossible} from "~/server/sites/data/get_site_preview.js";
import {ErrorBase} from "~/shared/error/error.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {FileSiteEntityModel} from "~/shared/sites/file_site_entity_model_schema.js";
import {createSiteNotFoundError} from "~/shared/sites/site_error_messages.js";

export async function getFileSiteEntityModelIfPossible(
    context: ServerActionContext,
    siteId: SiteId,
): Promise<Result<FileSiteEntityModel, ErrorBase>> {
    const siteResult = await getSitePreviewIfPossible(context, siteId);
    if (!siteResult) return {ok: false, error: createSiteNotFoundError(siteId)};
    if (!siteResult.ok) return siteResult;
    const site = siteResult.value;

    // Eagerly load the first entity for the nested preview. The
    // `fileEntityMaxRecursionDepth` guard in `getFileEntityIfPossible()` keeps this
    // bounded even though sites can't contain sites. Pass `siteIfAlreadyLoaded` so the
    // first entity's own site lookup short-circuits to the site preview we already
    // have rather than refetching it.
    let firstEntity: FileEntityModel | null = null;
    if (site.initialData.firstEntityId) {
        const firstEntityResult = await getFileEntityIfPossible(
            context,
            site.initialData.spaceId,
            site.initialData.firstEntityId,
            {siteIfAlreadyLoaded: site},
        );

        // `getFileEntityIfPossible` returns `null` at the recursion-depth cutoff (a deeply
        // nested preview), in which case we render the site as empty. Otherwise, access to
        // the site implies access to its first entity (entries inherit the site's access
        // policy), so the load can't come back not-ok — assert that invariant here on the
        // server so the failed-load state stays impossible for clients.
        if (firstEntityResult) {
            assert(firstEntityResult.ok);
            firstEntity = firstEntityResult.value;
        }
    }

    return {
        ok: true,
        value: {
            type: "Site",
            versions: [site.initialData.version],
            id: siteId,
            name: site.initialData.name,
            firstEntity,
        },
    };
}
