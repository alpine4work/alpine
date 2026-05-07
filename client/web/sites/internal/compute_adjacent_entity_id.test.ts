import {computeAdjacentEntityId} from "~/client/web/sites/internal/compute_adjacent_entity_id.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    SiteId,
    SiteSideBarId,
    SiteSideBarSectionId,
    SiteTopBarId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {
    SiteContainerId,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
    SiteTopBarContainerId,
} from "~/shared/sites/site_entry_id.js";
import {SiteItemSearchEntityId} from "~/shared/sites/site_item_search_entity_id.js";
import {
    SiteEntityModel,
    SiteEntryModel,
    SitePreviewModelData,
    SiteSideBarModel,
    SiteSideBarSectionModel,
    SiteTopBarModel,
} from "~/shared/sites/site_model.js";
import {SiteTreeBase} from "~/shared/sites/site_tree_base.js";

const siteId = generateId<SiteId>();
const spaceId = generateId<SpaceId>();
const creatorId = generateId<AccountId>();

function entity({
    parentId,
    orderKey,
}: {
    parentId: SiteContainerId;
    orderKey: string;
}): SiteEntityModel {
    const id: SiteItemSearchEntityId = `Channel:${generateId<ChannelId>()}`;
    return new SiteEntityModel({
        type: "Entity",
        id,
        orderKey: assertOrderKey(orderKey),
        parentId,
        spaceId,
        version: 0,
        initialEntityData: {
            id,
            title: "test entity",
            titleVersion: null,
            media: null,
        },
    });
}

function section({
    parentId,
    orderKey,
    label = "section",
}: {
    parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    orderKey: string;
    label?: string;
}): SiteSideBarSectionModel {
    return new SiteSideBarSectionModel({
        type: "SideBarSection",
        id: `SideBarSection:${generateId<SiteSideBarSectionId>()}`,
        orderKey: assertOrderKey(orderKey),
        parentId,
        label,
        version: 0,
    });
}

function sidebar({
    parentId = null,
    orderKey = "a0",
}: {
    parentId?: SiteTopBarContainerId | null;
    orderKey?: string;
} = {}): SiteSideBarModel {
    return new SiteSideBarModel({
        type: "SideBar",
        id: `SideBar:${generateId<SiteSideBarId>()}`,
        orderKey: assertOrderKey(orderKey),
        parentId,
        label: "sidebar",
        version: 0,
    });
}

function topbar({orderKey = "a0"}: {orderKey?: string} = {}): SiteTopBarModel {
    return new SiteTopBarModel({
        type: "TopBar",
        id: `TopBar:${generateId<SiteTopBarId>()}`,
        orderKey: assertOrderKey(orderKey),
        parentId: null,
        label: "topbar",
        version: 0,
    });
}

function makeTree(entries: ReadonlyArray<SiteEntryModel>): SiteTreeBase<SiteEntryModel> {
    const rootEntry = entries.find(
        (e): e is SiteTopBarModel | SiteSideBarModel =>
            (e.type === "TopBar" || e.type === "SideBar") && e.parentId === null,
    );
    const site: SitePreviewModelData = {
        id: siteId,
        spaceId,
        name: "Test Site",
        firstEntityId: null,
        createdTime: new Date(),
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map(),
            defaultGrant: null,
            urlGrant: null,
        },
        version: 0,
        rootContainerId: rootEntry?.id ?? `SideBar:${generateId<SiteSideBarId>()}`,
        creatorId,
    };
    return SiteTreeBase.fromEntries(site, entries);
}

describe("computeAdjacentEntityId", () => {
    test("returns null when the entity is the only one in the tree", () => {
        // ```
        // SideBar
        //   only            ← target (only entity in tree)
        // ```
        const root = sidebar();
        const rootId = root.id;
        const only = entity({parentId: rootId, orderKey: "a0"});

        expect(computeAdjacentEntityId(only.id, makeTree([root, only]))).toBeNull();
    });

    test("returns the preceding sibling entity", () => {
        // ```
        // SideBar
        //   a               ← expected
        //   b               ← target
        // ```
        const root = sidebar();
        const rootId = root.id;
        const a = entity({parentId: rootId, orderKey: "a0"});
        const b = entity({parentId: rootId, orderKey: "a1"});

        expect(computeAdjacentEntityId(b.id, makeTree([root, a, b]))).toBe(a.id);
    });

    test("falls back to the following sibling when no preceding entity exists", () => {
        // ```
        // SideBar
        //   a               ← target (leftmost — nothing to walk up to)
        //   b               ← expected (fall back to walking down)
        // ```
        const root = sidebar();
        const rootId = root.id;
        const a = entity({parentId: rootId, orderKey: "a0"});
        const b = entity({parentId: rootId, orderKey: "a1"});

        expect(computeAdjacentEntityId(a.id, makeTree([root, a, b]))).toBe(b.id);
    });

    test("uses orderKey order, not insertion order, for sibling lookups", () => {
        // ```
        // SideBar (insertion: high, mid, low — reverse of orderKey order)
        //   low (a1)        ← expected
        //   mid (a2)        ← target
        //   high (a3)
        // ```
        //
        // The preceding entity of `mid` must be `low` (the orderKey-preceding sibling),
        // not `high` (the insertion-order-preceding sibling).
        const root = sidebar();
        const rootId = root.id;
        const high = entity({parentId: rootId, orderKey: "a3"});
        const mid = entity({parentId: rootId, orderKey: "a2"});
        const low = entity({parentId: rootId, orderKey: "a1"});

        expect(computeAdjacentEntityId(mid.id, makeTree([root, high, mid, low]))).toBe(low.id);
    });

    test("walks into a preceding sibling section’s rightmost entity (DFS reverse)", () => {
        // ```
        // SideBar
        //   Section
        //     inSecFirst
        //     inSecLast     ← expected (rightmost in preceding subtree)
        //   after           ← target
        // ```
        const root = sidebar();
        const rootId = root.id;
        const sec = section({parentId: rootId, orderKey: "a0"});
        const secId = sec.id;
        const inSecFirst = entity({parentId: secId, orderKey: "a0"});
        const inSecLast = entity({parentId: secId, orderKey: "a1"});
        const after = entity({parentId: rootId, orderKey: "a1"});

        expect(
            computeAdjacentEntityId(after.id, makeTree([root, sec, inSecFirst, inSecLast, after])),
        ).toBe(inSecLast.id);
    });

    test("walks into a following sibling section’s leftmost entity (DFS forward)", () => {
        // ```
        // SideBar
        //   before          ← target (no preceding entity)
        //   Section
        //     inSecFirst    ← expected (leftmost in following subtree)
        //     inSecLast
        // ```
        const root = sidebar();
        const rootId = root.id;
        const before = entity({parentId: rootId, orderKey: "a0"});
        const sec = section({parentId: rootId, orderKey: "a1"});
        const secId = sec.id;
        const inSecFirst = entity({parentId: secId, orderKey: "a0"});
        const inSecLast = entity({parentId: secId, orderKey: "a1"});

        expect(
            computeAdjacentEntityId(
                before.id,
                makeTree([root, before, sec, inSecFirst, inSecLast]),
            ),
        ).toBe(inSecFirst.id);
    });

    test("walks up out of a section to find a preceding sibling-of-parent entity", () => {
        // ```
        // SideBar
        //   beforeSection   ← expected
        //   Section
        //     onlyChild     ← target (no preceding sibling within Section)
        // ```
        //
        // Walk has to climb out of Section and look at Section’s preceding siblings.
        const root = sidebar();
        const rootId = root.id;
        const beforeSection = entity({parentId: rootId, orderKey: "a0"});
        const sec = section({parentId: rootId, orderKey: "a1"});
        const secId = sec.id;
        const onlyChild = entity({parentId: secId, orderKey: "a0"});

        expect(
            computeAdjacentEntityId(onlyChild.id, makeTree([root, beforeSection, sec, onlyChild])),
        ).toBe(beforeSection.id);
    });

    test("skips empty preceding sibling sections", () => {
        // ```
        // SideBar
        //   earlier         ← expected
        //   EmptySection    (skipped — contains no entities)
        //   target          ← target
        // ```
        const root = sidebar();
        const rootId = root.id;
        const earlier = entity({parentId: rootId, orderKey: "a0"});
        const empty = section({parentId: rootId, orderKey: "a1"});
        const target = entity({parentId: rootId, orderKey: "a2"});

        expect(computeAdjacentEntityId(target.id, makeTree([root, earlier, empty, target]))).toBe(
            earlier.id,
        );
    });

    test("skips empty following sibling sections when walking down", () => {
        // ```
        // SideBar
        //   target          ← target (no preceding entity)
        //   EmptySection    (skipped — contains no entities)
        //   later           ← expected
        // ```
        const root = sidebar();
        const rootId = root.id;
        const target = entity({parentId: rootId, orderKey: "a0"});
        const empty = section({parentId: rootId, orderKey: "a1"});
        const later = entity({parentId: rootId, orderKey: "a2"});

        expect(computeAdjacentEntityId(target.id, makeTree([root, target, empty, later]))).toBe(
            later.id,
        );
    });

    test("walks down across multiple ancestor levels when no preceding entity exists", () => {
        // ```
        // TopBar
        //   SideBar1
        //     target        ← target (only entity in SideBar1; no preceding anywhere)
        //   SideBar2
        //     cousin        ← expected
        // ```
        //
        // Walk has to climb from target out of SideBar1, up to TopBar, and pick up
        // SideBar1’s following sibling SideBar2.
        const top = topbar();
        const topId = top.id;
        const left = sidebar({parentId: topId, orderKey: "a0"});
        const leftId = left.id;
        const right = sidebar({parentId: topId, orderKey: "a1"});
        const rightId = right.id;
        const target = entity({parentId: leftId, orderKey: "a0"});
        const cousin = entity({parentId: rightId, orderKey: "a0"});

        expect(
            computeAdjacentEntityId(target.id, makeTree([top, left, right, target, cousin])),
        ).toBe(cousin.id);
    });

    test("walks up through multiple ancestor levels to find a preceding entity", () => {
        // ```
        // TopBar
        //   SideBar1
        //     cousin        ← expected
        //   SideBar2
        //     Section
        //       target      ← target
        // ```
        //
        // Predecessor must be found by climbing target → Section → SideBar2 → TopBar and
        // picking up SideBar1 (a preceding sibling at the top level).
        const top = topbar();
        const topId = top.id;
        const left = sidebar({parentId: topId, orderKey: "a0"});
        const leftId = left.id;
        const right = sidebar({parentId: topId, orderKey: "a1"});
        const rightId = right.id;
        const sec = section({parentId: rightId, orderKey: "a0"});
        const secId = sec.id;
        const cousin = entity({parentId: leftId, orderKey: "a0"});
        const target = entity({parentId: secId, orderKey: "a0"});

        expect(
            computeAdjacentEntityId(target.id, makeTree([top, left, right, sec, cousin, target])),
        ).toBe(cousin.id);
    });

    test("returns null when the entity is the only one across a multi-level tree", () => {
        // ```
        // TopBar
        //   SideBar
        //     Section
        //       Inner
        //         lonely    ← target (only entity, deeply nested)
        // ```
        const top = topbar();
        const topId = top.id;
        const side = sidebar({parentId: topId, orderKey: "a0"});
        const sideId = side.id;
        const sec = section({parentId: sideId, orderKey: "a0"});
        const secId = sec.id;
        const inner = section({parentId: secId, orderKey: "a0"});
        const innerId = inner.id;
        const lonely = entity({parentId: innerId, orderKey: "a0"});

        expect(computeAdjacentEntityId(lonely.id, makeTree([top, side, sec, inner, lonely]))).toBe(
            null,
        );
    });

    test("finds rightmost entity in a deeply nested preceding subtree", () => {
        // ```
        // SideBar
        //   SectionLeft
        //     Inner1
        //       Inner2
        //         deepFirst
        //         deepLast  ← expected (rightmost entity in DFS reverse)
        //   target          ← target
        // ```
        //
        // Walking up out of `target` reaches SectionLeft as a preceding sibling, and the
        // rightmost entity inside it is `deepLast`.
        const root = sidebar();
        const rootId = root.id;
        const left = section({parentId: rootId, orderKey: "a0"});
        const leftId = left.id;
        const inner1 = section({parentId: leftId, orderKey: "a0"});
        const inner1Id = inner1.id;
        const inner2 = section({parentId: inner1Id, orderKey: "a0"});
        const inner2Id = inner2.id;
        const deepFirst = entity({parentId: inner2Id, orderKey: "a0"});
        const deepLast = entity({parentId: inner2Id, orderKey: "a1"});
        const target = entity({parentId: rootId, orderKey: "a1"});

        expect(
            computeAdjacentEntityId(
                target.id,
                makeTree([root, left, inner1, inner2, deepFirst, deepLast, target]),
            ),
        ).toBe(deepLast.id);
    });

    test("finds leftmost entity in a deeply nested following subtree", () => {
        // ```
        // SideBar
        //   target          ← target (no preceding entity)
        //   SectionRight
        //     Inner1
        //       Inner2
        //         deepFirst ← expected (leftmost entity in DFS forward)
        //         deepLast
        // ```
        //
        // Mirror of the rightmost case — walk falls through to following siblings and
        // recurses into the leftmost entity in the deeply-nested subtree.
        const root = sidebar();
        const rootId = root.id;
        const target = entity({parentId: rootId, orderKey: "a0"});
        const right = section({parentId: rootId, orderKey: "a1"});
        const rightId = right.id;
        const inner1 = section({parentId: rightId, orderKey: "a0"});
        const inner1Id = inner1.id;
        const inner2 = section({parentId: inner1Id, orderKey: "a0"});
        const inner2Id = inner2.id;
        const deepFirst = entity({parentId: inner2Id, orderKey: "a0"});
        const deepLast = entity({parentId: inner2Id, orderKey: "a1"});

        expect(
            computeAdjacentEntityId(
                target.id,
                makeTree([root, target, right, inner1, inner2, deepFirst, deepLast]),
            ),
        ).toBe(deepFirst.id);
    });

    test("prefers preceding entity over following entity", () => {
        // ```
        // SideBar
        //   before          ← expected (up-direction wins)
        //   target          ← target
        //   after           (also adjacent, but down-direction loses)
        // ```
        //
        // Walk must exhaust the up-direction before consulting the down-direction.
        const root = sidebar();
        const rootId = root.id;
        const before = entity({parentId: rootId, orderKey: "a0"});
        const target = entity({parentId: rootId, orderKey: "a1"});
        const after = entity({parentId: rootId, orderKey: "a2"});

        expect(computeAdjacentEntityId(target.id, makeTree([root, before, target, after]))).toBe(
            before.id,
        );
    });

    test("ignores entries unrelated to the target’s ancestry", () => {
        // ```
        // TopBar
        //   SideBar1        (empty — no entities)
        //   SideBar2
        //     target        ← target
        //   SideBar3
        //     unrelated     ← expected
        // ```
        //
        // SideBar1 contributes no preceding entity, so the walk falls through to SideBar3
        // (a following sibling at the top level).
        const top = topbar();
        const topId = top.id;
        const sb1 = sidebar({parentId: topId, orderKey: "a0"});
        const sb2 = sidebar({parentId: topId, orderKey: "a1"});
        const sb2Id = sb2.id;
        const sb3 = sidebar({parentId: topId, orderKey: "a2"});
        const sb3Id = sb3.id;
        const target = entity({parentId: sb2Id, orderKey: "a0"});
        const unrelated = entity({parentId: sb3Id, orderKey: "a0"});

        expect(
            computeAdjacentEntityId(target.id, makeTree([top, sb1, sb2, sb3, target, unrelated])),
        ).toBe(unrelated.id);
    });
});
