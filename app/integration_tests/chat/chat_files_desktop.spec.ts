import {Locator, Page, expect, test} from "@playwright/test";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const {context, services} = createTestServices();

async function getMessageInputDropPosition(pageOrLocator: Page | Locator) {
    const messageInputBox = assertExists(
        await (
            "addInitScript" in pageOrLocator
                ? // `addInitScript` should only be available on `Page`, not `Locator`.
                  pageOrLocator.getByTestId("MessageInputDropTarget")
                : pageOrLocator
        ).boundingBox(),
    );

    return {
        clientX: Math.round(messageInputBox.x + messageInputBox.width / 2),
        clientY: Math.round(messageInputBox.y + messageInputBox.height / 2),
    };
}

test("can drop files into chat", async ({context: browserContext, page}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);

    await chat.sendMessage(session2, "Test message 1");

    // Make sure the viewport size never changes since we'll need precise pixel
    // placement when dropping an image.
    await page.setViewportSize({width: 1280, height: 720});

    await services.signIn(browserContext, session1);
    await page.goto(`/chat/${chat.id}`);

    const file1Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    );

    const file1DataTransfer = await page.evaluateHandle(file1HexContents => {
        const file1Contents = new Uint8Array(Math.ceil(file1HexContents.length / 2));

        for (let i = 0; i < file1Contents.length; i++)
            file1Contents[i] = parseInt(file1HexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([file1Contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByLabel("Send message").click();

    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    const file2Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/py_pdf_sample_google_doc_document.pdf",
        ),
    );

    const file3Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/undraw_landscape_photographer.svg",
        ),
    );

    const file2AndFile3DataTransfer = await page.evaluateHandle(
        ([file2HexContents, file3HexContents]) => {
            const file2Contents = new Uint8Array(Math.ceil(file2HexContents!.length / 2));

            for (let i = 0; i < file2Contents.length; i++)
                file2Contents[i] = parseInt(file2HexContents!.slice(i * 2, i * 2 + 2), 16);

            const file3Contents = new Uint8Array(Math.ceil(file3HexContents!.length / 2));

            for (let i = 0; i < file3Contents.length; i++)
                file3Contents[i] = parseInt(file3HexContents!.slice(i * 2, i * 2 + 2), 16);

            const dataTransfer = new DataTransfer();
            const file2 = new File([file2Contents], "file.pdf", {type: "application/pdf"});
            const file3 = new File([file3Contents], "image.svg", {type: "image/svg+xml"});
            dataTransfer.items.add(file2);
            dataTransfer.items.add(file3);

            return dataTransfer;
        },
        [file2Contents.toString("hex"), file3Contents.toString("hex")],
    );

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file2AndFile3DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:application/pdf"),
    ).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/svg+xml"),
    ).toBeHidden();
    await expect(
        page
            .getByTestId(`MessageView:${chat.id}:2`)
            .getByTestId("ContentFilePreview:application/pdf"),
    ).toBeHidden();
    await expect(
        page
            .getByTestId(`MessageView:${chat.id}:2`)
            .getByTestId("ContentFilePreview:image/svg+xml"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file2AndFile3DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:application/pdf"),
    ).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/svg+xml"),
    ).toBeVisible();
    await expect(
        page
            .getByTestId(`MessageView:${chat.id}:2`)
            .getByTestId("ContentFilePreview:application/pdf"),
    ).toBeHidden();
    await expect(
        page
            .getByTestId(`MessageView:${chat.id}:2`)
            .getByTestId("ContentFilePreview:image/svg+xml"),
    ).toBeHidden();

    await page.getByRole("textbox", {name: "New message"}).fill("Test message 2");
    await page.getByLabel("Send message").click();

    await expect(
        page.getByTestId(`MessageView:${chat.id}:2`).getByText("Test message 2"),
    ).toBeVisible();
    await expect(
        page
            .getByTestId(`MessageView:${chat.id}:2`)
            .getByTestId("ContentFilePreview:application/pdf"),
    ).toBeVisible();
    await expect(
        page
            .getByTestId(`MessageView:${chat.id}:2`)
            .getByTestId("ContentFilePreview:image/svg+xml"),
    ).toBeVisible();

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:application/pdf"),
    ).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/svg+xml"),
    ).toBeHidden();
});

test("can remove files after dropping them into chat", async ({context: browserContext, page}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);

    await chat.sendMessage(session2, "Test message 1");

    // Make sure the viewport size never changes since we'll need precise pixel
    // placement when dropping an image.
    await page.setViewportSize({width: 1280, height: 720});

    await services.signIn(browserContext, session1);
    await page.goto(`/chat/${chat.id}`);

    const file1Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    );

    const file1DataTransfer = await page.evaluateHandle(file1HexContents => {
        const file1Contents = new Uint8Array(Math.ceil(file1HexContents.length / 2));

        for (let i = 0; i < file1Contents.length; i++)
            file1Contents[i] = parseInt(file1HexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([file1Contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();

    const file2Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/wikimedia_png_transparency_demonstration.png",
        ),
    );

    const file2DataTransfer = await page.evaluateHandle(file2HexContents => {
        const file2Contents = new Uint8Array(Math.ceil(file2HexContents.length / 2));

        for (let i = 0; i < file2Contents.length; i++)
            file2Contents[i] = parseInt(file2HexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([file2Contents], "image.png", {type: "image/png"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file2Contents.toString("hex"));

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file2DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file2DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page.getByTestId("MessageInput").getByLabel("Remove").first().click();

    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page.getByTestId("MessageInput").getByLabel("Send message").click();

    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page.getByTestId(`MessageView:${chat.id}:1`).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
});

test("can drop file into new chat then change account recipients", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    // Make sure the viewport size never changes since we'll need precise pixel
    // placement when dropping an image.
    await page.setViewportSize({width: 1280, height: 720});

    await services.signIn(browserContext, session1);
    await page.goto(`/chat/new/${space.id}`);

    const file1Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    );

    const file1DataTransfer = await page.evaluateHandle(file1HexContents => {
        const file1Contents = new Uint8Array(Math.ceil(file1HexContents.length / 2));

        for (let i = 0; i < file1Contents.length; i++)
            file1Contents[i] = parseInt(file1HexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([file1Contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();

    // NOTE(calebmer, 2025-06-02): For some reason Playwright can't find an
    // `alertdialog` role element while a menu is open? So we use
    // `page.getByLabel("JPEG image")` to test visibility instead of the preferred form
    // `page.getByRole("alertdialog", {name: "JPEG image"})`.
    //
    // This also seems to affect `page.getByRole("button", {name: "Send message"})`.
    await expect(page.getByLabel("JPEG image")).toBeHidden();
    await page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg").click();
    await expect(page.getByLabel("JPEG image")).toBeVisible();
    await page.getByLabel("JPEG image").getByLabel("Close").click();
    await expect(page.getByLabel("JPEG image")).toBeHidden();

    await expect(page.getByLabel("Send message")).toBeDisabled();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.getByRole("option", {name: session2.account.initialName}).click();

    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await expect(page.getByRole("alertdialog", {name: "JPEG image"})).toBeHidden();
    await page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg").click();
    await expect(page.getByRole("alertdialog", {name: "JPEG image"})).toBeVisible();
    await page.getByRole("alertdialog", {name: "JPEG image"}).getByLabel("Close").click();
    await expect(page.getByRole("alertdialog", {name: "JPEG image"})).toBeHidden();

    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByRole("button", {name: "Send message"}).click();

    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();

    const file2Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/wikimedia_png_transparency_demonstration.png",
        ),
    );

    const file2DataTransfer = await page.evaluateHandle(file2HexContents => {
        const file2Contents = new Uint8Array(Math.ceil(file2HexContents.length / 2));

        for (let i = 0; i < file2Contents.length; i++)
            file2Contents[i] = parseInt(file2HexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([file2Contents], "image.png", {type: "image/png"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file2Contents.toString("hex"));

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file2DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();

    await page.getByTestId("MessageInputDropTarget").dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page)),
        dataTransfer: file2DataTransfer,
    });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await expect(page.getByRole("alertdialog", {name: "PNG image"})).toBeHidden();
    await page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png").click();
    await expect(page.getByRole("alertdialog", {name: "PNG image"})).toBeVisible();
    await page.getByRole("alertdialog", {name: "PNG image"}).getByLabel("Close").click();
    await expect(page.getByRole("alertdialog", {name: "PNG image"})).toBeHidden();

    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await expect(
        page.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();

    await page.getByRole("combobox", {name: "To"}).click();
    await page.getByRole("option", {name: session3.account.initialName}).click();

    await expect(
        page.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    await expect(page.getByRole("alertdialog", {name: "PNG image"})).toBeHidden();
    await page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png").click();
    await expect(page.getByRole("alertdialog", {name: "PNG image"})).toBeVisible();
    await page.getByRole("alertdialog", {name: "PNG image"}).getByLabel("Close").click();
    await expect(page.getByRole("alertdialog", {name: "PNG image"})).toBeHidden();

    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByRole("button", {name: "Send message"}).click();

    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
});

test("can drag file we didn\u2019t upload from document into new chat", async ({
    browser,
    context: browserContext,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session2);
    await document.access.grantDefault(session2);

    // Make sure the viewport size never changes since we'll need precise pixel
    // placement when dropping an image.
    await page1.setViewportSize({width: 1280, height: 720});

    await services.signIn(browserContext, session1);
    await page1.goto(`/doc/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/doc/${document.id}`);

    const file1Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    );

    const file1DataTransfer = await page2.evaluateHandle(file1HexContents => {
        const file1Contents = new Uint8Array(Math.ceil(file1HexContents.length / 2));

        for (let i = 0; i < file1Contents.length; i++)
            file1Contents[i] = parseInt(file1HexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([file1Contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await expect(page2.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeHidden();

    await page2.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 640,
        clientY: 360,
        dataTransfer: file1DataTransfer,
    });

    await expect(page2.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeVisible();

    await page2.getByRole("textbox", {name: "Document"}).dispatchEvent("drop", {
        clientX: 640,
        clientY: 360,
        dataTransfer: file1DataTransfer,
    });

    await expect(page2.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeHidden();

    await expect(page1.getByTestId("ContentFilePreview:image/jpeg")).toBeVisible();

    await page1.getByLabel("Create").click();
    await page1
        .getByRole("menubar", {name: "Quick create"})
        .getByRole("menuitem", {
            name: "Chat",
        })
        .click();

    await expect(page1.getByTestId("MessagingView")).toBeVisible();

    // Wait 400ms for the peek to finish animating open (twice the animation duration
    // of 200ms). Normally waiting for a timeout like this is flaky. However, in this
    // case we know for certain the animation has started once
    // `page.getByLabel("MessagingView")` is visible. So the animation should complete
    // within 200ms of browser time.
    await page1.waitForTimeout(400);

    await expect(page1.getByTestId("ContentFilePreview:image/jpeg")).toBeVisible();

    await browserContext2.close();

    const file2DataTransfer = await page1.evaluateHandle(() => {
        return new DataTransfer();
    });

    await page1.getByTestId("ContentFilePreview:image/jpeg").dispatchEvent("dragstart", {
        clientX: 474,
        clientY: 296,
        dataTransfer: file2DataTransfer,
    });

    await expect(page1.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page1.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page1.getByTestId("MessageInputDropTarget").dispatchEvent("dragenter", {
        ...(await getMessageInputDropPosition(page1)),
        dataTransfer: file2DataTransfer,
    });

    await expect(page1.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page1.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page1.getByTestId("MessageInputDropTarget").dispatchEvent("drop", {
        ...(await getMessageInputDropPosition(page1)),
        dataTransfer: file2DataTransfer,
    });

    await expect(page1.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page1.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();

    // NOTE(calebmer, 2025-06-02): For some reason Playwright can't find an
    // `alertdialog` role element while a menu is open? So we use
    // `page.getByLabel("JPEG image")` to test visibility instead of the preferred form
    // `page.getByRole("alertdialog", {name: "JPEG image"})`.
    //
    // This also seems to affect `page.getByRole("button", {name: "Send message"})`.
    await expect(page1.getByLabel("JPEG image")).toBeHidden();
    await page1.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg").click();
    await expect(page1.getByLabel("JPEG image")).toBeVisible();
    await page1.getByLabel("JPEG image").getByLabel("Close").click();
    await expect(page1.getByLabel("JPEG image")).toBeHidden();

    await expect(page1.getByLabel("Send message")).toBeDisabled();

    await page1.getByRole("combobox", {name: "To"}).click();
    await page1.getByRole("option", {name: session3.account.initialName}).click();

    await expect(page1.getByRole("button", {name: "Send message"})).toBeEnabled();

    await expect(page1.getByRole("alertdialog", {name: "JPEG image"})).toBeHidden();
    await page1.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg").click();
    await expect(page1.getByRole("alertdialog", {name: "JPEG image"})).toBeVisible();
    await page1.getByRole("alertdialog", {name: "JPEG image"}).getByLabel("Close").click();
    await expect(page1.getByRole("alertdialog", {name: "JPEG image"})).toBeHidden();

    await expect(
        page1.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page1.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page1.getByRole("button", {name: "Send message"}).click();

    await expect(
        page1.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page1.getByTestId(/^MessageView:[^:]+:0$/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
});

test("can drag file from message input in new chat to another new chat", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    // Make sure the viewport size never changes since we'll need precise pixel
    // placement when dropping an image.
    await page.setViewportSize({width: 1280, height: 720});

    await services.signIn(browserContext, session1);
    await page.goto(`/chat/new/${space.id}`);

    await page.getByRole("combobox", {name: "To"}).click();
    await page.getByRole("option", {name: session2.account.initialName}).click();

    await page.getByLabel("Create").click();
    await page
        .getByRole("menubar", {name: "Quick create"})
        .getByRole("menuitem", {
            name: "Chat",
        })
        .click();

    await expect(page.getByTestId("PeekStack").getByTestId("MessagingView")).toBeVisible();
    await expect(page.getByTestId("MessagingView")).toHaveCount(2);

    await page.getByRole("option", {name: session3.account.initialName}).click();

    const file1Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    );

    const file1DataTransfer = await page.evaluateHandle(file1HexContents => {
        const file1Contents = new Uint8Array(Math.ceil(file1HexContents.length / 2));

        for (let i = 0; i < file1Contents.length; i++)
            file1Contents[i] = parseInt(file1HexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([file1Contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page
        .getByTestId("MessageInputDropTarget")
        .first()
        .dispatchEvent("dragenter", {
            ...(await getMessageInputDropPosition(
                page.getByTestId("MessageInputDropTarget").first(),
            )),
            dataTransfer: file1DataTransfer,
        });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page
        .getByTestId("MessageInputDropTarget")
        .first()
        .dispatchEvent("drop", {
            ...(await getMessageInputDropPosition(
                page.getByTestId("MessageInputDropTarget").first(),
            )),
            dataTransfer: file1DataTransfer,
        });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();

    const file2DataTransfer = await page.evaluateHandle(() => {
        return new DataTransfer();
    });

    await page
        .getByTestId("MessageInput")
        .getByTestId("ContentFilePreview:image/jpeg")
        .dispatchEvent("dragstart", {
            clientX: 390,
            clientY: 672,
            dataTransfer: file2DataTransfer,
        });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").first().getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").last().getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page
        .getByTestId("MessageInputDropTarget")
        .last()
        .dispatchEvent("dragenter", {
            ...(await getMessageInputDropPosition(
                page.getByTestId("MessageInputDropTarget").last(),
            )),
            dataTransfer: file2DataTransfer,
        });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").first().getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").last().getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page
        .getByTestId("MessageInputDropTarget")
        .last()
        .dispatchEvent("drop", {
            ...(await getMessageInputDropPosition(
                page.getByTestId("MessageInputDropTarget").last(),
            )),
            dataTransfer: file2DataTransfer,
        });

    await expect(page.getByTestId("MessageInput").getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").first().getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page.getByTestId("MessageInput").last().getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page
            .getByTestId("MessagingView")
            .last()
            .getByTestId(/^MessageView:[^:]+:0$/)
            .getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByTestId("MessageInput").last().getByLabel("Send message").click();

    await expect(
        page.getByTestId("MessageInput").last().getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").first().getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(
        page
            .getByTestId("MessagingView")
            .last()
            .getByTestId(/^MessageView:[^:]+:0$/)
            .getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
});
