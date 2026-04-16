import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoDefaultViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await TestDocument.create(session, {
        title: "Meeting notes",
        body: markdown`
- Action item 1
- Action item 2
    - Todo 1
    - Todo 2
        - Todo a
        - Todo b
    - Todo 3
- Action item 3
- Action item 4
- Action item 5
        `,
    });

    await recorder.record({
        instructions: markdown`
The purpose of this demo is to show how easy it is to take a bullet list of tasks and bring it into
Alpine. You can take a bullet list from any text editor (e.g. Google Docs) and put it into Alpine.
We will use a peek of a document for this demonstration but in our copy should probably highlight
how the bullet list could come from anywhere.

1. Drag to expand the Chrome window so you don\u2019t see the corner radius.

2. Open search and open the document in a peek so you can easily copy the bullet list into the
   \u201CMy tasks\u201D view.

3. Start recording.

4. Select the bullet list in the document.

5. Right click and select the copy option.

6. Move mouse to \u201CMy tasks\u201D right click and select the paste option. Unfortunately, this
   doesn\u2019t work in Chrome for security reasons. A modal is opened saying you need to use the
   keyboard shortcut. We will edit this modal out when working on the Remotion video. Follow these
   substeps to make the editing work:
    1. Press enter or escape to close the modal without moving your mouse.

    2. Press cmd-v to actually paste the bullet list.

7. Move mouse around gently, close \u201CAction item 2\u201D\u2019s subtasks and then open them
   again.
        `,
        session,
        path: `/s/${space.id}/tasks`,
        viewport: {
            width: scalableDemoDefaultViewport.width,
            height: scalableDemoDefaultViewport.width / goldenRatio,
        },
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
