import {expect, test} from "@playwright/test";
import {createTestServer} from "~/app/integration_tests/helpers/create_test_server";
import {createDocument} from "~/server/dynamo/documents_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {emptyDocumentContent} from "~/shared/content/document_content_schema";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {randomInteger} from "~/shared/helpers/number/random_integer";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {generateId} from "~/shared/id/id";
import {DocumentId} from "~/shared/id/types/id_types";

const context = createTestContext();
const server = createTestServer(context);
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

    const documentId = generateId<DocumentId>();

    await createDocument(context.request(session1), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await server.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/documents/${documentId}`);

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${documentId}`);

    await page1.getByRole("textbox", {name: "Document"}).focus();
    await page2.getByRole("textbox", {name: "Document"}).focus();

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText("");
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText("");

    await page1
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    await page1.getByRole("textbox", {name: "Document"}).type("Test document content 1");

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1",
    );
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1",
    );

    await page2
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    await page2.getByRole("textbox", {name: "Document"}).press("Enter");
    await page2.getByRole("textbox", {name: "Document"}).type("Test document content 2");

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2",
    );
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2",
    );

    await page1
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    await page1.getByRole("textbox", {name: "Document"}).press("Enter");
    await page1.getByRole("textbox", {name: "Document"}).type("Test document content 3");

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2Test document content 3",
    );
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2Test document content 3",
    );

    await page2
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    await page2.getByRole("textbox", {name: "Document"}).press("Enter");
    await page2.getByRole("textbox", {name: "Document"}).type("Test document content 4");

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2Test document content 3Test document content 4",
    );
    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        "Test document content 1Test document content 2Test document content 3Test document content 4",
    );
});

test("can write collaboratively at the same time in a document", async ({
    browser,
    context: browserContext1,
    page: page1,
    viewport,
}) => {
    assert(viewport);

    const documentId = generateId<DocumentId>();

    await createDocument(context.request(session1), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await server.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/documents/${documentId}`);

    const browserContext2 = await browser.newContext();
    await server.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${documentId}`);

    await page1.getByRole("textbox", {name: "Document"}).focus();
    await page2.getByRole("textbox", {name: "Document"}).focus();

    await page1
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    await page2
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

    await runAllPromiseThunks(
        async () => {
            const reload1 = randomInteger(0, 100);
            const reload2 = randomInteger(0, 100);

            for (let i = 0; i < 100; i++) {
                await page1
                    .getByRole("textbox", {name: "Document"})
                    .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
                await page1
                    .getByRole("textbox", {name: "Document"})
                    .type("123456123456123456", {delay: randomInteger(0, 10)});
                await page1.getByRole("textbox", {name: "Document"}).press("Enter");

                if (i === reload1 || i === reload2) await page1.reload();
            }
        },
        async () => {
            const reload1 = randomInteger(0, 100);
            const reload2 = randomInteger(0, 100);

            for (let i = 0; i < 100; i++) {
                await page2
                    .getByRole("textbox", {name: "Document"})
                    .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
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
            const count = getOrSetDefaultMapValue(characters, character, () => 0);
            characters.set(character, count + 1);
        }

        return Array.from(characters).sort(([character1], [character2]) =>
            defaultCompareStrings(character1, character2),
        );
    }

    expect(countCharacters(page1TextContent)).toEqual([
        ["1", 300],
        ["2", 300],
        ["3", 300],
        ["4", 300],
        ["5", 300],
        ["6", 300],
        ["a", 300],
        ["b", 300],
        ["c", 300],
        ["d", 300],
        ["e", 300],
        ["f", 300],
    ]);

    expect(countCharacters(page2TextContent)).toEqual([
        ["1", 300],
        ["2", 300],
        ["3", 300],
        ["4", 300],
        ["5", 300],
        ["6", 300],
        ["a", 300],
        ["b", 300],
        ["c", 300],
        ["d", 300],
        ["e", 300],
        ["f", 300],
    ]);
});
