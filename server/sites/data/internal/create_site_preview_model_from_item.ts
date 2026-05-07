import {SiteAttributesItem} from "~/server/sites/data/internal/sites_table.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

export function createSitePreviewModelFromItem(item: SiteAttributesItem): SitePreviewModel {
    return new SitePreviewModel({
        id: item.siteId,
        spaceId: item.spaceId,
        accessPolicy: item.accessPolicy,
        name: item.name,
        firstEntityId: item.firstEntityId,
        rootContainerId: item.rootContainerId,
        creatorId: item.creatorId,
        createdTime: item.createdTime,
        version: item.updateLockVersion ?? 0,
    });
}
