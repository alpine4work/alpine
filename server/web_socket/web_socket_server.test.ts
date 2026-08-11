import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {Response} from "~/server/node/install_response_with_web_socket_support.js";
import {
    WebSocketConnectionProcedures,
    WebSocketServer,
} from "~/server/web_socket/web_socket_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.open_source.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    SessionId,
    WebSocketProcedureRequestId,
} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";
import {
    WebSocketClosingWithErrorMessageSchema,
    createWebSocketMessageFromClientSchema,
    createWebSocketMessageFromServerSchema,
} from "~/shared/web_socket/web_socket_schema.js";

let afterNextCallbacks: Array<() => MaybePromise<void>> = [];

afterEach(async () => {
    const callbacks = assertExists(afterNextCallbacks);
    afterNextCallbacks = [];

    await runAllPromises(callbacks.map(callback => callback()));
});

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

type TestProcessContext = Context<TestProcessContextModules>;

type TestProcessContextModules = {
    tracer: TracerContextModule;
    process: ProcessContextModule;
};

type TestSessionActionContext = Context<TestSessionActionContextModules>;

type TestSessionActionContextModules = TestProcessContextModules & {
    actor: SessionActorContextModule;
    cache: CacheContextModule;
    batch: BatchContextModule;
    fork: ForkActionContextModule;
};

const processContext = Context.new({
    tracer: new TracerContextModule(testTracer),
    process: ProcessContextModule.test({afterEach}),
});

const account1Id = generateId<AccountId>();
const account2Id = generateId<AccountId>();

const sessionIdByAccountId = new DefaultMap<AccountId, SessionId>(generateId);

function action(accountId: AccountId): Context<TestSessionActionContextModules> {
    return processContext.clone({
        actor: SessionActorContextModule.dangerouslyNewWithoutCheckingIfRevoked(
            "Test",
            sessionIdByAccountId.getOrSetDefault(accountId),
            accountId,
        ),
        cache: CacheContextModule.new(),
        batch: BatchContextModule.new(),
        fork: new ForkActionContextModule(),
    });
}

test("authorizes on connection", async () => {
    type TestEvent = WebSocketProtocolEventType<typeof TestProtocol>;
    type TestEventStub = {readonly type: "TestStub"};

    const TestProtocol = defineWebSocketProtocol({
        procedures: {},
        events: {Test: Schema.object({type: Schema.value("Test")})},
    });

    let authorizationCount = 0;

    class TestConnection {
        public readonly procedures = {};

        public async authorize() {
            authorizationCount++;
        }

        public async transformEvent(context: {}, event: TestEventStub): Promise<TestEvent> {
            assert(event.type === "TestStub");
            return {type: "Test"};
        }
    }

    const server = new WebSocketServer<
        TestProcessContextModules,
        TestSessionActionContextModules,
        typeof TestProtocol,
        TestEventStub,
        TestConnection
    >(processContext, TestProtocol, () => new TestConnection());

    afterNextCallbacks.push(() => server.closeAll(processContext));

    expect(authorizationCount).toEqual(0);

    const response = await server.upgrade(
        action(account1Id),
        new Request("http://localhost/", {headers: {upgrade: "websocket"}}),
        {responseClassForTest: Response},
    );

    expect(authorizationCount).toEqual(1);

    assert(response.webSocket);
});

test("if authorization fails then connection closes", async () => {
    type TestEvent = WebSocketProtocolEventType<typeof TestProtocol>;
    type TestEventStub = {readonly type: "TestStub"};

    const TestProtocol = defineWebSocketProtocol({
        procedures: {},
        events: {Test: Schema.object({type: Schema.value("Test")})},
    });

    const authorizationError = new PermissionDeniedError("Test authorization error");

    class TestConnection {
        public readonly procedures = {};

        public async authorize() {
            throw authorizationError;
        }

        public async transformEvent(context: {}, event: TestEventStub): Promise<TestEvent> {
            assert(event.type === "TestStub");
            return {type: "Test"};
        }
    }

    const server = new WebSocketServer<
        TestProcessContextModules,
        TestSessionActionContextModules,
        typeof TestProtocol,
        TestEventStub,
        TestConnection
    >(processContext, TestProtocol, () => new TestConnection());

    afterNextCallbacks.push(() => server.closeAll(processContext));

    const response = await server.upgrade(
        action(account1Id),
        new Request("http://localhost/", {headers: {upgrade: "websocket"}}),
        {responseClassForTest: Response},
    );

    assert(response.webSocket);

    const messages: Array<unknown> = [];
    const closePromiseResolver = createPromiseResolver();

    response.webSocket.addEventListener("message", event => {
        messages.push(JSON.parse(event.data));
    });

    response.webSocket.addEventListener("close", () => {
        closePromiseResolver.resolve();
    });

    (response.webSocket as any).accept();

    await closePromiseResolver.promise;

    expect(messages).toEqual([
        WebSocketClosingWithErrorMessageSchema.serialize({
            type: "ClosingWithError",
            error: authorizationError,
        }),
    ]);
});

test("authorization is renewed every two minutes when procedure is called", async () => {
    type TestEvent = WebSocketProtocolEventType<typeof TestProtocol>;
    type TestEventStub = {readonly type: "TestStub"};

    const TestProtocol = defineWebSocketProtocol({
        procedures: {
            echo: {
                input: {string: Schema.string},
                output: {string: Schema.string},
            },
        },
        events: {Test: Schema.object({type: Schema.value("Test")})},
    });

    const TestMessageFromClientSchema = createWebSocketMessageFromClientSchema(TestProtocol);
    const TestMessageFromServerSchema = createWebSocketMessageFromServerSchema(TestProtocol);

    let authorizationStartCount = 0;
    let authorizationFinishCount = 0;

    class TestConnection {
        public readonly procedures: WebSocketConnectionProcedures<
            TestSessionActionContextModules,
            typeof TestProtocol
        > = {
            echo: async (context, {string}) => ({string}),
        };

        public async authorize() {
            authorizationStartCount++;
            await wait(100);
            authorizationFinishCount++;
        }

        public async transformEvent(context: {}, event: TestEventStub): Promise<TestEvent> {
            assert(event.type === "TestStub");
            return {type: "Test"};
        }
    }

    const server = new WebSocketServer<
        TestProcessContextModules,
        TestSessionActionContextModules,
        typeof TestProtocol,
        TestEventStub,
        TestConnection
    >(processContext, TestProtocol, () => new TestConnection());

    afterNextCallbacks.push(() => server.closeAll(processContext));

    expect(authorizationStartCount).toEqual(0);
    expect(authorizationFinishCount).toEqual(0);

    const response = await server.upgrade(
        action(account1Id),
        new Request("http://localhost/", {headers: {upgrade: "websocket"}}),
        {responseClassForTest: Response},
    );

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(0);

    import.meta.jest.advanceTimersByTime(100);
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    const webSocket = assertExists(response.webSocket);

    const request1Id = generateId<WebSocketProcedureRequestId>();
    const request1PromiseResolver = createPromiseResolver();

    const request2Id = generateId<WebSocketProcedureRequestId>();
    const request2PromiseResolver = createPromiseResolver();

    const request3Id = generateId<WebSocketProcedureRequestId>();
    const request3PromiseResolver = createPromiseResolver();

    webSocket.addEventListener("message", event => {
        const message = TestMessageFromServerSchema.deserialize(JSON.parse(event.data));

        // Ignore pongs...
        if (message.type === "Pong") return;

        if (!request1PromiseResolver.isSettled()) {
            if (message.type === "ProcedureResponse" && message.requestId === request1Id) {
                request1PromiseResolver.resolve();
            } else {
                request1PromiseResolver.reject(new InternalError("Unexpected message"));
            }
        } else if (!request2PromiseResolver.isSettled()) {
            if (message.type === "ProcedureResponse" && message.requestId === request2Id) {
                request2PromiseResolver.resolve();
            } else {
                request2PromiseResolver.reject(new InternalError("Unexpected message"));
            }
        } else if (!request3PromiseResolver.isSettled()) {
            if (message.type === "ProcedureResponse" && message.requestId === request3Id) {
                request3PromiseResolver.resolve();
            } else {
                request3PromiseResolver.reject(new InternalError("Unexpected message"));
            }
        }
    });

    (webSocket as any).accept();

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    webSocket.send(
        JSON.stringify(
            TestMessageFromClientSchema.serialize({
                type: "ProcedureRequest",
                requestId: request1Id,
                input: {
                    type: "echo",
                    string: "test 1",
                },
                tracerContext: null,
            }),
        ),
    );

    await waitMacrotask();
    expect(request1PromiseResolver.isSettled()).toEqual(true);

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3 - 100);

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    webSocket.send(
        JSON.stringify(
            TestMessageFromClientSchema.serialize({
                type: "ProcedureRequest",
                requestId: request2Id,
                input: {
                    type: "echo",
                    string: "test 2",
                },
                tracerContext: null,
            }),
        ),
    );

    // Test that response is returned before authorization finishes
    await waitMacrotask();
    expect(request2PromiseResolver.isSettled()).toEqual(true);

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(1);

    import.meta.jest.advanceTimersByTime(100);
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    import.meta.jest.advanceTimersByTime(Math.floor((1000 * 60 * 2) / 3));

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime(Math.floor((1000 * 60 * 2) / 3));

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    webSocket.send(
        JSON.stringify(
            TestMessageFromClientSchema.serialize({
                type: "ProcedureRequest",
                requestId: request3Id,
                input: {
                    type: "echo",
                    string: "test 3",
                },
                tracerContext: null,
            }),
        ),
    );

    // Test that response is NOT returned before authorization finishes
    await waitMacrotask();
    expect(request3PromiseResolver.isSettled()).toEqual(false);

    expect(authorizationStartCount).toEqual(3);
    expect(authorizationFinishCount).toEqual(2);

    import.meta.jest.advanceTimersByTime(100);
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(3);
    expect(authorizationFinishCount).toEqual(3);
    expect(request3PromiseResolver.isSettled()).toEqual(true);
});

test("authorization is renewed every two minutes when event is sent", async () => {
    type TestEvent = WebSocketProtocolEventType<typeof TestProtocol>;
    type TestEventStub = {readonly type: "TestStub"};

    const TestProtocol = defineWebSocketProtocol({
        procedures: {
            echo: {
                input: {string: Schema.string},
                output: {string: Schema.string},
            },
        },
        events: {Test: Schema.object({type: Schema.value("Test")})},
    });

    const TestMessageFromClientSchema = createWebSocketMessageFromClientSchema(TestProtocol);
    const TestMessageFromServerSchema = createWebSocketMessageFromServerSchema(TestProtocol);

    let authorizationStartCount = 0;
    let authorizationFinishCount = 0;

    class TestConnection {
        public readonly procedures: WebSocketConnectionProcedures<
            TestSessionActionContextModules,
            typeof TestProtocol
        > = {
            echo: async (context, {string}) => ({string}),
        };

        public async authorize() {
            authorizationStartCount++;
            await wait(100);
            authorizationFinishCount++;
        }

        public async transformEvent(context: {}, event: TestEventStub): Promise<TestEvent> {
            assert(event.type === "TestStub");
            return {type: "Test"};
        }
    }

    const server = new WebSocketServer<
        TestProcessContextModules,
        TestSessionActionContextModules,
        typeof TestProtocol,
        TestEventStub,
        TestConnection
    >(processContext, TestProtocol, () => new TestConnection());

    afterNextCallbacks.push(() => server.closeAll(processContext));

    expect(authorizationStartCount).toEqual(0);
    expect(authorizationFinishCount).toEqual(0);

    const response = await server.upgrade(
        action(account1Id),
        new Request("http://localhost/", {headers: {upgrade: "websocket"}}),
        {responseClassForTest: Response},
    );

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(0);

    import.meta.jest.advanceTimersByTime(100);
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    const webSocket = assertExists(response.webSocket);

    const messages: Array<unknown> = [];

    webSocket.addEventListener("message", event => {
        const message = TestMessageFromServerSchema.deserialize(JSON.parse(event.data));

        // Ignore pongs...
        if (message.type === "Pong") return;

        messages.push(message);
    });

    (webSocket as any).accept();

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    server.sendEventToAll(processContext, {type: "TestStub"});

    await waitMacrotask();
    expect(messages).toEqual([{type: "Event", event: {type: "Test"}}]);

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3 - 100);

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    server.sendEventToAll(processContext, {type: "TestStub"});

    // Test that event is sent before authorization finishes
    await waitMacrotask();
    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
    ]);

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(1);

    import.meta.jest.advanceTimersByTime(100);
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    server.sendEventToAll(processContext, {type: "TestStub"});

    // Test that authorization is reused
    await waitMacrotask();
    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
    ]);

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    server.sendEventToAll(processContext, {type: "TestStub"});

    // Test that event is NOT sent before authorization finishes
    await waitMacrotask();
    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
    ]);

    expect(authorizationStartCount).toEqual(3);
    expect(authorizationFinishCount).toEqual(2);

    import.meta.jest.advanceTimersByTime(100);
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(3);
    expect(authorizationFinishCount).toEqual(3);
    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
    ]);
});

test("authorization error will close the connection", async () => {
    type TestEvent = WebSocketProtocolEventType<typeof TestProtocol>;
    type TestEventStub = {readonly type: "TestStub"};

    const TestProtocol = defineWebSocketProtocol({
        procedures: {
            echo: {
                input: {string: Schema.string},
                output: {string: Schema.string},
            },
        },
        events: {Test: Schema.object({type: Schema.value("Test")})},
    });

    const TestMessageFromClientSchema = createWebSocketMessageFromClientSchema(TestProtocol);
    const TestMessageFromServerSchema = createWebSocketMessageFromServerSchema(TestProtocol);

    let authorizationStartCount = 0;
    let authorizationFinishCount = 0;

    const authorizationError = new PermissionDeniedError("Test authorization error");

    class TestConnection {
        public readonly procedures: WebSocketConnectionProcedures<
            TestSessionActionContextModules,
            typeof TestProtocol
        > = {
            echo: async (context, {string}) => ({string}),
        };

        public async authorize() {
            authorizationStartCount++;
            await wait(100);
            authorizationFinishCount++;

            if (authorizationStartCount >= 2) {
                throw authorizationError;
            }
        }

        public async transformEvent(context: {}, event: TestEventStub): Promise<TestEvent> {
            assert(event.type === "TestStub");
            return {type: "Test"};
        }
    }

    const server = new WebSocketServer<
        TestProcessContextModules,
        TestSessionActionContextModules,
        typeof TestProtocol,
        TestEventStub,
        TestConnection
    >(processContext, TestProtocol, () => new TestConnection());

    afterNextCallbacks.push(() => server.closeAll(processContext));

    expect(authorizationStartCount).toEqual(0);
    expect(authorizationFinishCount).toEqual(0);

    const response = await server.upgrade(
        action(account1Id),
        new Request("http://localhost/", {headers: {upgrade: "websocket"}}),
        {responseClassForTest: Response},
    );

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(0);

    import.meta.jest.advanceTimersByTime(100);
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    const webSocket = assertExists(response.webSocket);

    const messages: Array<unknown> = [];
    const closePromiseResolver = createPromiseResolver();

    webSocket.addEventListener("message", event => {
        const message = TestMessageFromServerSchema.deserialize(JSON.parse(event.data));

        // Ignore pongs...
        if (message.type === "Pong") return;

        messages.push(message);
    });

    webSocket.addEventListener("close", () => {
        closePromiseResolver.resolve();
    });

    (webSocket as any).accept();

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    server.sendEventToAll(processContext, {type: "TestStub"});

    await waitMacrotask();
    expect(messages).toEqual([{type: "Event", event: {type: "Test"}}]);

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3 - 100);

    expect(authorizationStartCount).toEqual(1);
    expect(authorizationFinishCount).toEqual(1);

    server.sendEventToAll(processContext, {type: "TestStub"});

    await waitMacrotask();
    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
    ]);

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(1);

    import.meta.jest.advanceTimersByTime(100);
    await ProcessContextModule.waitForTestTasks();
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    webSocket.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime((1000 * 60 * 2) / 3);

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    await waitMacrotask();
    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
    ]);

    server.sendEventToAll(processContext, {type: "TestStub"});

    await waitMacrotask();
    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
        {type: "ClosingWithError", error: authorizationError},
    ]);

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    import.meta.jest.advanceTimersByTime(100);
    await ProcessContextModule.waitForTestTasks();
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
        {type: "ClosingWithError", error: authorizationError},
    ]);

    server.sendEventToAll(processContext, {type: "TestStub"});

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    import.meta.jest.advanceTimersByTime(100);
    await waitMacrotask();

    expect(authorizationStartCount).toEqual(2);
    expect(authorizationFinishCount).toEqual(2);

    expect(messages).toEqual([
        {type: "Event", event: {type: "Test"}},
        {type: "Event", event: {type: "Test"}},
        {type: "ClosingWithError", error: authorizationError},
    ]);

    await closePromiseResolver.promise;
});

test("authorization function is called with the correct actor when triggering authorization in a different connection", async () => {
    type TestEvent = WebSocketProtocolEventType<typeof TestProtocol>;
    type TestEventStub = {readonly type: "TestStub"};

    const TestProtocol = defineWebSocketProtocol({
        procedures: {
            sendEventToOthers: {
                input: {},
                output: {},
            },
        },
        events: {Test: Schema.object({type: Schema.value("Test")})},
    });

    const TestMessageFromClientSchema = createWebSocketMessageFromClientSchema(TestProtocol);
    const TestMessageFromServerSchema = createWebSocketMessageFromServerSchema(TestProtocol);

    const authorizationCountByAccountId = new Map<AccountId, number>();

    const authorizationError = new PermissionDeniedError("Test authorization error");

    const throwAuthorizationErrorByAccountId = new Map<AccountId, boolean>();

    class TestConnection {
        private readonly _sendEventToOthers: (
            context: TestProcessContext,
            event: TestEventStub,
        ) => void;

        constructor({
            sendEventToOthers,
        }: {
            sendEventToOthers: (context: TestProcessContext, event: TestEventStub) => void;
        }) {
            this._sendEventToOthers = sendEventToOthers;
        }

        public readonly procedures: WebSocketConnectionProcedures<
            TestSessionActionContextModules,
            typeof TestProtocol
        > = {
            sendEventToOthers: async (context, {}) => {
                this._sendEventToOthers(context, {type: "TestStub"});
                return {};
            },
        };

        public async authorize(context: TestSessionActionContext) {
            const accountId = context.actor.getAccountId();

            authorizationCountByAccountId.set(
                accountId,
                (authorizationCountByAccountId.get(accountId) ?? 0) + 1,
            );

            if (throwAuthorizationErrorByAccountId.get(accountId)) {
                throw authorizationError;
            }
        }

        public async transformEvent(context: {}, event: TestEventStub): Promise<TestEvent> {
            assert(event.type === "TestStub");
            return {type: "Test"};
        }
    }

    const server = new WebSocketServer<
        TestProcessContextModules,
        TestSessionActionContextModules,
        typeof TestProtocol,
        TestEventStub,
        TestConnection
    >(
        processContext,
        TestProtocol,
        ({sendEventToOthers}) => new TestConnection({sendEventToOthers}),
    );

    afterNextCallbacks.push(() => server.closeAll(processContext));

    const request1Id = generateId<WebSocketProcedureRequestId>();
    const request1PromiseResolver = createPromiseResolver();

    const request2Id = generateId<WebSocketProcedureRequestId>();
    const request2PromiseResolver = createPromiseResolver();

    const request3Id = generateId<WebSocketProcedureRequestId>();
    const request3PromiseResolver = createPromiseResolver();

    expect(authorizationCountByAccountId).toEqual(new Map());

    const response1 = await server.upgrade(
        action(account1Id),
        new Request("http://localhost/", {headers: {upgrade: "websocket"}}),
        {responseClassForTest: Response},
    );

    await waitMacrotask();

    expect(authorizationCountByAccountId).toEqual(new Map([[account1Id, 1]]));

    const webSocket1 = assertExists(response1.webSocket);

    const messages1: Array<unknown> = [];
    const close1PromiseResolver = createPromiseResolver();

    webSocket1.addEventListener("message", event => {
        const message = TestMessageFromServerSchema.deserialize(JSON.parse(event.data));

        // Ignore pongs...
        if (message.type === "Pong") return;

        messages1.push(message);

        if (message.type === "ProcedureResponse" && message.requestId === request1Id) {
            request1PromiseResolver.resolve();
        }

        if (message.type === "ProcedureResponse" && message.requestId === request2Id) {
            request2PromiseResolver.resolve();
        }

        if (message.type === "ProcedureResponse" && message.requestId === request3Id) {
            request3PromiseResolver.resolve();
        }
    });

    webSocket1.addEventListener("close", () => {
        close1PromiseResolver.resolve();
    });

    (webSocket1 as any).accept();

    expect(authorizationCountByAccountId).toEqual(new Map([[account1Id, 1]]));

    const response2 = await server.upgrade(
        action(account2Id),
        new Request("http://localhost/", {headers: {upgrade: "websocket"}}),
        {responseClassForTest: Response},
    );

    await waitMacrotask();

    expect(authorizationCountByAccountId).toEqual(
        new Map([
            [account1Id, 1],
            [account2Id, 1],
        ]),
    );

    const webSocket2 = assertExists(response2.webSocket);

    const messages2: Array<unknown> = [];
    const close2PromiseResolver = createPromiseResolver();

    webSocket2.addEventListener("message", event => {
        const message = TestMessageFromServerSchema.deserialize(JSON.parse(event.data));

        // Ignore pongs...
        if (message.type === "Pong") return;

        messages2.push(message);
    });

    webSocket2.addEventListener("close", () => {
        close2PromiseResolver.resolve();
    });

    (webSocket2 as any).accept();

    expect(authorizationCountByAccountId).toEqual(
        new Map([
            [account1Id, 1],
            [account2Id, 1],
        ]),
    );

    expect(messages1).toEqual([]);
    expect(messages2).toEqual([]);

    webSocket1.send(
        JSON.stringify(
            TestMessageFromClientSchema.serialize({
                type: "ProcedureRequest",
                requestId: request1Id,
                input: {type: "sendEventToOthers"},
                tracerContext: null,
            }),
        ),
    );

    await request1PromiseResolver.promise;

    expect(messages1).toEqual([
        {
            type: "ProcedureResponse",
            requestId: request1Id,
            result: {ok: true, output: {type: "sendEventToOthers"}},
        },
    ]);

    expect(messages2).toEqual([
        {
            type: "Event",
            event: {type: "Test"},
        },
    ]);

    expect(authorizationCountByAccountId).toEqual(
        new Map([
            [account1Id, 1],
            [account2Id, 1],
        ]),
    );

    import.meta.jest.advanceTimersByTime(1000 * 60);

    webSocket1.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    webSocket2.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime(1000 * 60);

    expect(authorizationCountByAccountId).toEqual(
        new Map([
            [account1Id, 1],
            [account2Id, 1],
        ]),
    );

    expect(close1PromiseResolver.isSettled()).toEqual(false);
    expect(close2PromiseResolver.isSettled()).toEqual(false);

    webSocket1.send(
        JSON.stringify(
            TestMessageFromClientSchema.serialize({
                type: "ProcedureRequest",
                requestId: request2Id,
                input: {type: "sendEventToOthers"},
                tracerContext: null,
            }),
        ),
    );

    await request2PromiseResolver.promise;
    await ProcessContextModule.waitForTestTasks();

    expect(authorizationCountByAccountId).toEqual(
        new Map([
            [account1Id, 2],
            [account2Id, 2],
        ]),
    );

    expect(messages1).toEqual([
        {
            type: "ProcedureResponse",
            requestId: request1Id,
            result: {ok: true, output: {type: "sendEventToOthers"}},
        },
        {
            type: "ProcedureResponse",
            requestId: request2Id,
            result: {ok: true, output: {type: "sendEventToOthers"}},
        },
    ]);

    expect(messages2).toEqual([
        {
            type: "Event",
            event: {type: "Test"},
        },
        {
            type: "Event",
            event: {type: "Test"},
        },
    ]);

    webSocket1.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    webSocket2.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime(1000 * 60);

    webSocket1.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    webSocket2.send(
        JSON.stringify(TestMessageFromClientSchema.serialize({type: "Ping", tracerContext: null})),
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 + 1000);

    expect(authorizationCountByAccountId).toEqual(
        new Map([
            [account1Id, 2],
            [account2Id, 2],
        ]),
    );

    expect(close1PromiseResolver.isSettled()).toEqual(false);
    expect(close2PromiseResolver.isSettled()).toEqual(false);

    throwAuthorizationErrorByAccountId.set(account2Id, true);

    webSocket1.send(
        JSON.stringify(
            TestMessageFromClientSchema.serialize({
                type: "ProcedureRequest",
                requestId: request3Id,
                input: {type: "sendEventToOthers"},
                tracerContext: null,
            }),
        ),
    );

    await request3PromiseResolver.promise;
    await ProcessContextModule.waitForTestTasks();

    expect(authorizationCountByAccountId).toEqual(
        new Map([
            [account1Id, 3],
            [account2Id, 3],
        ]),
    );

    expect(messages1).toEqual([
        {
            type: "ProcedureResponse",
            requestId: request1Id,
            result: {ok: true, output: {type: "sendEventToOthers"}},
        },
        {
            type: "ProcedureResponse",
            requestId: request2Id,
            result: {ok: true, output: {type: "sendEventToOthers"}},
        },
        {
            type: "ProcedureResponse",
            requestId: request3Id,
            result: {ok: true, output: {type: "sendEventToOthers"}},
        },
    ]);

    expect(messages2).toEqual([
        {
            type: "Event",
            event: {type: "Test"},
        },
        {
            type: "Event",
            event: {type: "Test"},
        },
        {
            type: "ClosingWithError",
            error: authorizationError,
        },
    ]);

    expect(close1PromiseResolver.isSettled()).toEqual(false);
    expect(close2PromiseResolver.isSettled()).toEqual(true);
});
