import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {MyAccountDurableObject} from "~/server/notifications/my_account/my_account_durable_object.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";

const baseContext = createTestWorkerContext();

// eslint-disable-next-line @typescript-eslint/unbound-method
const originalAction = baseContext.action;
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalSystemAction = baseContext.systemAction;

const context = Object.assign(baseContext, {
    action: function (session, options?) {
        return originalAction.call(this, session, options).clone({
            rpc: new LocalRpcContextModule(),
        });
    },
    systemAction: function (spaceId, options?) {
        return originalSystemAction.call(this, spaceId, options).clone({
            rpc: new LocalRpcContextModule(),
        });
    },
} satisfies Partial<TestContext>);

const {fetchForTest, connectForTest} = MyAccountDurableObject.test(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const otherSpace = createTestSpace(context);

test("can not connect", async () => {
    await connectForTest(context.action(session1), session1.accountId);
});

test("can not connect as the wrong account", async () => {
    await expect(connectForTest(context.action(session2), session1.accountId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect after initialization as the wrong account", async () => {
    await connectForTest(context.action(session1), session1.accountId);

    await expect(connectForTest(context.action(session2), session1.accountId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can broadcast realtime events as session actor", async () => {
    await fetchForTest(
        context.action(session1, {serviceName: "AppService"}),
        session1.accountId,
        new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                readTime: new Date(),
                eventTransaction: [],
            }),
        }),
    );
});

test("can broadcast realtime events as system actor", async () => {
    await fetchForTest(
        context.systemAction(space.id, {serviceName: "AppService"}),
        session1.accountId,
        new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                readTime: new Date(),
                eventTransaction: [],
            }),
        }),
    );
});

test("can broadcast realtime events as session actor after initialization", async () => {
    await connectForTest(context.action(session1), session1.accountId);

    await fetchForTest(
        context.action(session1, {serviceName: "AppService"}),
        session1.accountId,
        new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                readTime: new Date(),
                eventTransaction: [],
            }),
        }),
    );
});

test("can broadcast realtime events as system actor after initialization", async () => {
    await connectForTest(context.action(session1), session1.accountId);

    await fetchForTest(
        context.systemAction(space.id, {serviceName: "AppService"}),
        session1.accountId,
        new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                readTime: new Date(),
                eventTransaction: [],
            }),
        }),
    );
});

test("can’t broadcast realtime events from session actor from `AppClient`", async () => {
    await expect(
        fetchForTest(
            context.action(session1, {serviceName: "AppClient"}),
            session1.accountId,
            new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    readTime: new Date(),
                    eventTransaction: [],
                }),
            }),
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        fetchForTest(
            context.systemAction(space.id, {serviceName: "AppClient"}),
            session1.accountId,
            new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    readTime: new Date(),
                    eventTransaction: [],
                }),
            }),
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can’t broadcast realtime events from system actor from `TaskRealtimeService`", async () => {
    await expect(
        fetchForTest(
            context.systemAction(space.id, {serviceName: "TaskRealtimeService"}),
            session1.accountId,
            new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    readTime: new Date(),
                    eventTransaction: [],
                }),
            }),
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not broadcast realtime events as wrong space", async () => {
    await expect(
        fetchForTest(
            context.systemAction(otherSpace.id, {serviceName: "AppService"}),
            session1.accountId,
            new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    readTime: new Date(),
                    eventTransaction: [],
                }),
            }),
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not broadcast realtime events as wrong space after initialization", async () => {
    await connectForTest(context.action(session1), session1.accountId);

    await expect(
        fetchForTest(
            context.systemAction(otherSpace.id, {serviceName: "AppService"}),
            session1.accountId,
            new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    readTime: new Date(),
                    eventTransaction: [],
                }),
            }),
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not broadcast realtime events as wrong space multiple times after initialization", async () => {
    await connectForTest(context.action(session1), session1.accountId);

    await fetchForTest(
        context.systemAction(space.id, {serviceName: "AppService"}),
        session1.accountId,
        new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                readTime: new Date(),
                eventTransaction: [],
            }),
        }),
    );

    await expect(
        fetchForTest(
            context.systemAction(otherSpace.id, {serviceName: "AppService"}),
            session1.accountId,
            new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    readTime: new Date(),
                    eventTransaction: [],
                }),
            }),
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        fetchForTest(
            context.systemAction(otherSpace.id, {serviceName: "AppService"}),
            session1.accountId,
            new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    readTime: new Date(),
                    eventTransaction: [],
                }),
            }),
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await fetchForTest(
        context.systemAction(space.id, {serviceName: "AppService"}),
        session1.accountId,
        new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                readTime: new Date(),
                eventTransaction: [],
            }),
        }),
    );

    await expect(
        fetchForTest(
            context.systemAction(otherSpace.id, {serviceName: "AppService"}),
            session1.accountId,
            new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    readTime: new Date(),
                    eventTransaction: [],
                }),
            }),
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await fetchForTest(
        context.systemAction(space.id, {serviceName: "AppService"}),
        session1.accountId,
        new Request("http://localhost/broadcast-inbox-realtime-event-transaction", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                readTime: new Date(),
                eventTransaction: [],
            }),
        }),
    );
});
