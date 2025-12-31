import getPort from "get-port";
import {IncomingMessage, ServerResponse, createServer} from "http";
import {Socket} from "net";
import {
    BotWebhookContextModule,
    BotWebhookContextModuleTokenAgentInterface,
} from "~/server/bots/bot_webhook_context_module.js";
import {
    finishUploadingBotAvatar,
    getBotWithAvatar,
    processCallBotWebhookJob,
    setIsProcessCallBotWebhookJobCrashSimulatedForTest,
} from "~/server/bots/bots_table.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {afterTestEnds} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {CallBotWebhookJobDescription} from "~/server/jobs/core/job_description.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenPayloadSchema} from "~/server/tokens/token_payload.js";
import {ApiBotWebhookEvent} from "~/shared/api/types/api_specification_convenience_types.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {
    generateChronologicalId,
    generateChronologicalIdWithTime,
} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, AvatarId, BotWebhookEventId, ChatId} from "~/shared/id/types/id_types.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";

const mockTokenAgent: BotWebhookContextModuleTokenAgentInterface = {
    privateSide: {
        dangerouslySignLongLivedTokenForBotWebhook: async payload => {
            const textEncoder = new TextEncoder();
            const tokenPayload = encodeBase64(
                textEncoder.encode(JSON.stringify(TokenPayloadSchema.serialize(payload))),
            );

            // Mock JWT. A JWT has three sections separated by dots. The header, payload,
            // and signature. Include mock strings for the header and signature.
            return `jwt.${tokenPayload}.signed`;
        },
    },
};

const context = createTestContext({
    processJob: async (context, job) => {
        if (job.type === "CallBotWebhook") {
            await processCallBotWebhookJob(
                context.clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
                job,
            );
        }
    },
});

async function testProcessCallBotWebhookJob(space: TestSpace, job: CallBotWebhookJobDescription) {
    await processCallBotWebhookJob(
        space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
        job,
    );
}

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
});

async function createTestServer(
    requestListener: (req: IncomingMessage, res: ServerResponse) => void,
) {
    const port = await getPort();

    const server = createServer(requestListener);

    const sockets = new Set<Socket>();

    server.on("connection", socket => {
        sockets.add(socket);
        socket.once("close", () => {
            sockets.delete(socket);
        });
    });

    afterTestEnds(async () => {
        // Make sure any sockets that are never resolved are forcibly killed.
        for (const socket of sockets) socket.end();

        await new Promise<void>((resolve, reject) => {
            server.close(error => {
                if (error) reject(error);
                else resolve();
            });
        });
    });

    await new Promise<void>(resolve => {
        server.listen(port, resolve);
    });

    return {
        baseUrl: `http://localhost:${port}`,
    };
}

test("if webhook is successful it’s only called once", async () => {
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain");
        res.end("200 OK");
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const event1Id = generateChronologicalId<BotWebhookEventId>();

    const event1: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    const event2Id = generateChronologicalId<BotWebhookEventId>();

    const event2: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 1,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId: event1Id,
        event: event1,
    });

    expect(serverRequestCount).toEqual(1);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId: event1Id,
        event: event1,
    });

    expect(serverRequestCount).toEqual(1);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId: event2Id,
        event: event2,
    });

    expect(serverRequestCount).toEqual(2);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId: event1Id,
        event: event1,
    });

    expect(serverRequestCount).toEqual(2);

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("if webhook is successful it’s only called once even if job is run multiple times in parallel", async () => {
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain");
        res.end("200 OK");
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const event1Id = generateChronologicalId<BotWebhookEventId>();

    const event1: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    const event2Id = generateChronologicalId<BotWebhookEventId>();

    const event2: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 1,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    await runAllPromises([
        processCallBotWebhookJob(
            space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
            {
                type: "CallBotWebhook",
                spaceId: space.id,
                botId: bot.id,
                botAccountId: botAccount.id,
                eventId: event1Id,
                event: event1,
            },
        ),
        processCallBotWebhookJob(
            space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
            {
                type: "CallBotWebhook",
                spaceId: space.id,
                botId: bot.id,
                botAccountId: botAccount.id,
                eventId: event1Id,
                event: event1,
            },
        ),
        processCallBotWebhookJob(
            space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
            {
                type: "CallBotWebhook",
                spaceId: space.id,
                botId: bot.id,
                botAccountId: botAccount.id,
                eventId: event1Id,
                event: event1,
            },
        ),
    ]);

    expect(serverRequestCount).toEqual(1);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId: event1Id,
        event: event1,
    });

    expect(serverRequestCount).toEqual(1);

    await runAllPromises([
        processCallBotWebhookJob(
            space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
            {
                type: "CallBotWebhook",
                spaceId: space.id,
                botId: bot.id,
                botAccountId: botAccount.id,
                eventId: event2Id,
                event: event2,
            },
        ),
        processCallBotWebhookJob(
            space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
            {
                type: "CallBotWebhook",
                spaceId: space.id,
                botId: bot.id,
                botAccountId: botAccount.id,
                eventId: event2Id,
                event: event2,
            },
        ),
    ]);

    expect(serverRequestCount).toEqual(2);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId: event1Id,
        event: event1,
    });

    expect(serverRequestCount).toEqual(2);

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("if job fails it’s scheduled to be run later up to three times", async () => {
    const willFailServerRequest = true;
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;

        if (willFailServerRequest) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain");
            res.end("500 Internal Server Error");
        } else {
            res.statusCode = 200;
            res.setHeader("content-type", "text/plain");
            res.end("200 OK");
        }
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId,
        event,
    });

    expect(serverRequestCount).toEqual(1);

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(2 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    expect(serverRequestCount).toEqual(2);

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(4 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    expect(serverRequestCount).toEqual(3);

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("if job fails it’s scheduled to be run later up to three times (success after one try)", async () => {
    let willFailServerRequest = true;
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;

        if (willFailServerRequest) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain");
            res.end("500 Internal Server Error");
        } else {
            res.statusCode = 200;
            res.setHeader("content-type", "text/plain");
            res.end("200 OK");
        }
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId,
        event,
    });

    expect(serverRequestCount).toEqual(1);

    willFailServerRequest = false;

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(2 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    expect(serverRequestCount).toEqual(2);

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("if job fails it’s scheduled to be run later up to three times (success after two tries)", async () => {
    let willFailServerRequest = true;
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;

        if (willFailServerRequest) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain");
            res.end("500 Internal Server Error");
        } else {
            res.statusCode = 200;
            res.setHeader("content-type", "text/plain");
            res.end("200 OK");
        }
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId,
        event,
    });

    expect(serverRequestCount).toEqual(1);

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(2 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    expect(serverRequestCount).toEqual(2);

    willFailServerRequest = false;

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(4 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    expect(serverRequestCount).toEqual(3);

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("same job queued while waiting to retry failed job also waits", async () => {
    const willFailServerRequest = true;
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;

        if (willFailServerRequest) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain");
            res.end("500 Internal Server Error");
        } else {
            res.statusCode = 200;
            res.setHeader("content-type", "text/plain");
            res.end("200 OK");
        }
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId,
        event,
    });

    expect(serverRequestCount).toEqual(1);

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(1 * 1000);
    expect(import.meta.jest.getTimerCount()).toEqual(1);

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId,
        event,
    });

    expect(import.meta.jest.getTimerCount()).toEqual(2);
    import.meta.jest.advanceTimersByTime(1 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(2);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    expect(serverRequestCount).toEqual(2);

    expect(import.meta.jest.getTimerCount()).toBeGreaterThanOrEqual(1);
    expect(import.meta.jest.getTimerCount()).toBeLessThanOrEqual(2);
    import.meta.jest.advanceTimersByTime(4 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toBeGreaterThanOrEqual(1);
    expect(import.meta.jest.getTimerCount()).toBeLessThanOrEqual(2);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    expect(serverRequestCount).toEqual(3);

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("requests which don’t finish promptly are timed out and retried", async () => {
    const serverRequestPromiseResolvers: Array<PromiseResolver<void>> = [];
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;

        const promiseResolver = createPromiseResolver();
        serverRequestPromiseResolvers.push(promiseResolver);

        promiseResolver.promise.then(
            () => {
                res.statusCode = 200;
                res.setHeader("content-type", "text/plain");
                res.end("200 OK");
            },
            () => {
                res.statusCode = 500;
                res.setHeader("content-type", "text/plain");
                res.end("500 Internal Server Error");
            },
        );
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    const jobPromise = processCallBotWebhookJob(
        space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
        {
            type: "CallBotWebhook",
            spaceId: space.id,
            botId: bot.id,
            botAccountId: botAccount.id,
            eventId,
            event,
        },
    );

    await waitForExpect(() => {
        expect(serverRequestCount).toEqual(1);
    });

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(10 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await jobPromise;

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(2 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await waitForExpect(() => {
        expect(serverRequestCount).toEqual(2);
    });

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(10 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(4 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await waitForExpect(() => {
        expect(serverRequestCount).toEqual(3);
    });

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(10 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await ProcessContextModule.waitForTestTasks();

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("requests which don’t finish promptly are timed out and retried even if they finish shortly after", async () => {
    let serverRequestPromiseResolvers: Array<PromiseResolver<void>> = [];
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;

        const promiseResolver = createPromiseResolver();
        serverRequestPromiseResolvers.push(promiseResolver);

        promiseResolver.promise.then(
            () => {
                res.statusCode = 200;
                res.setHeader("content-type", "text/plain");
                res.end("200 OK");
            },
            () => {
                res.statusCode = 500;
                res.setHeader("content-type", "text/plain");
                res.end("500 Internal Server Error");
            },
        );
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    const jobPromise = processCallBotWebhookJob(
        space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
        {
            type: "CallBotWebhook",
            spaceId: space.id,
            botId: bot.id,
            botAccountId: botAccount.id,
            eventId,
            event,
        },
    );

    await waitForExpect(() => {
        expect(serverRequestCount).toEqual(1);
    });

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(10 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await jobPromise;

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(1 * 1000);
    expect(import.meta.jest.getTimerCount()).toEqual(1);

    // Pretend request finishes shortly after timeout.
    for (const promiseResolver of serverRequestPromiseResolvers) promiseResolver.resolve();
    serverRequestPromiseResolvers = [];

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(1 * 1000 - 100);
    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(100);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    await waitForExpect(() => {
        expect(serverRequestCount).toEqual(2);
    });

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(5 * 1000);
    expect(import.meta.jest.getTimerCount()).toEqual(1);

    // Now finish new request before timeout.
    for (const promiseResolver of serverRequestPromiseResolvers) promiseResolver.resolve();
    serverRequestPromiseResolvers = [];

    await ProcessContextModule.waitForTestTasks();

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

test("requests which don’t finish promptly and have a simulated process crash are retried next time the job is run", async () => {
    let serverRequestPromiseResolvers: Array<PromiseResolver<void>> = [];
    let serverRequestCount = 0;

    const server = await createTestServer((req, res) => {
        serverRequestCount++;

        const promiseResolver = createPromiseResolver();
        serverRequestPromiseResolvers.push(promiseResolver);

        promiseResolver.promise.then(
            () => {
                res.statusCode = 200;
                res.setHeader("content-type", "text/plain");
                res.end("200 OK");
            },
            () => {
                res.statusCode = 500;
                res.setHeader("content-type", "text/plain");
                res.end("500 Internal Server Error");
            },
        );
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "NewMessage",
        authorId: generateId<AccountId>(),
        roomPath: `/chats/${generateId<ChatId>()}`,
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    expect(serverRequestCount).toEqual(0);

    const job1Promise = processCallBotWebhookJob(
        space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
        {
            type: "CallBotWebhook",
            spaceId: space.id,
            botId: bot.id,
            botAccountId: botAccount.id,
            eventId,
            event,
        },
    );

    await waitForExpect(() => {
        expect(serverRequestCount).toEqual(1);
    });

    expect(import.meta.jest.getTimerCount()).toEqual(1);
    import.meta.jest.advanceTimersByTime(5 * 1000);
    expect(import.meta.jest.getTimerCount()).toEqual(1);

    // With a crash simulated, even though the server returns we have to retry
    // because we didn't see the server successfully return. So our system counts
    // that as an error.
    //
    // Arguably this is a glitch that'll cause webhooks to occasionally double fire
    // unexpectedly. We need to advise webhook listeners to be idempotent.
    setIsProcessCallBotWebhookJobCrashSimulatedForTest(true);
    for (const promiseResolver of serverRequestPromiseResolvers) promiseResolver.resolve();
    serverRequestPromiseResolvers = [];
    await job1Promise;
    setIsProcessCallBotWebhookJobCrashSimulatedForTest(false);

    expect(import.meta.jest.getTimerCount()).toEqual(0);
    import.meta.jest.advanceTimersByTime(10 * 1000);
    expect(import.meta.jest.getTimerCount()).toEqual(0);

    const job2Promise = processCallBotWebhookJob(
        space.systemAction().clone({botWebhook: new BotWebhookContextModule(mockTokenAgent)}),
        {
            type: "CallBotWebhook",
            spaceId: space.id,
            botId: bot.id,
            botAccountId: botAccount.id,
            eventId,
            event,
        },
    );

    await waitForExpect(() => {
        expect(serverRequestCount).toEqual(2);
    });

    for (const promiseResolver of serverRequestPromiseResolvers) promiseResolver.resolve();
    serverRequestPromiseResolvers = [];
    await job2Promise;

    // Make sure there are no pending timers at the end of the test
    expect(import.meta.jest.getTimerCount()).toEqual(0);
});

describe("finishUploadingBotAvatar", () => {
    test("successfully uploads a bot avatar", async () => {
        const bot = await TestBot.create(context, {
            name: "Test Bot",
            webhookUrl: "https://example.com/webhook",
        });

        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        const avatarId = generateChronologicalId<AvatarId>();
        const avatarContent = new TextEncoder().encode("test-avatar-content");

        const result = await finishUploadingBotAvatar(session.action(), {
            botId: bot.id,
            avatarContent,
            avatarId,
        });

        expect(result.id).toEqual(bot.id);
        expect(result.name).toEqual("Test Bot");
        expect(result.avatar).toEqual({
            avatarId,
            content: avatarContent,
            version: 1,
        });

        // Verify the avatar was persisted
        const botWithAvatar = await getBotWithAvatar(context, bot.id);
        expect(botWithAvatar.avatar).toEqual({
            avatarId,
            content: expect.any(Uint8Array),
            version: 1,
        });
    });

    test("returns existing bot when avatar ID is not newer (idempotency)", async () => {
        const bot = await TestBot.create(context, {
            name: "Test Bot",
            webhookUrl: "https://example.com/webhook",
        });

        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        const olderAvatarId = generateChronologicalIdWithTime<AvatarId>(
            new Date("2025-01-01").getTime(),
        );
        const olderAvatarContent = new TextEncoder().encode("older-avatar-content");

        // Upload first avatar with newer ID
        const newerAvatarId = generateChronologicalIdWithTime<AvatarId>(
            new Date("2025-01-02").getTime(),
        );
        const newerAvatarContent = new TextEncoder().encode("newer-avatar-content");

        await finishUploadingBotAvatar(session.action(), {
            botId: bot.id,
            avatarContent: newerAvatarContent,
            avatarId: newerAvatarId,
        });
        const botWithNewerAvatar = await getBotWithAvatar(context, bot.id);

        const oldAvatarResult = await finishUploadingBotAvatar(session.action(), {
            botId: bot.id,
            avatarContent: olderAvatarContent,
            avatarId: olderAvatarId,
        });

        // Should return the bot with the newer avatar, not update it
        expect(oldAvatarResult.avatar).toEqual(botWithNewerAvatar.avatar);

        // Verify the bot hasn't changed
        const botWithAvatar = await getBotWithAvatar(context, bot.id);
        expect(botWithAvatar).toEqual(botWithNewerAvatar);
    });

    test("returns existing bot when avatar ID is equal (idempotency)", async () => {
        const bot = await TestBot.create(context, {
            name: "Test Bot",
            webhookUrl: "https://example.com/webhook",
        });

        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        const avatarId = generateChronologicalId<AvatarId>();
        const firstAvatarContent = new TextEncoder().encode("first-avatar-content");

        await finishUploadingBotAvatar(session.action(), {
            botId: bot.id,
            avatarContent: firstAvatarContent,
            avatarId,
        });
        const botAfterFirstAvatarUpload = await getBotWithAvatar(context, bot.id);

        // Try to upload with the same avatar ID but different content
        const secondAvatarContent = new TextEncoder().encode("second-avatar-content");

        // Upload second avatar
        await finishUploadingBotAvatar(session.action(), {
            botId: bot.id,
            avatarContent: secondAvatarContent,
            avatarId,
        });

        const botAfterSecondAvatarUpload = await getBotWithAvatar(context, bot.id);
        // Should return the bot with the first avatar
        expect(botAfterSecondAvatarUpload).toEqual(botAfterFirstAvatarUpload);
    });

    test("throws PermissionDeniedError when user doesn’t have internal access", async () => {
        const bot = await TestBot.create(context, {
            name: "Test Bot",
            webhookUrl: "https://example.com/webhook",
        });

        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: false});

        const avatarId = generateChronologicalId<AvatarId>();
        const avatarContent = new TextEncoder().encode("test-avatar-content");

        await expect(
            finishUploadingBotAvatar(session.action(), {
                botId: bot.id,
                avatarContent,
                avatarId,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("successfully uploads when bot has no previous avatar", async () => {
        const bot = await TestBot.create(context, {
            name: "Test Bot",
            webhookUrl: "https://example.com/webhook",
        });

        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner", hasInternalAccess: true});

        // Verify bot has no avatar initially
        const botBeforeUpload = await getBotWithAvatar(context, bot.id);
        expect(botBeforeUpload.avatar).toBeNull();

        const avatarId = generateChronologicalId<AvatarId>();
        const avatarContent = new TextEncoder().encode("test-avatar-content");

        await finishUploadingBotAvatar(session.action(), {
            botId: bot.id,
            avatarContent,
            avatarId,
        });

        const botAfterAvatarUpload = await getBotWithAvatar(context, bot.id);
        expect(botAfterAvatarUpload).toEqual({
            ...botBeforeUpload,
            avatar: expect.objectContaining({
                avatarId,
                version: 1,
            }),
        });
    });
});
