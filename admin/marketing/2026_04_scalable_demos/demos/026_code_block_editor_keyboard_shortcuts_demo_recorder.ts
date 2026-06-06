import type {Page} from "playwright";
import {createDemoCursor} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const schema = DocumentContentProsemirrorSchema;
const demoTypingDelayMs = 24;
const codeBlockClickPoint = {x: 141, y: 164};

runScalableDemoRecorder(async (context, _services, recorder) => {
    const space = await TestSpace.create(context, {name: "Alpine"});
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        content: [
            schema.nodes.title.create(),
            schema.nodes.codeBlock.create({language: "javascript"}, [
                schema.nodes.codeBlockLine.create(),
            ]),
        ],
    });

    await recorder.record({
        instructions: markdown`
This automated demo shows the Alpine code block editor keyboard shortcuts in a document.

The document opens untitled with only an empty JavaScript code block. The recorder makes one large
cursor movement into the block and types a small binary search function. Watch for:

- opening parentheses, brackets, and braces creating their matching close character
- selecting an expression and wrapping it with parentheses
- Enter inside the function body preserving code indentation while the JavaScript function is
  written
        `,
        session,
        path: `/doc/${document.id}`,
        viewport: {width: scalableDemoDefaultViewportWidth},
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
        actions: [
            async page => {
                await runCodeBlockEditorKeyboardShortcutsDemo(page);
            },
        ],
    });
});

async function runCodeBlockEditorKeyboardShortcutsDemo(page: Page) {
    await page.getByTestId("DocumentContentEditorMain").waitFor({state: "visible"});

    const cursor = await createDemoCursor(page, {scale: 1.5, watchCssCursor: true});
    await cursor.hide();
    await wait(500);

    await focusFirstCodeBlockLine(page, cursor);

    await cursor.hide();
    await wait(400);

    await typeBinarySearchFunction(page);
}

async function focusFirstCodeBlockLine(
    page: Page,
    cursor: Awaited<ReturnType<typeof createDemoCursor>>,
) {
    const codeBlockLine = page.locator(".content_codeBlockLineContent").first();
    await codeBlockLine.waitFor({state: "visible"});

    const viewport = page.viewportSize();
    await cursor.jumpTo((viewport?.width ?? 1200) - 72, (viewport?.height ?? 720) - 72);
    await cursor.show();
    await wait(150);
    await cursor.click(codeBlockClickPoint.x, codeBlockClickPoint.y, 1200);
    await cursor.setCursorType("text");
    await wait(300);
}

async function typeBinarySearchFunction(page: Page) {
    await typeDemoText(page, "function binarySearch");
    await typeAutoBalancedText(page, "(", "items, target", {pauseMs: 200});
    await typeDemoText(page, " ");
    await typeDemoText(page, "{", {pauseMs: 280});
    await pressDemoKey(page, "Enter", {pauseMs: 320});

    await typeCodeLine(page, "let low = 0");
    await typeCodeLine(page, "let high = items.length - 1");

    await typeDemoText(page, "while ");
    await typeAutoBalancedText(page, "(", "low <= high", {pauseMs: 200});
    await typeDemoText(page, " ");
    await typeDemoText(page, "{", {pauseMs: 280});
    await pressDemoKey(page, "Enter", {pauseMs: 320});

    await typeMidpointLine(page);
    await typeTargetMatchLine(page);
    await typeLowerHalfLine(page);
    await typeDemoText(page, "else high = mid - 1", {pauseMs: 260});

    await pressDemoKey(page, "ArrowDown", {pauseMs: 160});
    await pressDemoKey(page, "Enter", {pauseMs: 260});
    await typeDemoText(page, "return -1", {pauseMs: 700});
}

async function typeMidpointLine(page: Page) {
    await typeDemoText(page, "const mid = Math.floor");
    await typeDemoText(page, "(", {pauseMs: 200});
    await typeDemoText(page, "low + high");
    await selectPreviousCharacters(page, "low + high".length);
    await typeDemoText(page, "(", {pauseMs: 240});
    await pressDemoKey(page, "ArrowRight", {pauseMs: 120});
    await pressDemoKey(page, "ArrowRight", {pauseMs: 120});
    await typeDemoText(page, " / 2");
    await pressDemoKey(page, "ArrowRight", {pauseMs: 120});
    await pressDemoKey(page, "Enter", {pauseMs: 260});
}

async function typeTargetMatchLine(page: Page) {
    await typeDemoText(page, "if ");
    await typeDemoText(page, "(", {pauseMs: 180});
    await typeDemoText(page, "items");
    await typeAutoBalancedText(page, "[", "mid", {pauseMs: 180});
    await typeDemoText(page, " === target");
    await pressDemoKey(page, "ArrowRight", {pauseMs: 120});
    await typeCodeLine(page, " return mid");
}

async function typeLowerHalfLine(page: Page) {
    await typeDemoText(page, "if ");
    await typeDemoText(page, "(", {pauseMs: 180});
    await typeDemoText(page, "items");
    await typeAutoBalancedText(page, "[", "mid", {pauseMs: 180});
    await typeDemoText(page, " < target");
    await pressDemoKey(page, "ArrowRight", {pauseMs: 120});
    await typeCodeLine(page, " low = mid + 1");
}

async function typeCodeLine(page: Page, text: string, {pauseMs = 220}: {pauseMs?: number} = {}) {
    await typeDemoText(page, text, {pauseMs: 90});
    await pressDemoKey(page, "Enter", {pauseMs});
}

async function typeAutoBalancedText(
    page: Page,
    openingPunctuation: string,
    text: string,
    {delayMs = demoTypingDelayMs, pauseMs = 120}: {delayMs?: number; pauseMs?: number} = {},
) {
    await typeDemoText(page, openingPunctuation, {delayMs, pauseMs});
    await typeDemoText(page, text, {delayMs});
    await pressDemoKey(page, "ArrowRight", {pauseMs});
}

async function selectPreviousCharacters(page: Page, count: number) {
    await page.keyboard.down("Shift");
    for (let index = 0; index < count; index++) {
        await page.keyboard.press("ArrowLeft", {delay: 40});
    }
    await page.keyboard.up("Shift");
    await wait(180);
}

async function typeDemoText(
    page: Page,
    text: string,
    {delayMs = demoTypingDelayMs, pauseMs = 120}: {delayMs?: number; pauseMs?: number} = {},
) {
    await page.keyboard.type(text, {delay: delayMs});
    await wait(pauseMs);
}

async function pressDemoKey(page: Page, key: string, {pauseMs = 120}: {pauseMs?: number} = {}) {
    await page.keyboard.press(key, {delay: 60});
    await wait(pauseMs);
}
