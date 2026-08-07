import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const channel = await TestChannel.create(accounts.cassCade, {name: "Random"});

    await recorder.record({
        instructions: markdown`
1. Get five photos from an Alpine offsite.

2. Resize the photos so they have a width of 592px (so there\u2019s less processing our backend has
   to do).

3. Drag the window width so there\u2019s extra horizontal/vertical space to work with.

4. Start recording.

5. Drop the resized images in the post creator.

6. Drag an image from the row of three to the row of two. And maybe drag another one back from the
   row of three to the row of two.
        `,
        session: accounts.cassCade,
        viewport: {
            width: scalableDemoDefaultViewportWidth,
            height: scalableDemoDefaultViewportWidth,
        },
        path: `/post/new/${generateChronologicalId()}/${space.id}?channel=${channel.id}`,
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");

            await page
                .getByLabel("New post")
                .pressSequentially("Photos from last week\u2019s offsite:");
        },
    });
});
