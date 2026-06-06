import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {getSearchEntityIndexesForTest} from "~/server/search/data/index/search_entity_index.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {escapeRegExp} from "~/shared/helpers/string/escape_reg_exp.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";

const {context, services} = createTestServices();
const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

function getToCombobox(page: Page) {
    return page.getByRole("combobox", {name: "To"});
}

function getSuggestions(page: Page) {
    return page.getByRole("listbox", {name: "Suggestions"});
}

function getPickerInput(page: Page) {
    return page.getByTestId("ChatAccountPickerInput");
}

function getDirectChatOptionNamePattern(name1: string, name2: string) {
    return new RegExp(
        `(${escapeRegExp(name1)}.*${escapeRegExp(name2)}|${escapeRegExp(name2)}.*${escapeRegExp(name1)})`,
    );
}

function getDirectChatOption(page: Page, name1: string, name2: string) {
    return getSuggestions(page)
        .getByRole("option")
        .filter({
            hasText: getDirectChatOptionNamePattern(name1, name2),
        });
}

async function openNewChat(page: Page, spaceId: SpaceId) {
    await page.goto(`/chat/new/${spaceId}`);
    await page.waitForFunction("dev.ready");
}

async function indexChatForKeywordSearch(spaceId: SpaceId, chatId: ChatId) {
    await context.jobs.sendAndWait({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Chat",
            chatId,
            updatedTraits: {type: "Any"},
        },
    });

    await expect(async () => {
        expect(
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                spaceId,
                `Chat:${chatId}`,
            ),
        ).not.toBeNull();
    }).toPass({timeout: 5000});

    await context.opensearch.refresh(SearchEntityKeywordIndex);
}

async function addHighIntentAffinity({
    session,
    entityId,
    count = 3,
}: {
    session: TestSpaceSession;
    entityId: `Account:${AccountId}` | `Chat:${ChatId}`;
    count?: number;
}) {
    for (let i = 0; i < count; i++) {
        await markSearchAffinityEntityInteraction(session.action(), {
            spaceId: session.space.id,
            entityId,
            interaction: {type: "HighIntentUpdate"},
            // This test fixture only ever passes `Account:` or `Chat:` ids and doesn't set up
            // sites, so no site cascade applies.
            siteId: null,
        });
    }
}

function sortedAccountsFromUrl(page: Page) {
    const searchParam = new URL(page.url()).searchParams.get("accounts");
    if (!searchParam) return "";
    return searchParam.split(" ").filter(Boolean).sort().join(" ");
}

async function getOptionIndex(page: Page, optionName: string) {
    const optionTexts = await getSuggestions(page).getByRole("option").allTextContents();
    return optionTexts.findIndex(optionText => optionText.includes(optionName));
}

test("initial list includes account plus affinity room and direct chat options", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionBeacon, sessionCipher, sessionDelta] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Beacon"}),
        space.createSession({name: "Cipher"}),
        space.createSession({name: "Delta"}),
    ]);

    const directChat = await TestChat.get(sessionActor, sessionBeacon, sessionCipher);
    const roomChat = await TestChat.createRoom(sessionActor, {name: "Affinity Room Alpha"});

    await directChat.sendMessage(sessionActor, "direct affinity seed");
    await roomChat.sendMessage(sessionActor, "room affinity seed");

    await runAllPromises([
        addHighIntentAffinity({session: sessionActor, entityId: `Chat:${directChat.id}`}),
        addHighIntentAffinity({session: sessionActor, entityId: `Chat:${roomChat.id}`}),
    ]);

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await expect(getSuggestions(page)).toBeVisible();
    await expect(
        page.getByRole("option", {name: sessionDelta.account.initialName, exact: true}),
    ).toBeVisible();
    await expect(page.getByRole("option", {name: "Affinity Room Alpha"})).toBeVisible();
    await expect(
        getDirectChatOption(
            page,
            sessionBeacon.account.initialName,
            sessionCipher.account.initialName,
        ).first(),
    ).toBeVisible();
});

test("selecting an account updates picker state and url accounts param", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionTarget] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Target"}),
    ]);

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await page.getByRole("option", {name: sessionTarget.account.initialName, exact: true}).click();

    await expect(getPickerInput(page).getByText(sessionTarget.account.initialName)).toBeVisible();
    await expect
        .poll(() => new URL(page.url()).searchParams.get("accounts"))
        .toBe(sessionTarget.account.id);
});

test("selecting an affinity direct chat chooses all non-self direct members", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionBeacon, sessionCipher] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Beacon"}),
        space.createSession({name: "Cipher"}),
    ]);

    const directChat = await TestChat.get(sessionActor, sessionBeacon, sessionCipher);
    await directChat.sendMessage(sessionActor, "group affinity seed");
    await addHighIntentAffinity({session: sessionActor, entityId: `Chat:${directChat.id}`});

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await getDirectChatOption(
        page,
        sessionBeacon.account.initialName,
        sessionCipher.account.initialName,
    )
        .first()
        .click();

    await expect(getPickerInput(page).getByText(sessionBeacon.account.initialName)).toBeVisible();
    await expect(getPickerInput(page).getByText(sessionCipher.account.initialName)).toBeVisible();
    await expect
        .poll(() => sortedAccountsFromUrl(page))
        .toBe([sessionBeacon.account.id, sessionCipher.account.id].sort().join(" "));
});

test("selecting an affinity room chat switches to room mode and chat param", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const sessionActor = await space.createSession({name: "Actor"});
    const roomChat = await TestChat.createRoom(sessionActor, {name: "Affinity Room Mode"});

    await roomChat.sendMessage(sessionActor, "room seed");
    await addHighIntentAffinity({session: sessionActor, entityId: `Chat:${roomChat.id}`});

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await page.getByRole("option", {name: "Affinity Room Mode"}).click();

    await expect(getPickerInput(page).getByText("Affinity Room Mode")).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("chat")).toBe(roomChat.id);
    await expect.poll(() => new URL(page.url()).searchParams.get("accounts")).toBeNull();
});

test("after selecting one account suggested chats include chats containing that account", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionBeacon, sessionCipher] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Beacon"}),
        space.createSession({name: "Cipher"}),
    ]);

    const directOneOnOne = await TestChat.get(sessionActor, sessionBeacon);
    const directGroup = await TestChat.get(sessionActor, sessionBeacon, sessionCipher);

    await directOneOnOne.sendMessage(sessionActor, "one-on-one seed");

    // We use session cipher here to exercise what happens when we don't have affinity
    // for the group chat.
    await directGroup.sendMessage(sessionCipher, "group seed");

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await expect(
        page.getByRole("option", {name: sessionBeacon.account.initialName, exact: true}),
    ).toBeVisible();

    await expect(
        getDirectChatOption(
            page,
            sessionBeacon.account.initialName,
            sessionCipher.account.initialName,
        ).first(),
    ).toBeHidden();

    await page.getByRole("option", {name: sessionBeacon.account.initialName, exact: true}).click();
    await expect(page.getByTestId("ChatAccountPickerContainer:Pending")).toBeHidden();

    await getToCombobox(page).click();

    await expect(
        getDirectChatOption(
            page,
            sessionBeacon.account.initialName,
            sessionCipher.account.initialName,
        ).first(),
    ).toBeVisible();
});

test("affinity direct chat option remains available after selecting an account", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionAnchor, sessionBeacon, sessionCipher] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Anchor"}),
        space.createSession({name: "Beacon"}),
        space.createSession({name: "Cipher"}),
    ]);

    const directChat = await TestChat.get(sessionActor, sessionBeacon, sessionCipher);
    await directChat.sendMessage(sessionActor, "selection seed");
    await addHighIntentAffinity({session: sessionActor, entityId: `Chat:${directChat.id}`});

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await page.getByRole("option", {name: sessionAnchor.account.initialName, exact: true}).click();
    await expect(getPickerInput(page).getByText(sessionAnchor.account.initialName)).toBeVisible();

    await getToCombobox(page).click();

    await expect(
        getDirectChatOption(
            page,
            sessionBeacon.account.initialName,
            sessionCipher.account.initialName,
        ).first(),
    ).toBeVisible();

    await expect.poll(() => sortedAccountsFromUrl(page)).toBe(sessionAnchor.account.id);
});

test("room search finds room by name even if it is not in affinity list", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionOther] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Other"}),
    ]);
    const roomChat = await TestChat.createRoom(sessionOther, {
        name: "Non Affinity Search Room",
        access: "Public",
    });

    await roomChat.sendMessage(sessionOther, "room search seed");
    await indexChatForKeywordSearch(space.id, roomChat.id);

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await expect(page.getByRole("option", {name: sessionOther.account.initialName})).toBeVisible();
    await expect(page.getByRole("option", {name: "Non Affinity Search Room"})).toBeHidden();

    await getToCombobox(page).fill("Non Affinity Search");

    await expect(page.getByRole("option", {name: "Non Affinity Search Room"})).toBeVisible();
    await expect(page.getByRole("option", {name: sessionOther.account.initialName})).toBeHidden();
});

test("room search finds room by name when room is in affinity list", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionOther] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Other"}),
    ]);
    const roomChat = await TestChat.createRoom(sessionActor, {name: "Affinity Search Room"});

    await roomChat.sendMessage(sessionActor, "room search seed");
    await addHighIntentAffinity({session: sessionActor, entityId: `Chat:${roomChat.id}`});

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await expect(page.getByRole("option", {name: "Affinity Search Room"})).toBeVisible();
    await expect(page.getByRole("option", {name: sessionOther.account.initialName})).toBeVisible();

    await getToCombobox(page).fill("Affinity Search");

    await expect(page.getByRole("option", {name: sessionOther.account.initialName})).toBeHidden();
    await expect(page.getByRole("option", {name: "Affinity Search Room"})).toBeVisible();
});

test("affinity room chat options are still available after selecting an account", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionContributor] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Contributor"}),
    ]);

    const roomChat = await TestChat.createRoom(sessionActor, {name: "Selected Account Room"});
    await roomChat.sendMessage(sessionActor, "room seed");
    await addHighIntentAffinity({session: sessionActor, entityId: `Chat:${roomChat.id}`});

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await page
        .getByRole("option", {name: sessionContributor.account.initialName, exact: true})
        .click();
    await expect(page.getByTestId("ChatAccountPickerContainer:Pending")).toBeHidden();
    await expect(page.getByRole("option", {name: "Selected Account Room"})).toBeHidden();
    await getToCombobox(page).click();

    await expect(page.getByRole("option", {name: "Selected Account Room"})).toBeVisible();
});

test("search ranking places strong account matches above weak room matches and strong rooms above weak account matches", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [sessionActor, sessionStrongAccount, sessionWeakAccount] = await runAllPromises([
        space.createSession({name: "Actor"}),
        space.createSession({name: "Focusmatch Account"}),
        space.createSession({name: "Orca Planer"}),
    ]);

    const weakRoom = await TestChat.createRoom(sessionActor, {name: "Focusmitch Room"});
    const strongRoom = await TestChat.createRoom(sessionActor, {name: "Orchestra Planner Room"});

    await weakRoom.sendMessage(sessionActor, "weak room seed");
    await strongRoom.sendMessage(sessionActor, "strong room seed");

    await runAllPromises([
        indexChatForKeywordSearch(space.id, weakRoom.id),
        indexChatForKeywordSearch(space.id, strongRoom.id),
    ]);

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await getToCombobox(page).fill("focusmatch account");

    await expect(
        page.getByRole("option", {name: sessionStrongAccount.account.initialName, exact: true}),
    ).toBeVisible();
    await expect(page.getByRole("option", {name: "Focusmitch Room"})).toBeVisible();
    await expect
        .poll(async () => {
            const strongAccountIndex = await getOptionIndex(
                page,
                sessionStrongAccount.account.initialName,
            );
            const weakRoomIndex = await getOptionIndex(page, "Focusmitch Room");
            if (strongAccountIndex < 0 || weakRoomIndex < 0) return -1;
            return weakRoomIndex - strongAccountIndex;
        })
        .toBeGreaterThan(0);

    await getToCombobox(page).fill("orchestra planner");

    await expect(page.getByRole("option", {name: "Orchestra Planner Room"})).toBeVisible();
    await expect(
        page.getByRole("option", {name: sessionWeakAccount.account.initialName, exact: true}),
    ).toBeVisible();
    await expect
        .poll(async () => {
            const strongRoomIndex = await getOptionIndex(page, "Orchestra Planner Room");
            const weakAccountIndex = await getOptionIndex(
                page,
                sessionWeakAccount.account.initialName,
            );
            if (strongRoomIndex < 0 || weakAccountIndex < 0) return -1;
            return weakAccountIndex - strongRoomIndex;
        })
        .toBeGreaterThan(0);
});

test("backspace at combobox start clears selected room chat", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const sessionActor = await space.createSession({name: "Actor"});
    const roomChat = await TestChat.createRoom(sessionActor, {name: "Backspace Clear Room"});

    await roomChat.sendMessage(sessionActor, "room seed");
    await addHighIntentAffinity({session: sessionActor, entityId: `Chat:${roomChat.id}`});

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await page.getByRole("option", {name: "Backspace Clear Room"}).click();
    await expect(getPickerInput(page).getByText("Backspace Clear Room")).toBeVisible();

    await getToCombobox(page).click();
    await page.keyboard.press("Backspace");

    await expect(getPickerInput(page).getByText("Backspace Clear Room")).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get("chat")).toBeNull();
});

test("typing is ignored while a room chat is selected", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const sessionActor = await space.createSession({name: "Actor"});
    const roomChat = await TestChat.createRoom(sessionActor, {name: "Locked Room"});

    await roomChat.sendMessage(sessionActor, "room seed");
    await addHighIntentAffinity({session: sessionActor, entityId: `Chat:${roomChat.id}`});

    await services.signIn(browserContext, sessionActor);
    await openNewChat(page, space.id);

    await page.getByRole("option", {name: "Locked Room"}).click();
    await expect(getPickerInput(page).getByText("Locked Room")).toBeVisible();

    await getToCombobox(page).fill("this should be ignored");

    await expect(getToCombobox(page)).toHaveValue("");
    await expect(getPickerInput(page).getByText("Locked Room")).toBeVisible();
    await expect(getSuggestions(page)).toBeHidden();
});

test("reload preserves chat param room selection", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const sessionActor = await space.createSession({name: "Actor"});
    const roomChat = await TestChat.createRoom(sessionActor, {name: "Reload Room"});

    await roomChat.sendMessage(sessionActor, "reload room message");

    await services.signIn(browserContext, sessionActor);
    await page.goto(`/chat/new/${space.id}?chat=${roomChat.id}`);
    await page.waitForFunction("dev.ready");

    await expect(getPickerInput(page).getByText("Reload Room")).toBeVisible();
    await expect(page.getByText("reload room message")).toBeVisible();

    await page.reload();

    await expect(getPickerInput(page).getByText("Reload Room")).toBeVisible();
    await expect(page.getByText("reload room message")).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("chat")).toBe(roomChat.id);
});
