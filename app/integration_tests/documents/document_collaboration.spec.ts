import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";

const {context, services} = createTestServices();

// The tests in this file are large and may take a while as we feature multiple
// browsers collaboratively editing the same content.
test.setTimeout(2 * 60 * 1000);

test("can write collaboratively in a document", async ({
    browser,
    context: browserContext1,
    page: page1,
    viewport,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grantDefault(session1);

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

    await page1
        .getByRole("textbox", {name: "Document"})
        .pressSequentially("Test document content 1");

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
    await page2
        .getByRole("textbox", {name: "Document"})
        .pressSequentially("Test document content 2");

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
    await page1
        .getByRole("textbox", {name: "Document"})
        .pressSequentially("Test document content 3");

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
    await page2
        .getByRole("textbox", {name: "Document"})
        .pressSequentially("Test document content 4");

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

    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}`);
    await page1.evaluate(() => {
        // This test is doing a lot already and can time out our typing
        // Disable spell check for this window to reduce load
        localStorage.setItem("disableSpellCheck", "true");
    });

    const document = await TestDocument.create(session1);
    await document.access.grantDefault(session1);

    const canPrimaryInputHover = await page1.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}`);
    await page2.evaluate(() => {
        // This test is doing a lot already and can time out our typing
        // Disable spell check for this window to reduce load
        localStorage.setItem("disableSpellCheck", "true");
    });

    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    await page1.getByRole("textbox", {name: "Document"}).focus();
    await page2.getByRole("textbox", {name: "Document"}).focus();

    if (!canPrimaryInputHover) {
        await page1
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
        await page2
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    const count = 12;

    const reload1 = randomInteger(0, count);
    const reload2 = randomInteger(0, count);

    for (let index = 0; index < count; index++) {
        await runAllPromiseThunks(
            async () => {
                await page1.evaluate("dev.contentEditor.setTextSelection(275)");

                const delay = randomInteger(0, 50);

                await wait(delay);

                await page1
                    .getByRole("textbox", {name: "Document"})
                    .pressSequentially("123456123456123456", {delay});

                await page1.getByRole("textbox", {name: "Document"}).press("Enter");

                if (index === reload1) {
                    await page1.reload();
                    await page1.getByRole("textbox", {name: "Document"}).focus();

                    if (!canPrimaryInputHover) {
                        await page1
                            .getByRole("textbox", {name: "Document"})
                            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
                    }
                }
            },
            async () => {
                await page2.evaluate("dev.contentEditor.setTextSelection(275)");

                const delay = randomInteger(0, 50);

                await wait(delay);

                await page2
                    .getByRole("textbox", {name: "Document"})
                    .pressSequentially("abcdefabcdefabcdef", {delay});

                await page2.getByRole("textbox", {name: "Document"}).press("Enter");

                if (index === reload2) {
                    await page2.reload();
                    await page2.getByRole("textbox", {name: "Document"}).focus();

                    if (!canPrimaryInputHover) {
                        await page2
                            .getByRole("textbox", {name: "Document"})
                            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
                    }
                }
            },
        );
    }

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
        ["1", count * 3],
        ["2", count * 3],
        ["3", count * 3],
        ["4", count * 3],
        ["5", count * 3],
        ["6", count * 3],
        ["a", count * 3],
        ["b", count * 3],
        ["c", count * 3],
        ["d", count * 3],
        ["e", count * 3],
        ["f", count * 3],
    ]);

    expect(countCharacters(page2TextContent)).toEqual([
        ["1", count * 3],
        ["2", count * 3],
        ["3", count * 3],
        ["4", count * 3],
        ["5", count * 3],
        ["6", count * 3],
        ["a", count * 3],
        ["b", count * 3],
        ["c", count * 3],
        ["d", count * 3],
        ["e", count * 3],
        ["f", count * 3],
    ]);

    await browserContext2.close();
});
