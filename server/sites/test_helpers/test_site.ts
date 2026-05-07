import {TestAccessPolicy} from "~/server/access/test_helpers/test_access_policy.js";
import {createSite} from "~/server/sites/data/create_site.js";
import {createSiteContainer} from "~/server/sites/data/create_site_container.js";
import {deleteSiteContainer} from "~/server/sites/data/delete_site_container.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {getSitePreview} from "~/server/sites/data/get_site_preview.js";
import {moveSiteEntry} from "~/server/sites/data/move_site_entry.js";
import {updateSiteAccessPolicy} from "~/server/sites/data/update_site_access_policy.js";
import {updateSiteContainerLabel} from "~/server/sites/data/update_site_container_label.js";
import {addEntityToSite} from "~/server/sites/entity_actions/add_entity_to_site.js";
import {removeEntityFromSite} from "~/server/sites/entity_actions/remove_entity_from_site.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    SiteId,
    SiteSideBarId,
    SiteSideBarSectionId,
    SiteTopBarId,
} from "~/shared/id/types/id_types.js";
import {
    SiteContainerId,
    SiteSideBarContainerIdObject,
    SiteSideBarSectionContainerIdObject,
    SiteTopBarContainerIdObject,
    printSiteContainerId,
} from "~/shared/sites/site_entry_id.js";
import {SiteItemSearchEntityId} from "~/shared/sites/site_item_search_entity_id.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

let testSiteCount = 1;

/**
 * A utility for creating sites in tests. Mirrors the `TestChannel` /
 * `TestDocument` / `TestTaskCollection` pattern: every operation goes through a
 * real server action so tests exercise the same code path as production.
 *
 * Tests that need to construct intentionally invalid tree states (orphaned
 * entries, bad `firstEntityId` values, etc.) should keep their own ad-hoc
 * `SitesTable.createItem` calls — `TestSite` only constructs valid states.
 */
export class TestSite {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: SiteId;
    public readonly initialName: string;
    public readonly initialRootContainer:
        | SiteTopBarContainerIdObject
        | SiteSideBarContainerIdObject;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: SiteId,
        initialName: string,
        initialRootContainer: SiteTopBarContainerIdObject | SiteSideBarContainerIdObject,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this.initialName = initialName;
        this.initialRootContainer = initialRootContainer;
    }

    public static async create(
        session: TestSpaceSession,
        {
            id = generateId<SiteId>(),
            name = `Test Site ${testSiteCount++}`,
            access,
            root: rootInput = {type: "SideBar"},
        }: {
            id?: SiteId;
            name?: string;
            // Sites cannot inherit access from other sites, so only `LocalAccessPolicy` is
            // valid here.
            access?: "Public" | "Private" | LocalAccessPolicy;
            root?: {type: "TopBar"; id?: SiteTopBarId} | {type: "SideBar"; id?: SiteSideBarId};
        } = {},
    ): Promise<TestSite> {
        let accessPolicy: LocalAccessPolicy | undefined;
        if (access === "Public") {
            accessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: null,
            };
        } else if (access === "Private") {
            accessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            };
        } else if (access !== undefined) {
            accessPolicy = access;
        }

        const root: SiteTopBarContainerIdObject | SiteSideBarContainerIdObject =
            rootInput.type === "TopBar"
                ? {type: "TopBar", id: rootInput.id ?? generateId<SiteTopBarId>()}
                : {type: "SideBar", id: rootInput.id ?? generateId<SiteSideBarId>()};

        await createSite(session.action(), {
            spaceId: session.space.id,
            siteId: id,
            name,
            accessPolicy,
            root,
        });

        return new TestSite(session.context, session.space, id, name, root);
    }

    public get initialRootContainerId(): SiteContainerId {
        return printSiteContainerId(this.initialRootContainer);
    }

    /**
     * Narrows `initialRootContainer` to a `SideBar` root. Throws if the site was
     * created with a `TopBar` root.
     */
    public get initialSideBarRoot(): SiteSideBarContainerIdObject {
        assert(
            this.initialRootContainer.type === "SideBar",
            "Site root is a TopBar, not a SideBar",
        );
        return this.initialRootContainer;
    }

    /**
     * Narrows `initialRootContainer` to a `TopBar` root. Throws if the site was
     * created with a `SideBar` root.
     */
    public get initialTopBarRoot(): SiteTopBarContainerIdObject {
        assert(this.initialRootContainer.type === "TopBar", "Site root is a SideBar, not a TopBar");
        return this.initialRootContainer;
    }

    public async getPreview(): Promise<SitePreviewModel> {
        return await getSitePreview(this.space.systemAction(), this.id);
    }

    public async getItems() {
        return await getSite(this.space.systemAction(), {siteId: this.id});
    }

    public readonly access = new TestAccessPolicy({
        get: async () => {
            const site = await getSitePreview(this.space.systemAction(), this.id);
            return site.initialData.accessPolicy;
        },
        set: async (session, accessPolicy) => {
            if (accessPolicy.type !== "Local") {
                throw new FailedPreconditionError("Sites only support `LocalAccessPolicy`");
            }
            await updateSiteAccessPolicy(session.action(), {
                siteId: this.id,
                accessPolicy,
            });
        },
    });

    public async addSideBar(
        session: TestSpaceSession,
        {
            id = generateId<SiteSideBarId>(),
            label = "SideBar",
            orderKey,
            parent,
        }: {
            id?: SiteSideBarId;
            label?: string;
            orderKey: OrderKey;
            parent: SiteTopBarContainerIdObject;
        },
    ): Promise<SiteSideBarId> {
        await createSiteContainer(session.action(), this.id, {
            container: {type: "SideBar", id, parent},
            label,
            orderKey,
        });
        return id;
    }

    public async addSection(
        session: TestSpaceSession,
        {
            id = generateId<SiteSideBarSectionId>(),
            label = "Section",
            orderKey,
            parent,
        }: {
            id?: SiteSideBarSectionId;
            label?: string;
            orderKey: OrderKey;
            parent: SiteSideBarContainerIdObject | SiteSideBarSectionContainerIdObject;
        },
    ): Promise<SiteSideBarSectionId> {
        await createSiteContainer(session.action(), this.id, {
            container: {type: "SideBarSection", id, parent},
            label,
            orderKey,
        });
        return id;
    }

    public async updateContainerLabel(
        session: TestSpaceSession,
        {
            container,
            label,
        }: {
            container: SiteSideBarContainerIdObject | SiteSideBarSectionContainerIdObject;
            label: string;
        },
    ): Promise<void> {
        await updateSiteContainerLabel(session.action(), {
            siteId: this.id,
            id: printSiteContainerId(container),
            label,
        });
    }

    public async deleteContainer(
        session: TestSpaceSession,
        container: SiteSideBarContainerIdObject | SiteSideBarSectionContainerIdObject,
    ): Promise<void> {
        await deleteSiteContainer(session.action(), {siteId: this.id, container});
    }

    public async addEntity(
        session: TestSpaceSession,
        {
            entityId,
            parentId,
            orderKey,
        }: {
            entityId: SiteItemSearchEntityId;
            parentId: SiteContainerId;
            orderKey: OrderKey;
        },
    ): Promise<void> {
        await addEntityToSite(session.action(), {
            siteId: this.id,
            spaceId: this.space.id,
            entityId,
            parentId,
            orderKey,
        });
    }

    public async removeEntity(
        session: TestSpaceSession,
        entityId: SiteItemSearchEntityId,
    ): Promise<void> {
        await removeEntityFromSite(session.action(), {
            siteId: this.id,
            spaceId: this.space.id,
            entityId,
        });
    }

    public async moveEntry(
        session: TestSpaceSession,
        item: Parameters<typeof moveSiteEntry>[1]["item"],
    ): Promise<void> {
        await moveSiteEntry(session.action(), {siteId: this.id, item});
    }
}
