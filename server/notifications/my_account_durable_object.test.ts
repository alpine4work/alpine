import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {MyAccountDurableObject} from "~/server/notifications/my_account_durable_object.js";
import {PermissionDeniedError} from "~/shared/error/error.js";

const context = createTestContext();
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

test("can broadcast realtime events", async () => {
    await fetchForTest(
        context.systemAction(space.id),
        session1.accountId,
        new Request("http://localhost/inbox-realtime-event-transaction", {
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

test("can not broadcast realtime events as session", async () => {
    await expect(
        fetchForTest(
            context.action(session1),
            session1.accountId,
            new Request("http://localhost/inbox-realtime-event-transaction", {
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
            context.systemAction(otherSpace.id),
            session1.accountId,
            new Request("http://localhost/inbox-realtime-event-transaction", {
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

test("can not broadcast realtime events as session after initialization", async () => {
    await connectForTest(context.action(session1), session1.accountId);

    await expect(
        fetchForTest(
            context.action(session1),
            session1.accountId,
            new Request("http://localhost/inbox-realtime-event-transaction", {
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
            context.systemAction(otherSpace.id),
            session1.accountId,
            new Request("http://localhost/inbox-realtime-event-transaction", {
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
        context.systemAction(space.id),
        session1.accountId,
        new Request("http://localhost/inbox-realtime-event-transaction", {
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
            context.systemAction(otherSpace.id),
            session1.accountId,
            new Request("http://localhost/inbox-realtime-event-transaction", {
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
            context.systemAction(otherSpace.id),
            session1.accountId,
            new Request("http://localhost/inbox-realtime-event-transaction", {
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
        context.systemAction(space.id),
        session1.accountId,
        new Request("http://localhost/inbox-realtime-event-transaction", {
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
            context.systemAction(otherSpace.id),
            session1.accountId,
            new Request("http://localhost/inbox-realtime-event-transaction", {
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
        context.systemAction(space.id),
        session1.accountId,
        new Request("http://localhost/inbox-realtime-event-transaction", {
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
