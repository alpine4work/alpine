import {optInToTryOnDesktopEmail} from "~/server/accounts/opt_in_to_try_on_desktop_email.js";
import {optOutOfTryOnDesktopEmail} from "~/server/accounts/opt_out_of_try_on_desktop_email.js";
import {processSendTryOnDesktopEmail} from "~/server/accounts/process_send_try_on_desktop_email.js";
import {
    scheduleTryOnDesktopEmail,
    scheduleTryOnDesktopEmailDelaySeconds,
} from "~/server/accounts/schedule_try_on_desktop_email.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

import.meta.jest.useFakeTimers();

const sendEmailImmediatelySpy = import.meta.jest.spyOn(
    NoopEmailContextModule.prototype,
    "sendImmediately",
);

const context = createTestContext({
    processMaintenanceJob: async (context, job) => {
        if (job.type === "SendTryOnDesktopEmail") {
            await processSendTryOnDesktopEmail(
                context.clone({email: new NoopEmailContextModule()}),
                job,
            );
        }
    },
});

test("schedules email for delivery in five minutes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const emailAddress = await session.account.createEmailAddress();

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(1);
});

test("only sends email once when scheduled twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const emailAddress = await session.account.createEmailAddress();

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(1);
});

test("only sends email once when scheduled after send", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const emailAddress = await session.account.createEmailAddress();

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(1);

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(1);
});

test("can\u2019t schedule email for account that\u2019s not yours", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    await session.account.createEmailAddress();

    const otherSession = await space.createSession();
    const otherEmailAddress = await otherSession.account.createEmailAddress();

    await expect(
        scheduleTryOnDesktopEmail(session.action(), {
            emailAddress: otherEmailAddress,
            openSpaceId: space.id,
        }),
    ).rejects.toThrow("Can\u2019t schedule try on desktop email for a different account");

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);
});

test("can opt-out of email delivery", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const emailAddress = await session.account.createEmailAddress();

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    await optOutOfTryOnDesktopEmail(session.action());

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);
});

test("opting-out of email delivery is idempotent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const emailAddress = await session.account.createEmailAddress();

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    await runAllPromises([
        optOutOfTryOnDesktopEmail(session.action()),
        optOutOfTryOnDesktopEmail(session.action()),
        optOutOfTryOnDesktopEmail(session.action()),
    ]);

    await optOutOfTryOnDesktopEmail(session.action());

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);
});

test("can opt-in to email delivery", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const emailAddress = await session.account.createEmailAddress();

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    await optOutOfTryOnDesktopEmail(session.action());

    await optInToTryOnDesktopEmail(session.action());

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(1);
});

test("opting-in to email delivery is idempotent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const emailAddress = await session.account.createEmailAddress();

    await scheduleTryOnDesktopEmail(session.action(), {
        emailAddress,
        openSpaceId: space.id,
    });

    await optOutOfTryOnDesktopEmail(session.action());

    await runAllPromises([
        optInToTryOnDesktopEmail(session.action()),
        optInToTryOnDesktopEmail(session.action()),
        optInToTryOnDesktopEmail(session.action()),
    ]);

    await optInToTryOnDesktopEmail(session.action());

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(0);

    import.meta.jest.advanceTimersByTime(scheduleTryOnDesktopEmailDelaySeconds * 1000);
    await ProcessContextModule.waitForTestTasks();

    expect(sendEmailImmediatelySpy).toHaveBeenCalledTimes(1);
});
