import {InternalError} from "~/shared/error/error.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {assertId, isId} from "~/shared/id/id.js";
import {SiteSideBarId, SiteSideBarSectionId, SiteTopBarId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    SiteItemSearchEntityId,
    isSiteItemSearchEntityId,
} from "~/shared/sites/site_item_search_entity_id.js";

export type SiteEntryId =
    | SiteTopBarId
    | SiteSideBarId
    | SiteSideBarSectionId
    | SiteItemSearchEntityId;

/**
 * A compound string identifier for a site container, encoding both the container
 * type and its underlying ID. This guarantees uniqueness across container types,
 * since two different container types could otherwise share the same underlying ID
 * value.
 *
 * Format: `<ContainerType>:<UnderlyingId>`
 *
 * Examples:
 *
 * - `TopBar:abc123`
 * - `SideBar:xyz789`
 * - `SideBarSection:def456`
 */
export type SiteTopBarContainerId = `TopBar:${SiteTopBarId}`;
export type SiteSideBarContainerId = `SideBar:${SiteSideBarId}`;
export type SiteSideBarSectionContainerId = `SideBarSection:${SiteSideBarSectionId}`;

export type SiteRootContainerId = SiteTopBarContainerId | SiteSideBarContainerId;

export type SiteContainerId =
    | SiteTopBarContainerId
    | SiteSideBarContainerId
    | SiteSideBarSectionContainerId;

export type SiteTopBarContainerIdObject = {readonly type: "TopBar"; readonly id: SiteTopBarId};
export type SiteSideBarContainerIdObject = {readonly type: "SideBar"; readonly id: SiteSideBarId};
export type SiteSideBarSectionContainerIdObject = {
    readonly type: "SideBarSection";
    readonly id: SiteSideBarSectionId;
};
export type SiteContainerIdObject =
    | SiteTopBarContainerIdObject
    | SiteSideBarContainerIdObject
    | SiteSideBarSectionContainerIdObject;

export type SiteEntityIdObject = {readonly type: "Entity"; readonly id: SiteItemSearchEntityId};

export type SiteEntryIdObject = SiteContainerIdObject | SiteEntityIdObject;

const siteContainerIdTestMap: {[key: string]: (idRest: string) => boolean} = {
    TopBar: isId,
    SideBar: isId,
    SideBarSection: isId,
};

export function isSiteEntityIdObject(id: SiteEntryIdObject): id is SiteEntityIdObject {
    switch (id.type) {
        case "Entity":
            return true;
        case "TopBar":
        case "SideBar":
        case "SideBarSection":
            return false;
        default:
            throw exhaustive(id);
    }
}

export function isSiteContainerIdObject(id: SiteEntryIdObject): id is SiteContainerIdObject {
    switch (id.type) {
        case "TopBar":
        case "SideBar":
        case "SideBarSection":
            return true;
        case "Entity":
            return false;
        default:
            throw exhaustive(id);
    }
}

export function isSiteContainerId(id: string): id is SiteContainerId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    const idTest = cast<{[key: string]: ((idRest: string) => boolean) | undefined}>(
        siteContainerIdTestMap,
    )[idType];

    if (idTest === undefined) return false;

    return idTest(idRest);
}

export const SiteTopBarContainerIdSchema = Schema.string as Schema<SiteTopBarContainerId>;
export const SiteContainerIdSchema = Schema.string as Schema<SiteContainerId>;

export function isSiteTopBarContainerId(id: string): id is SiteTopBarContainerId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    return idType === "TopBar" && isId(idRest);
}

export function isSiteSideBarContainerId(id: string): id is SiteSideBarContainerId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    return idType === "SideBar" && isId(idRest);
}

export function isSiteSideBarSectionContainerId(id: string): id is SiteSideBarSectionContainerId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    return idType === "SideBarSection" && isId(idRest);
}

type SiteContainerIdByType = {
    TopBar: SiteTopBarContainerId;
    SideBar: SiteSideBarContainerId;
    SideBarSection: SiteSideBarSectionContainerId;
};

export function parseSiteContainerId<T extends SiteContainerIdObject["type"]>(
    id: SiteContainerIdByType[T],
): Extract<SiteContainerIdObject, {type: T}> {
    const [idType, idPayload = ""] = id.split(":", 2);

    switch (idType) {
        case "TopBar":
            return {type: "TopBar", id: idPayload as SiteTopBarId} as Extract<
                SiteContainerIdObject,
                {type: T}
            >;
        case "SideBar":
            return {type: "SideBar", id: idPayload as SiteSideBarId} as Extract<
                SiteContainerIdObject,
                {type: T}
            >;
        case "SideBarSection":
            return {type: "SideBarSection", id: idPayload as SiteSideBarSectionId} as Extract<
                SiteContainerIdObject,
                {type: T}
            >;
        default:
            throw new InternalError(quote`Unrecognized \`SiteContainerId\` type ${idType ?? ""}`);
    }
}

export function printSiteContainerId<T extends SiteContainerIdObject["type"]>(
    idObject: Extract<SiteContainerIdObject, {type: T}>,
): SiteContainerIdByType[T] {
    const object: SiteContainerIdObject = idObject;
    switch (object.type) {
        case "TopBar":
            return `TopBar:${object.id}` as SiteContainerIdByType[T];
        case "SideBar":
            return `SideBar:${object.id}` as SiteContainerIdByType[T];
        case "SideBarSection":
            return `SideBarSection:${object.id}` as SiteContainerIdByType[T];
        default:
            throw exhaustive(object);
    }
}

export function parseSiteSideBarSectionContainerId(
    id: SiteSideBarSectionContainerId,
): SiteSideBarSectionContainerIdObject {
    const [, idPayload = ""] = id.split(":", 2);
    return {type: "SideBarSection", id: assertId<SiteSideBarSectionId>(idPayload)};
}

export function isSiteEntryId(id: string): id is SiteEntryId {
    return (
        isSiteTopBarContainerId(id) ||
        isSiteSideBarContainerId(id) ||
        isSiteSideBarSectionContainerId(id) ||
        isSiteItemSearchEntityId(id)
    );
}

/**
 * Returns a unique key for a site entry. Site containers (TopBar, SideBar, etc)
 * can only be uniquely identified by their type and id, so we can use the
 * container id (e.g. `TopBar:${SiteTopBarId}`)to uniquely identify them.
 */
export function getSiteEntryKey(item: SiteEntryIdObject): SiteContainerId | SiteItemSearchEntityId {
    switch (item.type) {
        case "Entity":
            return item.id;
        case "SideBar":
        case "SideBarSection":
        case "TopBar":
            return printSiteContainerId(item);
        default:
            throw exhaustive(item);
    }
}
