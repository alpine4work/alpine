import getPort from "get-port";
import {IncomingMessage, ServerResponse, createServer} from "http";
import {Socket} from "net";
import {
    BotWebhookContextModule,
    BotWebhookContextModuleTokenAgentInterface,
} from "~/server/bots/bot_webhook_context_module.js";
import {
    processCallBotWebhookJob,
    setIsProcessCallBotWebhookJobCrashSimulatedForTest,
} from "~/server/bots/process_call_bot_webhook_job.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {afterTestEnds} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {CallBotWebhookJobDescription} from "~/server/jobs/core/job_description.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenPayloadSchema} from "~/server/tokens/token_payload.js";
import {
    botWebhookSignatureHeader,
    verifyBotWebhookRequestSignature,
} from "~/shared/api/specification/sign_bot_webhook_request.js";
import {ApiBotWebhookEvent} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    PromiseResolver,
    createPromiseResolver,
} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotWebhookEventId, ChatId} from "~/shared/id/types/id_types.open_source.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";

const mockTokenAgent: BotWebhookContextModuleTokenAgentInterface = {
    privateSide: {
        dangerouslySignLongLivedTokenForBotWebhook: async payload => {
            const textEncoder = new TextEncoder();
            const tokenPayload = encodeBase64(
                textEncoder.encode(JSON.stringify(TokenPayloadSchema.serialize(payload))),
            );

            // Mock JWT. A JWT has three sections separated by dots. The header, payload, and
            // signature. Include mock strings for the header and signature.
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

async function readRequestBody(req: IncomingMessage): Promise<string> {
    req.setEncoding("utf8");

    let body = "";
    for await (const chunk of req) body += chunk;

    return body;
}

test("if webhook is successful it\u2019s only called once", async () => {
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    const event2Id = generateChronologicalId<BotWebhookEventId>();

    const event2: ApiBotWebhookEvent = {
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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

test("webhook requests are signed when the bot has a webhook secret", async () => {
    let requestBody: string | null = null;
    let requestSignature: string | null = null;

    const server = await createTestServer((req, res) => {
        readRequestBody(req)
            .then(body => {
                requestBody = body;
                // Node.js lowercases incoming header names.
                requestSignature =
                    (req.headers[botWebhookSignatureHeader.toLowerCase()] as string | undefined) ??
                    null;
                res.statusCode = 200;
                res.setHeader("content-type", "text/plain");
                res.end("200 OK");
            })
            .catch(() => {
                res.statusCode = 500;
                res.setHeader("content-type", "text/plain");
                res.end("500 Internal Server Error");
            });
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
        webhookSecret: "test-secret",
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId,
        event,
    });

    const signedRequestBody = assertExists<string>(requestBody);
    const signature = assertExists<string>(requestSignature);

    // Throws if the signature doesn't match the request body.
    await verifyBotWebhookRequestSignature({
        requestBodyString: signedRequestBody,
        signature,
        secret: "test-secret",
    });

    expect(signature).toMatch(/^sha256=/);
});

test("webhook requests are not signed when the bot has no webhook secret", async () => {
    let requestBody: string | null = null;
    let requestSignature: string | null = null;

    const server = await createTestServer((req, res) => {
        readRequestBody(req)
            .then(body => {
                requestBody = body;
                // Node.js lowercases incoming header names.
                requestSignature =
                    (req.headers[botWebhookSignatureHeader.toLowerCase()] as string | undefined) ??
                    null;
                res.statusCode = 200;
                res.setHeader("content-type", "text/plain");
                res.end("200 OK");
            })
            .catch(() => {
                res.statusCode = 500;
                res.setHeader("content-type", "text/plain");
                res.end("500 Internal Server Error");
            });
    });

    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: server.baseUrl,
        webhookSecret: null,
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner"});

    const botAccount = await bot.instantiate(session);

    const eventId = generateChronologicalId<BotWebhookEventId>();

    const event: ApiBotWebhookEvent = {
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    await testProcessCallBotWebhookJob(space, {
        type: "CallBotWebhook",
        spaceId: space.id,
        botId: bot.id,
        botAccountId: botAccount.id,
        eventId,
        event,
    });

    const unsignedRequestBody = assertExists<string>(requestBody);

    // Unsigned requests pass verification. Just because we are able to verify signed
    // requests doesn't mean that every request _must_ be signed.
    await verifyBotWebhookRequestSignature({
        requestBodyString: unsignedRequestBody,
        signature: requestSignature,
        secret: "test-secret",
    });

    expect(requestSignature).toBeNull();
});

test("if webhook is successful it\u2019s only called once even if job is run multiple times in parallel", async () => {
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
        index: 0,
        createdTimeZone: defaultTimeZone,
    };

    const event2Id = generateChronologicalId<BotWebhookEventId>();

    const event2: ApiBotWebhookEvent = {
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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

test("if job fails it\u2019s scheduled to be run later up to three times", async () => {
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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

test("if job fails it\u2019s scheduled to be run later up to three times (success after one try)", async () => {
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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

test("if job fails it\u2019s scheduled to be run later up to three times (success after two tries)", async () => {
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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

test("requests which don\u2019t finish promptly are timed out and retried", async () => {
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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

test("requests which don\u2019t finish promptly are timed out and retried even if they finish shortly after", async () => {
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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

test("requests which don\u2019t finish promptly and have a simulated process crash are retried next time the job is run", async () => {
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
        type: "CreatedMessage",
        author: {id: generateId<AccountId>()},
        room: {type: "Chat", id: generateId<ChatId>()},
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

    // With a crash simulated, even though the server returns we have to retry because
    // we didn't see the server successfully return. So our system counts that as an
    // error.
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
