import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {getAccountEmailAddressForTest} from "~/server/accounts/create_account_for_test.js";
import {getFeedAccountCandidateEntriesForTest} from "~/server/feed/feed_actions.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId, isId} from "~/shared/id/id.js";
import {AccountId, DocumentId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";

const {context, services} = createTestServices();

async function startSignUp(page: Page, emailAddress: string) {
    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(emailAddress);
    await page.getByRole("button", {name: "Sign up"}).click();
}

async function submitSignUpProfile(page: Page, name: string) {
    await page.getByPlaceholder("Anthony Mose").click();
    await page.getByPlaceholder("Anthony Mose").fill(name);
    await page.getByRole("button", {name: "Sign up"}).click();

    await expect(page.getByRole("button", {name: "Invite"})).toBeVisible();
}

async function openSkipInviteModal(page: Page) {
    await page.getByRole("link", {name: "Skip for now"}).click();
}

async function skipSignUpInvites(page: Page) {
    await openSkipInviteModal(page);
    await page.getByRole("button", {name: "Skip for now"}).click();
}

async function waitForOneTimePassword(index: number) {
    return waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBeGreaterThan(index);
        return services.getOneTimePasswords()[index]!;
    });
}

async function submitSignUpOneTimePassword({
    page,
    oneTimePasswordIndex,
}: {
    page: Page;
    oneTimePasswordIndex: number;
}) {
    const {oneTimePassword} = await waitForOneTimePassword(oneTimePasswordIndex);

    await expect(page.getByText("We sent a passcode to")).toBeVisible();
    await page.getByLabel("Passcode").click();
    await page.getByLabel("Passcode").fill(oneTimePassword);
}

async function signUpWithSkippedInvites({
    page,
    emailAddress,
    name,
    oneTimePasswordIndex,
}: {
    page: Page;
    emailAddress: string;
    name: string;
    oneTimePasswordIndex: number;
}) {
    await page.goto("/auth/sign-up");
    await startSignUp(page, emailAddress);
    await submitSignUpProfile(page, name);
    await skipSignUpInvites(page);
    await submitSignUpOneTimePassword({page, oneTimePasswordIndex});
}

function getCurrentSpaceId(page: Page): SpaceId {
    const match = /^\/s\/([^/]+)/.exec(new URL(page.url()).pathname);
    assert(match?.[1] && isId<SpaceId>(match[1]));
    return match[1];
}

function getCurrentDocumentId(page: Page): DocumentId {
    const match = /^\/s\/[^/]+\/documents\/([^/?]+)/.exec(new URL(page.url()).pathname);
    assert(match?.[1] && isId<DocumentId>(match[1]));
    return match[1];
}

function getCurrentTaskId(page: Page): TaskId {
    const match = /^\/s\/[^/]+\/tasks\/([^/?]+)/.exec(new URL(page.url()).pathname);
    assert(match?.[1] && isId<TaskId>(match[1]));
    return match[1];
}

async function getAccountIdByEmailAddressForTest(
    spaceId: SpaceId,
    emailAddress: string,
): Promise<AccountId> {
    const accountEmailAddressItem = await getAccountEmailAddressForTest(
        context.systemAction(spaceId),
        validateEmailAddress(emailAddress),
    );
    return accountEmailAddressItem.accountId;
}

async function waitForDocumentFeedAccountCandidateEntry({
    spaceId,
    accountId,
    documentId,
}: {
    spaceId: SpaceId;
    accountId: AccountId;
    documentId: DocumentId;
}) {
    await expect(async () => {
        const candidateEntries = await getFeedAccountCandidateEntriesForTest(
            context.systemAction(spaceId),
            {
                accountId,
                limit: 100,
            },
        );

        expect(
            candidateEntries.some(
                item =>
                    item.entry.type === "Document" &&
                    item.entry.documentId === documentId &&
                    item.entry.event === "Created",
            ),
        ).toEqual(true);
    }).toPass({timeout: 10000});
}

async function waitForProjectTaskFeedAccountCandidateEntry({
    spaceId,
    accountId,
    taskId,
}: {
    spaceId: SpaceId;
    accountId: AccountId;
    taskId: TaskId;
}) {
    await expect(async () => {
        const candidateEntries = await getFeedAccountCandidateEntriesForTest(
            context.systemAction(spaceId),
            {
                accountId,
                limit: 100,
            },
        );

        expect(
            candidateEntries.some(
                item =>
                    item.entry.type === "Task" &&
                    item.entry.taskId === taskId &&
                    item.entry.event === "UpdatedToProjectLayout",
            ),
        ).toEqual(true);
    }).toPass({timeout: 10000});
}

test("can sign up then create a document and see it in feed", async ({page}) => {
    const emailAddress = `test.${generateId()}@gmail.com`;
    const documentTitle = `Feed document ${generateId()}`;

    await signUpWithSkippedInvites({
        page,
        emailAddress,
        name: "Test Testerson",
        oneTimePasswordIndex: 0,
    });

    await expect(page.getByText("Welcome to Alpine")).toBeVisible();

    const spaceId = getCurrentSpaceId(page);
    const accountId = await getAccountIdByEmailAddressForTest(spaceId, emailAddress);

    const createMenu = page
        .getByTestId("PostListView")
        .getByRole("menubar", {name: "Create", exact: true});
    await createMenu.getByRole("menuitem", {name: /^Create document/i}).click();

    await expect(page).toHaveURL(new RegExp(`/s/${spaceId}/documents/[^?]+\\?create=`));
    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();

    const documentId = getCurrentDocumentId(page);

    const documentEditor = page.getByRole("textbox", {name: "Document"});
    await expect(documentEditor).toBeVisible();
    await documentEditor.pressSequentially(documentTitle);
    await page.keyboard.press("Enter");

    await waitForDocumentFeedAccountCandidateEntry({spaceId, accountId, documentId});

    await page.getByLabel("Home").click();
    await expect(page).toHaveURL(new RegExp(`/s/${spaceId}(\\?.*)?$`));
    await expect(
        page.getByTestId("FeedEntryView").getByText(documentTitle, {exact: true}),
    ).toBeVisible();
});

test("can sign up then create a project and see it in feed", async ({page}) => {
    const emailAddress = `test.${generateId()}@gmail.com`;
    const projectTitle = `Feed project ${generateId()}`;

    await signUpWithSkippedInvites({
        page,
        emailAddress,
        name: "Test Testerson",
        oneTimePasswordIndex: 0,
    });

    await expect(page.getByText("Welcome to Alpine")).toBeVisible();

    const spaceId = getCurrentSpaceId(page);
    const accountId = await getAccountIdByEmailAddressForTest(spaceId, emailAddress);

    const createMenu = page
        .getByTestId("PostListView")
        .getByRole("menubar", {name: "Create", exact: true});
    await createMenu.getByRole("menuitem", {name: /^Create project/i}).click();

    await expect(page).toHaveURL(new RegExp(`/s/${spaceId}/tasks/[^?]+\\?create=`));
    await expect(page.getByTestId("PeekStackOverlay")).toBeHidden();
    await expect(page.getByRole("button", {name: "Create task"})).toBeVisible();

    const taskId = getCurrentTaskId(page);
    const titleInput = page.getByPlaceholder("Untitled");
    await expect(titleInput).toBeFocused();
    await page.keyboard.type(projectTitle);
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/[?&]create/);

    await waitForProjectTaskFeedAccountCandidateEntry({spaceId, accountId, taskId});

    await page.getByLabel("Home").click();
    await expect(page).toHaveURL(new RegExp(`/s/${spaceId}(\\?.*)?$`));
    await expect(
        page.getByTestId("FeedEntryView").getByText(projectTitle, {exact: true}),
    ).toBeVisible();
});
