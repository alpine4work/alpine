import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const space = await TestSpace.create(context, {name: "Alpine"});
    const session = await space.createSession();
    const document = await TestDocument.create(session, {
        title: "Brainstorm",
        body: markdown`
- Good idea
- Bad idea
- Great idea
        `,
    });

    await recorder.record({
        instructions: markdown`
1. Drag the window size so it\u2019s taller/wider. This won\u2019t change the viewport size but it
   will make sure we don\u2019t deal with the window border radius while editing.

2. Take a screen recording (of your entire computer screen) where you move your mouse to press the
   share switch and then move it back. Don\u2019t stop your recording until after the \u201CShared
   with everyone in Alpine\u201D message disappears.
        `,
        session,
        path: `/s/${space.id}/documents/${document.id}`,
        viewport: {width: scalableDemoDefaultViewportWidth},
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
