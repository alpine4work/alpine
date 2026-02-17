import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PostContentProsemirrorSchema as schema} from "~/shared/forum/post_content_schema.js";

const {context, services} = createTestServices();

test("can reply to range in post", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession({name: "Alice"});
    const session2 = await space.createSession({name: "Bob"});

    const channel = await TestChannel.create(session2, {access: "Public"});

    const post = await channel.createPost(
        session2,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("abcdefghi")]),
            schema.node("paragraph", {}, [schema.text("jklmnopqr")]),
            schema.node("paragraph", {}, [schema.text("stuvwxyz")]),
        ]),
    );

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    await expect(page.getByText("Reply")).toBeHidden();

    await page.getByText("jklmnopqr").evaluate(element => {
        const selection = globalThis.window.getSelection()!;

        const range = globalThis.document.createRange();
        range.setStart(element.firstChild!, 2);
        range.setEnd(element.firstChild!, 8);

        selection.removeAllRanges();
        selection.addRange(range);
    });

    const messageTestIdRegExp = /^MessageView:[^:]+:0$/;

    await expect(page.getByText("Reply")).toBeVisible();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByLabel("New comment")).not.toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

    await page.getByText("Reply").click();

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("MessageInputParent")).toBeVisible();
    await expect(page.getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

    expect(await page.getByTestId("MessageInputParent").textContent()).toEqual("Bob: lmnopq");

    await page.getByLabel("New comment").fill("Works!");
    await page.getByLabel("New comment").press("Enter");

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

    expect(
        await page.getByTestId(messageTestIdRegExp).getByTestId("MessageViewParent").textContent(),
    ).toEqual("Bob: lmnopq");
});

test("can reply to range in post when post has marks", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession({name: "Alice"});
    const session2 = await space.createSession({name: "Bob"});

    const channel = await TestChannel.create(session2, {access: "Public"});

    const post = await channel.createPost(
        session2,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("abcdefghi")]),
            schema.node("paragraph", {}, [
                schema.text("jklm", [schema.mark("bold")]),
                schema.text("n"),
                schema.text("op", [schema.mark("strike")]),
                schema.text("qr"),
            ]),
            schema.node("paragraph", {}, [schema.text("stuvwxyz")]),
        ]),
    );

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    await expect(page.getByText("Reply")).toBeHidden();

    await page.getByText("jklmnopqr").evaluate(element => {
        const selection = globalThis.window.getSelection()!;

        const range = globalThis.document.createRange();
        range.setStart(element.firstChild!.firstChild!, 2);
        range.setEnd(element.childNodes[3]!, 1);

        selection.removeAllRanges();
        selection.addRange(range);
    });

    const messageTestIdRegExp = /^MessageView:[^:]+:0$/;

    await expect(page.getByText("Reply")).toBeVisible();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByLabel("New comment")).not.toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

    await page.getByText("Reply").click();

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("MessageInputParent")).toBeVisible();
    await expect(page.getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

    expect(await page.getByTestId("MessageInputParent").textContent()).toEqual("Bob: lmnopq");

    await page.getByLabel("New comment").fill("Works!");
    await page.getByLabel("New comment").press("Enter");

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

    expect(
        await page.getByTestId(messageTestIdRegExp).getByTestId("MessageViewParent").textContent(),
    ).toEqual("Bob: lmnopq");
});

test("can reply to range in post when range has multiple block nodes", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession({name: "Alice"});
    const session2 = await space.createSession({name: "Bob"});

    const channel = await TestChannel.create(session2, {access: "Public"});

    const post = await channel.createPost(
        session2,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("abcdefghi")]),
            schema.node("paragraph", {}, [schema.text("jklmno")]),
            schema.node("unorderedListItem", {}, [
                schema.node("paragraph", {}, [schema.text("pqr")]),
            ]),
            schema.node("paragraph", {}, [schema.text("stuvwxyz")]),
        ]),
    );

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    await expect(page.getByText("Reply")).toBeHidden();

    await page.getByText("jklmno").evaluate(element => {
        const selection = globalThis.window.getSelection()!;

        const range = globalThis.document.createRange();
        range.setStart(element.firstChild!, 2);
        range.setEnd(element.nextSibling!.firstChild!.firstChild!, 2);

        selection.removeAllRanges();
        selection.addRange(range);
    });

    const messageTestIdRegExp = /^MessageView:[^:]+:0$/;

    await expect(page.getByText("Reply")).toBeVisible();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByLabel("New comment")).not.toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

    await page.getByText("Reply").click();

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("MessageInputParent")).toBeVisible();
    await expect(page.getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

    expect(await page.getByTestId("MessageInputParent").textContent()).toEqual("Bob: lmno. pq");

    await page.getByLabel("New comment").fill("Works!");
    await page.getByLabel("New comment").press("Enter");

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

    expect(
        await page.getByTestId(messageTestIdRegExp).getByTestId("MessageViewParent").textContent(),
    ).toEqual("Bob: lmno. pq");
});

test("if content within replied post range changes then the reply is updated", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession({name: "Alice"});
    const session2 = await space.createSession({name: "Bob"});

    const channel = await TestChannel.create(session2, {access: "Public"});

    const post = await channel.createPost(
        session1,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("abcdefghi")]),
            schema.node("paragraph", {}, [schema.text("jklmnopqr")]),
            schema.node("paragraph", {}, [schema.text("stuvwxyz")]),
        ]),
    );

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/posts/${post.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    await expect(page.getByText("Reply")).toBeHidden();

    await page.getByText("jklmnopqr").evaluate(element => {
        const selection = globalThis.window.getSelection()!;

        const range = globalThis.document.createRange();
        range.setStart(element.firstChild!, 2);
        range.setEnd(element.firstChild!, 8);

        selection.removeAllRanges();
        selection.addRange(range);
    });

    const messageTestIdRegExp = /^MessageView:[^:]+:0$/;

    await expect(page.getByText("Reply")).toBeVisible();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByLabel("New comment")).not.toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

    await page.getByText("Reply").click();

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("MessageInputParent")).toBeVisible();
    await expect(page.getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeHidden();

    expect(await page.getByTestId("MessageInputParent").textContent()).toEqual("Alice: lmnopq");

    await page.getByLabel("New comment").fill("Works!");
    await page.getByLabel("New comment").press("Enter");

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId(messageTestIdRegExp)).toBeVisible();

    expect(
        await page.getByTestId(messageTestIdRegExp).getByTestId("MessageViewParent").textContent(),
    ).toEqual("Alice: lmnopq");

    await expect(
        page.getByTestId(messageTestIdRegExp).getByTestId("MessageViewParent").getByText("o"),
    ).toBeVisible();

    await page.getByLabel("More").click();
    await page.getByRole("menuitem", {name: "Edit"}).click();
    await expect(page.getByLabel("Post")).toBeVisible();
    await expect(page.getByLabel("Post")).toBeFocused();
    await page.getByLabel("Post").press("ArrowDown");
    await page.getByLabel("Post").press("ArrowRight");
    await page.getByLabel("Post").press("ArrowRight");
    await page.getByLabel("Post").press("ArrowRight");
    await page.getByLabel("Post").press("ArrowRight");
    await page.getByLabel("Post").pressSequentially("123");
    await page.getByLabel("Post").press("ArrowRight");
    await page.getByLabel("Post").press("ArrowRight");
    await page.getByLabel("Post").press("Backspace");
    await page.getByRole("button", {name: "Save"}).click();

    await expect(
        page.getByTestId(messageTestIdRegExp).getByTestId("MessageViewParent").getByText("o"),
    ).toBeHidden();

    expect(
        await page.getByTestId(messageTestIdRegExp).getByTestId("MessageViewParent").textContent(),
    ).toEqual("Alice: lm123npq");
});

test("can reply to range in post in channel peek", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);

    const session1 = await space.createSession({name: "Alice"});
    const session2 = await space.createSession({name: "Bob"});

    const channel = await TestChannel.create(session1, {
        access: "Public",
        name: "Test Channel",
    });

    await channel.createPost(
        session2,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("abcdefghi")]),
            schema.node("paragraph", {}, [schema.text("jklmnopqr")]),
            schema.node("paragraph", {}, [schema.text("stuvwxyz")]),
        ]),
    );

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}`);

    await page.getByText("Test Channel").first().click({button: "right"});
    await expect(page.getByTestId("PeekStack")).toBeHidden();
    await page.getByText("Open in peek").click();
    await expect(page.getByTestId("PeekStack")).toBeVisible();

    await (await page
        .getByTestId("PeekStack")
        .getByText("jklmnopqr")
        .elementHandle())!.waitForElementState("stable");

    await expect(page.getByText("Reply")).toBeHidden();

    await page
        .getByTestId("PeekStack")
        .getByText("jklmnopqr")
        .evaluate(element => {
            const selection = globalThis.window.getSelection()!;

            const range = globalThis.document.createRange();
            range.setStart(element.firstChild!, 2);
            range.setEnd(element.firstChild!, 8);

            selection.removeAllRanges();
            selection.addRange(range);
        });

    const messageTestIdRegExp = /^MessageView:[^:]+:0$/;

    await expect(page.getByText("Reply")).toBeVisible();
    await expect(page.getByTestId("PeekStack").getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByTestId("PeekStack").getByLabel("New comment")).toBeHidden();
    await expect(page.getByTestId("PeekStack").getByTestId(messageTestIdRegExp)).toBeHidden();

    await page.getByText("Reply").click();

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("PeekStack").getByTestId("MessageInputParent")).toBeVisible();
    await expect(page.getByTestId("PeekStack").getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId("PeekStack").getByTestId(messageTestIdRegExp)).toBeHidden();

    expect(
        await page.getByTestId("PeekStack").getByTestId("MessageInputParent").textContent(),
    ).toEqual("Bob: lmnopq");

    await page.getByTestId("PeekStack").getByLabel("New comment").fill("Works!");
    await page.getByTestId("PeekStack").getByLabel("New comment").press("Enter");

    await expect(page.getByText("Reply")).toBeHidden();
    await expect(page.getByTestId("PeekStack").getByTestId("MessageInputParent")).toBeHidden();
    await expect(page.getByTestId("PeekStack").getByLabel("New comment")).toBeFocused();
    await expect(page.getByTestId("PeekStack").getByTestId(messageTestIdRegExp)).toBeVisible();

    expect(
        await page
            .getByTestId("PeekStack")
            .getByTestId(messageTestIdRegExp)
            .getByTestId("MessageViewParent")
            .textContent(),
    ).toEqual("Bob: lmnopq");
});
