import {expect, test} from "@playwright/test";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";

const {context, services} = createTestServices();

test("print document route renders image and file entities and prints once", async ({
    context: browserContext,
    page,
}) => {
    await page.addInitScript(() => {
        const windowForTest = window as {
            printCallCountForTest?: number;
            postedMessagesForTest?: Array<string>;
        };
        windowForTest.printCallCountForTest = 0;
        windowForTest.postedMessagesForTest = [];

        window.addEventListener("message", event => {
            windowForTest.postedMessagesForTest?.push(String(event.data));
        });

        window.print = () => {
            windowForTest.printCallCountForTest = (windowForTest.printCallCountForTest ?? 0) + 1;
            window.dispatchEvent(new Event("afterprint"));
        };
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "foobar",
    });
    const fileEntityDocument = await TestDocument.create(session, {
        title: "Print File Entity Document",
    });

    await document.update(session, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Document:${fileEntityDocument.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session);
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto(`/doc/${document.id}`);

    const imageContents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/wikimedia_png_transparency_demonstration.png",
        ),
    );
    const imageFileDataTransfer = await page.evaluateHandle(imageHexContents => {
        const imageContents = new Uint8Array(Math.ceil(imageHexContents.length / 2));

        for (let i = 0; i < imageContents.length; i++)
            imageContents[i] = parseInt(imageHexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([imageContents], "image.png", {type: "image/png"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, imageContents.toString("hex"));

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 738,
        clientY: 257,
        dataTransfer: imageFileDataTransfer,
    });
    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("drop", {
        clientX: 738,
        clientY: 257,
        dataTransfer: imageFileDataTransfer,
    });
    await expect(page.getByTestId("ContentFilePreview:image/png")).toBeVisible();

    await page.goto(`/print/document/${document.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("Print File Entity Document")).toBeVisible();
    await expect(page.getByTestId("ContentFilePreview:image/png")).toBeVisible();

    await expect.poll(() => page.evaluate("window.printCallCountForTest")).toBe(1);

    await expect
        .poll(() => page.evaluate("window.postedMessagesForTest"))
        .toEqual(["cyberworlds/printed"]);
});
