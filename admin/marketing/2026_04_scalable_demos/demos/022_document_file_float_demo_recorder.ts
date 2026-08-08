import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {documentFileFloatDemoWidth} from "~/admin/marketing/2026_04_scalable_demos/demos/022_document_file_float_demo_shared.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {uploadDemoFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/upload_demo_file.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
// NOTE: The fixture images for this demo aren't checked in. Before running this
// demo, copy the relevant files to
// admin/marketing/2026_04_scalable_demos/fixtures.
runScalableDemoRecorder(async (context, services, recorder) => {
    const {accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const schema = DocumentContentProsemirrorSchema;

    // Document file float demo: three sections with cover images floated left beside
    // blurbs. June (TMM) and July (SICP) are pre-seeded with fileFloat nodes. August
    // (TPP) is filled in during the recording when Cass drags in the cover and floats
    // it.
    const document = await TestDocument.create(accounts.cassCade, {
        title: "📚Alpine Engineering Book Club",
        access: "Public",
        body: markdown`
## June 2026

**The Mythical Man Month**<br/>_Fred Brooks, 1975_<br/><br/>Still relevant! Why adding people to a
late software project makes it later. Brooks draws on his experience leading the OS/360 project at
IBM to examine how communication overhead, ramp-up time, and optimistic scheduling combine to defeat
the intuition that bigger teams move faster.<br/><br/>Discussion: how does Brook\u2019s Law apply to
our next hire? What is the \u201Csecond-system effect\u201D and where does it show up in our work?
<br/><br/>

---

## July 2026

**Structure and Interpretation of Computer Programs**<br/>_Harold Abelson & Gerald Jay Sussman,
1996_<br/><br/>The MIT textbook that changed how people think about computation. SICP uses Scheme to
build from first principles \u2014 procedures, closures, environments, streams, and a meta-circular
evaluator \u2014 teaching that programming is fundamentally about controlling complexity.<br/><br/>
Discussion: recursion vs iteration as a default mental model; how has learning a Lisp-family
language changed the way you write TypeScript? <br/><br/>

---

## August 2026

**The Pragmatic Programmer**<br/>_David Thomas & Andrew Hunt, 2nd edition, 2019_<br/><br/>Still the
clearest guide to the craft of building software. Don\u2019t repeat yourself. Invest in your
knowledge portfolio. Build code that\u2019s easy to delete. Know when to stop.<br/><br/>Discussion:
where in our codebase are we ignoring broken windows? The tracer bullet approach vs upfront design
\u2014 where has each worked for us?
        `,
    });

    const [tmmFile, sicpFile] = await runAllPromises([
        uploadDemoFile(
            services.getAppServiceTokenAgent(),
            accounts.cassCade,
            "tmm_book_cover.jpg",
            {type: "Document", documentId: document.id},
        ),
        uploadDemoFile(
            services.getAppServiceTokenAgent(),
            accounts.cassCade,
            "sicp_book_cover.jpg",
            {type: "Document", documentId: document.id},
        ),
    ]);

    // Insert fileFloat (direction: left) for The Mythical Man Month after the June
    // heading.
    {
        const content = await document.getContent();
        const children = content.content.content;
        const title = assertExists(children[0]);
        const headingJun = assertExists(children[1]);
        const insertPos = title.nodeSize + headingJun.nodeSize;

        await document.update(accounts.cassCade, [
            new ReplaceStep(
                insertPos,
                insertPos,
                new Slice(
                    Fragment.from(
                        schema.nodes.fileFloat.create({direction: "left"}, [
                            schema.nodes.file!.create({fileId: tmmFile.id}),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ]);
    }

    // Insert fileFloat (direction: left) for SICP after the July heading. Re-fetch
    // content since the previous step shifted positions.
    {
        const content = await document.getContent();
        const children = content.content.content;

        let pos = 0;
        let julyInsertPos: number | null = null;
        for (const child of children) {
            pos += child.nodeSize;
            if (child.type.name === "heading" && child.textContent.includes("July")) {
                julyInsertPos = pos;
                break;
            }
        }
        if (julyInsertPos === null) throw new NotFoundError("July heading not found");

        await document.update(accounts.cassCade, [
            new ReplaceStep(
                julyInsertPos,
                julyInsertPos,
                new Slice(
                    Fragment.from(
                        schema.nodes.fileFloat.create({direction: "left"}, [
                            schema.nodes.file!.create({fileId: sicpFile.id}),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ]);
    }

    await document.updateContentPreview();

    await recorder.record({
        instructions: markdown`
# Demo: floating images in documents

Alpine lets you float images left or right so text wraps naturally around them — great for reading
guides, wikis, design specs, or any document that mixes images with prose.

The Engineering Book Club document has three monthly sections. June (The Mythical Man Month) and
July (Structure and Interpretation of Computer Programs) already have their cover images floated to
the left. August (The Pragmatic Programmer) is waiting for its cover.

1. Start recording at the top of the document. Scroll slowly past the June and July sections so the
   viewer can see the TMM and SICP covers floating beside the blurb text.

2. Stop scrolling at the August section for The Pragmatic Programmer.

3. Open Finder and navigate to admin/marketing/2026_04_scalable_demos/fixtures. Arrange the Finder
   window so you can drag from it into the browser.

4. Drag \u201Ctpp_book_cover.jpg\u201D from Finder into the document editor, dropping it above the
   TPP blurb paragraph. The image appears as a centered block.

5. Click the image to select it. In the file toolbar that appears, click the float-left button. The
   image snaps to the left and the text reflows around it. Pause to let the viewer see the finished
   layout.
        `,
        session: accounts.cassCade,
        path: `/doc/${document.id}`,
        viewport: {width: documentFileFloatDemoWidth},
    });
});
