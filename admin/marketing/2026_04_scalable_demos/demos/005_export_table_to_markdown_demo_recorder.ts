import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoNarrowViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const space = await TestSpace.create(context, {name: "Alpine"});
    const session = await space.createSession();
    const document = await TestDocument.create(session, {
        title: "Pricing plans",
        body: markdown`
|         | Free         | Team          | Pro           |
| ------- | ------------ | ------------- | ------------- |
| Price   | $5 per month | $10 per month | $20 per month |
| Storage | 1GB          | 20GB          | 100GB         |
| History | 2-week       | 1-year        | 2-year        |
        `,
    });

    await recorder.record({
        instructions: markdown`
1. Drag to grow window size so corners don\u2019t show up.

2. Move mouse slowly from bottom to more menu conveniently showing off add row bumper and column
   resize handles.

3. Select \u201CExport -> Markdown\u201D and show the exported Markdown content.

4. Select \u201CExport -> HTML\u201D and show the exported HTML content.
        `,
        session,
        path: `/s/${space.id}/documents/${document.id}`,
        viewport: {width: scalableDemoNarrowViewportWidth},
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
