import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {videoGalleriesSideBySideDemoWidth} from "~/admin/marketing/2026_04_scalable_demos/demos/030_video_galleries_side_by_side_demo_shared.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {uploadDemoFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/upload_demo_file.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const document = await TestDocument.create(accounts.masonClay, {
        title: "Space Delight Features",
        access: "Public",
        body: markdown`
# Space theme color switcher

The feature is implemented. We are just comparing which dropdown treatment feels best when someone
switches the theme color for a space.

- The left option keeps the list text-only with a colored font.
- The right option keeps consistent text color with a colored circle.
        `,
    });

    const under50RoomVideo = await uploadDemoFile(
        services.getAppServiceTokenAgent(),
        accounts.masonClay,
        "030_video_galleries_side_by_side_demo_1.mov",
        {type: "Document", documentId: document.id},
    );

    const schema = DocumentContentProsemirrorSchema;

    await document.update(accounts.masonClay, lastUpdatePos => [
        new ReplaceStep(
            lastUpdatePos + 1,
            lastUpdatePos + 1,
            new Slice(
                Fragment.from([
                    schema.nodes.fileRow!.create(null, [
                        schema.nodes.file!.create({fileId: under50RoomVideo.id}),
                    ]),
                ]),
                0,
                0,
            ),
        ),
    ]);

    await document.updateContentPreview();

    await recorder.record({
        instructions: markdown`
# Demo: compare space theme color switcher dropdown options

This document is Mason\u2019s quick comparison doc for the space theme color switcher. The feature
already works. The point of the demo is to show two dropdown variants side by side so the team can
react to which one looks better.

Use the two fixture videos in \`admin/marketing/2026_04_scalable_demos/fixtures/\`:

- \`030_video_galleries_side_by_side_demo_1.mov\`
- \`030_video_galleries_side_by_side_demo_2.mov\`

The first clip is already embedded in the document when the recorder opens. The recording shows
dragging in the second clip so both dropdown options can sit side by side in one row for feedback.

1. Start recording at the top of the document. Let the status update and the first video sit on
   screen for a beat.

2. Open Finder to \`admin/marketing/2026_04_scalable_demos/fixtures/\`.

3. Drag \`030_video_galleries_side_by_side_demo_2.mov\` into the document. Hover on the right side
   of the existing video until Alpine shows the side-by-side drop target, then drop it so both
   videos share the same row.

4. Pause on the finished two-video layout for a beat, then stop recording.
        `,
        session: accounts.masonClay,
        path: `/doc/${document.id}`,
        viewport: {width: videoGalleriesSideBySideDemoWidth},
        prepare: async page => {
            await page.getByTestId("DocumentContentEditorMain").waitFor({state: "visible"});
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
