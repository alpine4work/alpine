import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {printSearchMentionEntityId} from "~/shared/search/search_entity_id.js";

const {context, services} = createTestServices();

// Regression test for the `SiteRegistry` -> `SearchEntityRegistry` friend wiring.
// Renaming a site over the realtime WebSocket should update any rendered site
// mentions in the same client without a search-index refresh or a navigation away.
test("site mention title updates when the site is renamed", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const initialName = "Lorem Ipsum";
    const renamedName = "Dolor Sit Amet";

    // The site holds a channel (required first entity) and the document we'll open, so
    // navigating to the document activates the site context — which is what gives
    // `SiteRegistry` realtime updates for the site.
    const site = await TestSite.create(session, {name: initialName, access: "Public"});
    const channel = await TestChannel.create(session, {access: "Public"});
    await site.addEntity(session, {
        entityId: `Channel:${channel.id}`,
        parentId: site.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    const siteMentionEntityId = printSearchMentionEntityId({type: "Site", siteId: site.id});

    await ProcessContextModule.waitForTestTasks();

    // Document mentions the site itself. Creating with a Site access policy from the
    // start puts the document inside the site, which makes the document route return
    // site loader data — that mounts `ActiveSiteDataProvider` and opens the site's
    // realtime WebSocket on page load.
    const siteAccessPolicy = {type: "Site", siteId: site.id} as const;
    const document = await TestDocument.create(session, {
        sitePosition: {
            siteId: site.id,
            parentId: site.initialRootContainerId,
            orderKey: initialOrderKey,
        },
        content: schema.node("doc", {accessPolicy: siteAccessPolicy}, [
            schema.node("title", {}, []),
            schema.node("paragraph", {}, [
                schema.text("Mention: "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: siteMentionEntityId,
                    }),
                }),
                schema.text("."),
            ]),
        ]),
    });

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await page.waitForFunction("dev.ready");

    await expect(page.getByRole("link", {name: initialName})).toBeVisible();

    // Rename the site server-side. `directlyUpdateItem` broadcasts a rynamo event via
    // `process.waitUntil` — flush it with `waitForTestTasks` so the active site's
    // realtime durable object actually pushes the update to the client before we start
    // asserting on the rendered mention.
    await site.updateName(session, renamedName);
    await ProcessContextModule.waitForTestTasks();

    // The registry pushes the realtime rename into the rendered mention via
    // `unstable_scheduleCallback(unstable_LowPriority, …)`. React's low-priority lane
    // has a ~10s expiration, so when nothing else is driving a render the update can
    // land after Playwright's default 5s assertion timeout. Wait past that deadline
    // for the mention to repaint instead of racing it.
    await expect(page.getByRole("link", {name: renamedName})).toBeVisible({timeout: 15_000});
    await expect(page.getByRole("link", {name: initialName})).toBeHidden();
});
