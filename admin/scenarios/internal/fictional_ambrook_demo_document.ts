import Mustache from "mustache";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {uploadScenarioFile} from "~/admin/scenarios/internal/upload_scenario_file.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookDemoDocument(
    tokenAgent: TokenAgent,
    {cassCade, elleKappaTan, masonClay}: DemoSpaceAccounts,
) {
    debug("Creating document");

    const [
        otherDocument,
        receiptMobileScannerDocument,
        profitByAcreDashboardDocument,
        grantsNavigatorDocument,
    ] = await runAllPromises([
        TestDocument.create(cassCade, {
            title: "Q1 Product Roadmap",
        }),
        TestDocument.create(cassCade, {
            title: "Receipt Uploader",

            // Abruptly cut to only the content shown in our preview so there's no artifacts at
            // the end of the preview hinting more text. Content we're cutting goes in an HTML
            // comment so we can use it later if needed.
            body: markdown`
# Problem

Our customers live in receipts: fuel, feed, parts, repairs, lodging. Today, end up in glove boxes
and shoeboxes, then get <!-- dumped on an accountant once or twice a year. That leads to missing
documents, manual data entry, and a constant lag between spending money and understanding where it
went. -->
            `,
        }),
        TestDocument.create(cassCade, {
            title: "PAD PRD",

            // Abruptly cut to only the content shown in our preview so there's no artifacts at
            // the end of the preview hinting more text. Content we're cutting goes in an HTML
            // comment so we can use it later if needed.
            body: markdown`
Profit by Acre is a dashboard in our app that brings together revenues and costs at the field level
to show true profitability per acre. It combines transaction data (sales, inputs, services),
production data <!-- (yields, planted acres), and simple allocations (e.g., equipment or labor by
field) into a visual view: maps, tables, and trends that make it obvious which acres are
underperforming and which management changes are working. -->
            `,
        }),
        TestDocument.create(cassCade, {
            title: "Grants Navigator",

            // Abruptly cut to only the content shown in our preview so there's no artifacts at
            // the end of the preview hinting more text. Content we're cutting goes in an HTML
            // comment so we can use it later if needed.
            body: markdown`
Goals:

- Help producers discover programs they qualify for
- Reduce time to go from \u201CI\u2019ve heard
            `,
        }),
    ]);

    await runAllPromises([
        otherDocument.access.grantDefault(cassCade),
        receiptMobileScannerDocument.access.grantDefault(cassCade),
        profitByAcreDashboardDocument.access.grantDefault(cassCade),
        grantsNavigatorDocument.access.grantDefault(cassCade),

        // Must call this for the content previews to actually render some content.
        receiptMobileScannerDocument.updateContentPreview(),
        profitByAcreDashboardDocument.updateContentPreview(),
        grantsNavigatorDocument.updateContentPreview(),
    ]);

    const document = await TestDocument.create(cassCade, {
        title: "Q2 Product Roadmap",

        // NOTE(calebmer): I think the blobs cover is making the screenshot too busy. It
        // also won't work with the gradient border design we'll be using. So I'm cutting
        // the cover. Here's the code if you want to add it back in the future:
        //
        // ```
        // cover: {
        //     type: "Blobs",
        //     // Also nice seeds:
        //     //
        //     // - `130a49bf-0f07-408d-962a-de30ad1dfa3f`
        //     // - `043df2cc-9171-48eb-ba04-b405da13597f`
        //     seed: "058a2b2a-61bf-4ff4-b3ee-31af5f5d6f11",
        //     themeColor: "purple",
        //     hueSpread: 25,
        // },
        // ```

        body: Mustache.render(
            markdown`
In our [Q1 Product Roadmap](https://alpine.inc/doc/{{otherDocumentId}}#mention) we focused on small
and medium sized businesses (SMBs). That _directly contributed_ to our 16% revenue growth last
quarter. We\u2019re going to add a couple features for larger businesses this quarter.

| Project                  | DRI                                                                    | Priority                                     | PRD                                         |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| Receipt Mobile Scanner   | [Mason Clay](https://alpine.inc/mention/{{masonClayAccountId}})        | <mark class="highlight-red">High</mark>      |                                             |
| Profit by Acre Dashboard | [Elle Kappa-Tan](https://alpine.inc/mention/{{elleKappaTanAccountId}}) | <mark class="highlight-red">High</mark>      |                                             |
| Grants Navigator         | [Cass Cade](https://alpine.inc/mention/{{cassCadeAccountId}})          | <mark class="highlight-orange">Medium</mark> | <span hidden data-column-widths="4,3,2,3"/> |

# Inspiration

Some photos of the farms we helped last quarter to get us hyped for Q2!
            `,
            {
                otherDocumentId: otherDocument.id,
                elleKappaTanAccountId: elleKappaTan.account.id,
                cassCadeAccountId: cassCade.account.id,
                masonClayAccountId: masonClay.account.id,
            },
        ),
    });

    await document.access.grantDefault(cassCade);

    debug("Created document");

    const [file1, file2, file3, file4, file5] = await runAllPromises([
        uploadScenarioFile(tokenAgent, cassCade, "fictional_ambrook_unsplash_inspiration_1.jpg", {
            type: "Document",
            documentId: document.id,
        }),
        uploadScenarioFile(tokenAgent, cassCade, "fictional_ambrook_unsplash_inspiration_2.jpg", {
            type: "Document",
            documentId: document.id,
        }),
        uploadScenarioFile(tokenAgent, cassCade, "fictional_ambrook_unsplash_inspiration_3.jpg", {
            type: "Document",
            documentId: document.id,
        }),
        uploadScenarioFile(tokenAgent, cassCade, "fictional_ambrook_unsplash_inspiration_4.jpg", {
            type: "Document",
            documentId: document.id,
        }),
        uploadScenarioFile(tokenAgent, cassCade, "fictional_ambrook_unsplash_inspiration_5.jpg", {
            type: "Document",
            documentId: document.id,
        }),
    ]);

    debug("Uploaded inspiration files");

    const content = await document.getContent();

    const title = assertExists(content.content.content[0]);
    assert(title.type.name === "title");

    const paragraph1 = assertExists(content.content.content[1]);
    assert(paragraph1.type.name === "paragraph");

    const table = assertExists(content.content.content[2]);
    assert(table.type.name === "table");

    const heading = assertExists(content.content.content[3]);
    assert(heading.type.name === "heading");

    const paragraph2 = assertExists(content.content.content[4]);
    assert(paragraph2.type.name === "paragraph");

    const tableRows = table.content.content;
    assert(tableRows.length === 4);

    const tableRow0 = assertExists(tableRows[0]);

    const tableRow1 = assertExists(tableRows[1]);
    const tableRow1PrdCell = assertExists(tableRow1.content.content[3]);

    const tableRow2 = assertExists(tableRows[2]);
    const tableRow2PrdCell = assertExists(tableRow2.content.content[3]);

    const tableRow3 = assertExists(tableRows[3]);
    const tableRow3PrdCell = assertExists(tableRow3.content.content[3]);

    const tablePos = title.nodeSize + paragraph1.nodeSize;

    const schema = DocumentContentProsemirrorSchema;

    // Unfortunately, our content Markdown parser doesn't support file entities yet so
    // we have to manually add them via steps.
    await document.update(cassCade, [
        new ReplaceStep(
            tablePos + table.nodeSize + heading.nodeSize + paragraph2.nodeSize,
            tablePos + table.nodeSize + heading.nodeSize + paragraph2.nodeSize,
            new Slice(
                Fragment.from([
                    schema.nodes.fileRow!.create(null, [
                        schema.nodes.file!.create({fileId: file1.id}),
                        schema.nodes.file!.create({fileId: file2.id}),
                    ]),
                    schema.nodes.fileRow!.create(null, [
                        schema.nodes.file!.create({fileId: file3.id}),
                        schema.nodes.file!.create({fileId: file4.id}),
                        schema.nodes.file!.create({fileId: file5.id}),
                    ]),
                ]),
                0,
                0,
            ),
        ),

        new ReplaceStep(
            tablePos +
                1 +
                tableRow0.nodeSize +
                tableRow1.nodeSize +
                tableRow2.nodeSize +
                tableRow3.nodeSize -
                1 -
                tableRow3PrdCell.nodeSize +
                1,
            tablePos +
                1 +
                tableRow0.nodeSize +
                tableRow1.nodeSize +
                tableRow2.nodeSize +
                tableRow3.nodeSize -
                1 -
                tableRow3PrdCell.nodeSize +
                3,
            new Slice(
                Fragment.from(
                    schema.nodes.fileRowTable!.create(null, [
                        schema.nodes.file!.create({
                            fileId: `Document:${grantsNavigatorDocument.id}`,
                        }),
                    ]),
                ),
                0,
                0,
            ),
        ),
        new ReplaceStep(
            tablePos +
                1 +
                tableRow0.nodeSize +
                tableRow1.nodeSize +
                tableRow2.nodeSize -
                1 -
                tableRow2PrdCell.nodeSize +
                1,
            tablePos +
                1 +
                tableRow0.nodeSize +
                tableRow1.nodeSize +
                tableRow2.nodeSize -
                1 -
                tableRow2PrdCell.nodeSize +
                3,
            new Slice(
                Fragment.from(
                    schema.nodes.fileRowTable!.create(null, [
                        schema.nodes.file!.create({
                            fileId: `Document:${profitByAcreDashboardDocument.id}`,
                        }),
                    ]),
                ),
                0,
                0,
            ),
        ),
        new ReplaceStep(
            tablePos +
                1 +
                tableRow0.nodeSize +
                tableRow1.nodeSize -
                1 -
                tableRow1PrdCell.nodeSize +
                1,
            tablePos +
                1 +
                tableRow0.nodeSize +
                tableRow1.nodeSize -
                1 -
                tableRow1PrdCell.nodeSize +
                3,
            new Slice(
                Fragment.from(
                    schema.nodes.fileRowTable!.create(null, [
                        schema.nodes.file!.create({
                            fileId: `Document:${receiptMobileScannerDocument.id}`,
                        }),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    debug("Attached inspiration files");

    return document;
}
