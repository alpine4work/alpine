import {BrowserContext, Page, expect} from "@playwright/test";
import {TestServices} from "~/admin/environment/test/integration/with_integration_test_environment.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

/**
 * Each scenario maps to one branch of `getNextAccessPolicyAction` in
 * `share_switch.tsx` when the resolved access policy is of type `"Site"`. The
 * branches diverge by which combination of `defaultGrant` and `urlGrant` the site
 * already has when the user presses the toggle.
 */
export type ShareSwitchInSiteScenario =
    | "PrivateToPublic"
    | "DefaultGrantToPrivate"
    | "UrlGrantToPrivate"
    | "DefaultAndUrlGrantToPrivate";

/**
 * Drives the full site-level share switch confirmation flow for an entity: creates
 * a space, the entity, and a site with the scenario's initial access policy; adds
 * the entity to the site; signs in; navigates to the entity; then presses the
 * toggle and asserts the modal copy and resulting icon.
 *
 * The `createEntity` callback is responsible for building the entity (e.g.
 * `TestTaskCollection.create(...)`) and returning the bits this helper needs to
 * navigate to it in the UI.
 */
export async function expectShareSwitchInSiteToggle({
    page,
    browserContext,
    context,
    services,
    spaceName = "Test Space",
    entityNoun,
    createEntity,
    scenario,
}: {
    page: Page;
    browserContext: BrowserContext;
    context: TestActualContext;
    services: TestServices;
    spaceName?: string;
    entityNoun: string;
    createEntity: (session: TestSpaceSession) => Promise<{
        entityId: SiteItemSearchEntityId;
        /** Canonical URL path for the entity (e.g. `/task-collection/{id}`). */
        path: string;
        /** Asserts the entity page finished loading before we interact with it. */
        expectLoaded: (page: Page) => Promise<void>;
    }>;
    scenario: ShareSwitchInSiteScenario;
}): Promise<void> {
    const space = await TestSpace.create(context, {name: spaceName});
    const session = await space.createSession();

    const entity = await createEntity(session);

    const {
        siteAccess,
        initialIconLabel,
        optimisticIconLabel,
        modalTitle,
        modalDescription,
        finalIconLabel,
    } = getShareSwitchInSiteScenarioConfig({scenario, spaceName, entityNoun, session});

    const site = await TestSite.create(session, {
        name: "Test Site",
        access: siteAccess,
    });

    await site.addEntity(session, {
        entityId: entity.entityId,
        parentId: site.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    await services.signIn(browserContext, session);
    await page.goto(entity.path);

    await entity.expectLoaded(page);

    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", initialIconLabel);

    await page.getByRole("button", {name: "Toggle sharing"}).click();

    await expect(page.getByRole("heading", {name: modalTitle})).toBeVisible();
    await expect(page.getByText(modalDescription)).toBeVisible();
    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", optimisticIconLabel);

    await page.getByRole("button", {name: "Confirm"}).click();

    await expect(
        page.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", finalIconLabel);
}

function getShareSwitchInSiteScenarioConfig({
    scenario,
    spaceName,
    entityNoun,
    session,
}: {
    scenario: ShareSwitchInSiteScenario;
    spaceName: string;
    entityNoun: string;
    session: TestSpaceSession;
}): {
    siteAccess: "Public" | "Private" | LocalAccessPolicy;
    initialIconLabel: string;
    optimisticIconLabel: string;
    modalTitle: string;
    modalDescription: string;
    finalIconLabel: string;
} {
    const sharedWithSpaceIconLabel = `Icon indicating the ${entityNoun} is shared with everyone in ${spaceName}`;
    const sharedWithLinkIconLabel = `Icon indicating the ${entityNoun} is shared with anyone with the link`;
    const privateIconLabel = `Icon indicating the ${entityNoun} is private`;

    const makePrivateModalTitle = "Make the entire site private?";

    const sitePermissionsPrefix = `Permissions for this ${entityNoun} are managed at the site level.`;
    const makePrivateDescriptionPrefix = `${sitePermissionsPrefix} If you make this change,`;

    const urlGrantOnlySiteAccess: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: {level: "View"},
    };

    const defaultAndUrlGrantSiteAccess: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Manage", generation: 1},
        urlGrant: {level: "View"},
    };

    switch (scenario) {
        case "PrivateToPublic":
            return {
                siteAccess: "Private",
                initialIconLabel: privateIconLabel,
                optimisticIconLabel: sharedWithSpaceIconLabel,
                modalTitle: "Share the entire site?",
                modalDescription: `${sitePermissionsPrefix} Sharing this will give everyone in ${spaceName} access to the entire site, not just this ${entityNoun}.`,
                finalIconLabel: sharedWithSpaceIconLabel,
            };
        case "DefaultGrantToPrivate":
            return {
                siteAccess: "Public",
                initialIconLabel: sharedWithSpaceIconLabel,
                optimisticIconLabel: privateIconLabel,
                modalTitle: makePrivateModalTitle,
                modalDescription: `${makePrivateDescriptionPrefix} everyone in ${spaceName} won\u2019t be able to access the site anymore.`,
                finalIconLabel: privateIconLabel,
            };
        case "UrlGrantToPrivate":
            return {
                siteAccess: urlGrantOnlySiteAccess,
                initialIconLabel: sharedWithLinkIconLabel,
                optimisticIconLabel: privateIconLabel,
                modalTitle: makePrivateModalTitle,
                modalDescription: `${makePrivateDescriptionPrefix} anyone with the link won\u2019t be able to access the site anymore.`,
                finalIconLabel: privateIconLabel,
            };
        case "DefaultAndUrlGrantToPrivate":
            return {
                siteAccess: defaultAndUrlGrantSiteAccess,
                // The URL grant icon wins over the default grant icon when both are set.
                initialIconLabel: sharedWithLinkIconLabel,
                optimisticIconLabel: privateIconLabel,
                modalTitle: makePrivateModalTitle,
                // Because the site still has a URL grant, the description references the link
                // audience even though the action removes the default grant too.
                modalDescription: `${makePrivateDescriptionPrefix} anyone with the link won\u2019t be able to access the site anymore.`,
                finalIconLabel: privateIconLabel,
            };
    }
}
