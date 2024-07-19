import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {createDocument} from "~/server/documents/data/documents_table.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {emptyDocumentContent} from "~/shared/documents/document_content_schema.js";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";

const {context, services} = createTestServices();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

// Our test where we're doing a bunch of concurrent updates takes some time.
test.setTimeout(5 * 60 * 1000);

test("can write collaboratively in a document", async ({
    browser,
    context: browserContext1,
    page: page1,
    viewport,
}) => {
    assert(viewport);

    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const canPrimaryInputHover = await page1.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    await page1.getByRole("textbox", {name: "Document"}).focus();
    await page2.getByRole("textbox", {name: "Document"}).focus();

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText("");
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText("");

    if (canPrimaryInputHover) {
        await page1
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page1
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await page1.getByRole("textbox", {name: "Document"}).type("Test document content 1");

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1",
    );
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1",
    );

    if (canPrimaryInputHover) {
        await page2
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page2
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await page2.getByRole("textbox", {name: "Document"}).press("Enter");
    await page2.getByRole("textbox", {name: "Document"}).type("Test document content 2");

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2",
    );
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2",
    );

    if (canPrimaryInputHover) {
        await page1
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page1
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await page1.getByRole("textbox", {name: "Document"}).press("Enter");
    await page1.getByRole("textbox", {name: "Document"}).type("Test document content 3");

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2Test document content 3",
    );
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2Test document content 3",
    );

    if (canPrimaryInputHover) {
        await page2
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page2
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await page2.getByRole("textbox", {name: "Document"}).press("Enter");
    await page2.getByRole("textbox", {name: "Document"}).type("Test document content 4");

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2Test document content 3Test document content 4",
    );
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2Test document content 3Test document content 4",
    );

    await browserContext2.close();
});

test("can write collaboratively at the same time in a document", async ({
    browser,
    context: browserContext1,
    page: page1,
    viewport,
}) => {
    assert(viewport);

    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const canPrimaryInputHover = await page1.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    await page1.getByRole("textbox", {name: "Document"}).focus();
    await page2.getByRole("textbox", {name: "Document"}).focus();

    if (canPrimaryInputHover) {
        await page1
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
        await page2
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page1
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
        await page2
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await runAllPromiseThunks(
        async () => {
            const reload1 = randomInteger(0, 25);
            const reload2 = randomInteger(0, 25);

            for (let i = 0; i < 25; i++) {
                if (canPrimaryInputHover) {
                    await page1
                        .getByRole("textbox", {name: "Document"})
                        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
                } else {
                    await page1
                        .getByRole("textbox", {name: "Document"})
                        .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
                }

                await page1
                    .getByRole("textbox", {name: "Document"})
                    .type("123456123456123456", {delay: randomInteger(0, 10)});
                await page1.getByRole("textbox", {name: "Document"}).press("Enter");

                if (i === reload1 || i === reload2) await page1.reload();
            }
        },
        async () => {
            const reload1 = randomInteger(0, 25);
            const reload2 = randomInteger(0, 25);

            for (let i = 0; i < 25; i++) {
                if (canPrimaryInputHover) {
                    await page2
                        .getByRole("textbox", {name: "Document"})
                        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
                } else {
                    await page2
                        .getByRole("textbox", {name: "Document"})
                        .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
                }

                await page2
                    .getByRole("textbox", {name: "Document"})
                    .type("abcdefabcdefabcdef", {delay: randomInteger(0, 10)});
                await page2.getByRole("textbox", {name: "Document"}).press("Enter");

                if (i === reload1 || i === reload2) await page2.reload();
            }
        },
    );

    await page1.getByRole("textbox", {name: "Document"}).blur();
    await page2.getByRole("textbox", {name: "Document"}).blur();

    const page1TextContent =
        (await page1.getByRole("textbox", {name: "Document"}).textContent()) ?? "";
    const page2TextContent =
        (await page2.getByRole("textbox", {name: "Document"}).textContent()) ?? "";

    function countCharacters(string: string) {
        const characters = new Map<string, number>();

        for (const character of string) {
            // Ignore zero width space (https://graphemica.com/200B) inserted by
            // `<ContentEditor>`.
            if (character === "\u200B") continue;

            const count = getOrSetDefaultMapValue(characters, character, () => 0);
            characters.set(character, count + 1);
        }

        return Array.from(characters).sort(([character1], [character2]) =>
            defaultCompareStrings(character1, character2),
        );
    }

    expect(countCharacters(page1TextContent)).toEqual([
        ["1", 75],
        ["2", 75],
        ["3", 75],
        ["4", 75],
        ["5", 75],
        ["6", 75],
        ["a", 75],
        ["b", 75],
        ["c", 75],
        ["d", 75],
        ["e", 75],
        ["f", 75],
    ]);

    expect(countCharacters(page2TextContent)).toEqual([
        ["1", 75],
        ["2", 75],
        ["3", 75],
        ["4", 75],
        ["5", 75],
        ["6", 75],
        ["a", 75],
        ["b", 75],
        ["c", 75],
        ["d", 75],
        ["e", 75],
        ["f", 75],
    ]);

    await browserContext2.close();
});
