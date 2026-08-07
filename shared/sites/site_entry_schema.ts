import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {
    SiteContainerIdSchema,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
    SiteTopBarContainerIdSchema,
} from "~/shared/sites/site_entry_id.js";

export const SiteEntryTopBarSchema = Schema.object({
    type: Schema.value("TopBar"),
    orderKey: OrderKeySchema,
    label: LabelStringSchema,
    /**
     * For now, the TopBar can only be the root node so `parentId` is always null.
     *
     * Long term, we may allow TopBars to be nested under other TopBars.
     */
    parentId: Schema.value(null),
});

type SiteEntryTopBar = SchemaType<typeof SiteEntryTopBarSchema>;

export const SiteEntrySideBarSchema = Schema.object({
    type: Schema.value("SideBar"),
    label: LabelStringSchema,
    orderKey: OrderKeySchema,
    /**
     * The ID of the parent container. Can be:
     *
     * - null: This SideBar is the root of the site
     * - SiteTopBarContainerId: The SideBar is a child of a TopBar
     */
    parentId: SiteTopBarContainerIdSchema.nullable(),
});
type SiteEntrySideBar = SchemaType<typeof SiteEntrySideBarSchema>;

export const SiteEntrySideBarSectionSchema = Schema.object({
    type: Schema.value("SideBarSection"),
    label: LabelStringSchema,
    orderKey: OrderKeySchema,
    /**
     * A SideBarSection must be nested under a SideBar or another SideBarSection.
     */
    parentId: Schema.stringAs<SiteSideBarContainerId | SiteSideBarSectionContainerId>(),
});
type SiteEntrySideBarSection = SchemaType<typeof SiteEntrySideBarSectionSchema>;

export const SiteEntryEntitySchema = Schema.object({
    type: Schema.value("Entity"),
    orderKey: OrderKeySchema,
    /** An Entity can be nested under any container type. */
    parentId: SiteContainerIdSchema,
    spaceId: Schema.id<SpaceId>(),
});
export type SiteEntryEntity = SchemaType<typeof SiteEntryEntitySchema>;

export type SiteEntryContainer = SiteEntryTopBar | SiteEntrySideBar | SiteEntrySideBarSection;
export type SiteEntry = SiteEntryContainer | SiteEntryEntity;

type SiteContainerType = SiteEntryContainer["type"];
type SiteEntryType = SiteEntry["type"];

/**
 * Helper to check if a site item is a container (can have children).
 */
export function isSiteEntryContainer(item: SiteEntry): item is SiteEntryContainer {
    return isSiteEntryContainerType(item.type);
}

/**
 * Helper to check if a site item is a leaf (cannot have children).
 */
export function isSiteEntryLeaf(item: SiteEntry): item is SiteEntryEntity {
    switch (item.type) {
        case "TopBar":
        case "SideBar":
        case "SideBarSection":
            return false;
        case "Entity":
            return true;
        default:
            throw exhaustive(item);
    }
}

export function isSiteEntryContainerType(
    type: SiteEntryType | null,
): type is SiteContainerType | null {
    if (type === null) return true;

    switch (type) {
        case "TopBar":
        case "SideBar":
        case "SideBarSection":
            return true;
        case "Entity":
            return false;
        default:
            throw exhaustive(type);
    }
}
