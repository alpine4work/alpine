import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {seedScreenshotTestBots} from "~/app/screenshot_tests/helpers/seed_screenshot_test_bots.js";
import {attemptOneTimePasswordSignUpThenCreateSpace} from "~/server/spaces/create/attempt_one_time_password_sign_up_then_create_space.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    await seedScreenshotTestBots(context, runner.services);

    const {space, accounts} = await runner.createDemoSpace(context);

    const signInAccount = await TestAccount.create(context, {name: "Cass Cade"});
    const signInEmailAddress = await signInAccount.createEmailAddress("cass.cade@alpine.inc");

    // Create an account with a stable `AccountId` so the account avatar design is
    // always the same. We use a consistent background color. `hasNotSignedUp: true`
    // allows this account to finish sign up.
    const signUpAccount = await TestAccount.create(context, {
        id: unsafelyGenerateStableId<AccountId>(runner.stableRandom, "signUpAccount"),
        name: "Anthony Mose",
        hasNotSignedUp: true,
    });
    const signUpEmailAddress = await signUpAccount.createEmailAddress("anthony.mose@example.com");

    const {session: inviteAcceptSession} = await space.inviteEmailAddressAndCreateSession(
        accounts.cassCade,
        "alice@example.com",
    );
    const {session: inviteRejectSession} = await space.inviteEmailAddressAndCreateSession(
        accounts.cassCade,
        "bob@example.com",
    );

    await runner.goto(null, `/auth/sign-in`);
    await runner.screenshot("a0", "sign-in");

    await runner.getByLabel("Email").fill(signInEmailAddress);
    await runner.getByRole("button", {name: "Sign in"}).click();
    await runner.getByText(/we sent a passcode/i).waitFor();
    await runner.screenshot("a1", "sign-in-one-time-password");

    await runner.goto(null, `/auth/sign-up`);
    await runner.screenshot("a2", "sign-up");

    await runner.getByLabel("Email").fill(signUpEmailAddress);
    await runner.getByRole("button", {name: "Sign up"}).click();
    await runner.getByText("Nice to meet you, what\u2019s your name?").waitFor();
    await runner.getByRole("option").nth(15).click();
    await runner.screenshot("a3", "sign-up-profile");

    await runner.getByLabel("Full name").fill("Anthony Mose");
    await runner.getByRole("button", {name: "Sign up"}).click();
    await runner.getByText(/who do you work with/i).waitFor();
    await runner.screenshot("a4", "sign-up-invite");

    await runner.getByRole("link", {name: "Skip for now"}).click();
    await runner.getByText(/solo, alpine is a notes app/i).waitFor();
    await runner.screenshot("a5", "sign-up-invite-skip-modal");

    await runner.getByRole("button", {name: "Skip for now"}).click();
    await runner.getByText(/we sent a passcode/i).waitFor();
    await runner.screenshot("a6", "sign-up-one-time-password");

    const {oneTimePassword} = await retryWithExponentialBackoff(async retry => {
        const oneTimePasswords = runner.services.getOneTimePasswords();
        const oneTimePassword = oneTimePasswords.findLast(
            oneTimePassword => oneTimePassword.emailAddress === signUpEmailAddress,
        );
        if (!oneTimePassword) throw retry();
        return oneTimePassword;
    });

    const {sessionId, openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.unknownAnonymousAction(),
        {
            emailAddress: signUpEmailAddress,
            oneTimePassword: oneTimePassword,
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
            // Generate a stable `SpaceId` which influences the default avatar background color
            // which we want to keep consistent across screenshots.
            autoAddAccountsFromEmailDomainSpaceIdForTest: unsafelyGenerateStableId<SpaceId>(
                runner.stableRandom,
                "autoAddAccountsFromEmailDomainSpaceId",
            ),
        },
    );

    const signUpSession = await TestSession.get(context, sessionId);

    await runner.goto(signUpSession, `/s/${openSpaceId}`);
    await runner.screenshot("a7", "sign-up-space");

    await runner.goto(inviteAcceptSession, `/s/${space.id}/invite`);
    await runner.screenshot("a8", "invite");

    await runner.goto(inviteRejectSession, `/s/${space.id}/invite/reject-and-mark-as-spam`);
    await runner.screenshot("a9", "invite-reject-and-spam");
}
