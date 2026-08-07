import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskAccessPolicyForBotScope} from "~/server/tasks/data/get_task_access_policy_for_bot_scope.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("`getTaskAccessPolicyForBotScope()`", () => {
    test("can get access policy for scoped task", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                botAccount.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual(
            expect.objectContaining({
                accountGrantById: new Map([
                    [session.account.id, expect.objectContaining({level: "Manage"})],
                ]),
            }),
        );
    });

    test("can\u2019t get access policy for scoped task other than the one scoped", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);
        const otherTask = await TestTask.create(session);
        await otherTask.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(
                botAccount.action({type: "Task", taskId: task.id}),
                otherTask.id,
            ),
        ).rejects.toThrow("Can only get access policy for the scoped task");
    });

    test("can\u2019t get access policy with space scope", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(botAccount.action({type: "Space"}), task.id),
        ).rejects.toThrow("Can only get access policy for the scoped task");
    });

    test("can\u2019t get access policy with space scope even if task is shared with space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Public"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(botAccount.action({type: "Space"}), task.id),
        ).rejects.toThrow("Can only get access policy for the scoped task");
    });

    test("can\u2019t get access policy with account scope even if account has access to task", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(
                botAccount.action({type: "Account", accountId: session.account.id}),
                task.id,
            ),
        ).rejects.toThrow("Can only get access policy for the scoped task");
    });

    test("can\u2019t get access policy for task in different space even if scope declares access", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const otherSession = await otherSpace.createSession({role: "Admin"});
        const otherBotAccount = await TestBot.createAndInstantiate(otherSession);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(
                otherBotAccount.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });

    test("can\u2019t get access policy for task which doesn\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const taskId = generateId<TaskId>();

        await expect(
            getTaskAccessPolicyForBotScope(botAccount.action({type: "Task", taskId}), taskId),
        ).rejects.toThrow("Task not found");
    });

    test("default access policy only includes creator", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes assignee", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);
        await task.updateAssignee(session1, session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection = await TestTaskCollection.create(session1, {access: "Private"});
        await collection.access.grant(session1, session2);

        await task.addCollection(session1, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections excluding removed collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);

        await task.removeCollection(session1, collection2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections excluding deleted collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);

        await collection2.delete(session1);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections including undeleted collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);

        await collection2.delete(session1);
        await collection2.undelete(session1);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to collection at right access level", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection = await TestTaskCollection.create(session1, {access: "Private"});
        await collection.access.grant(session1, session2, "View");

        await task.addCollection(session1, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to collection at max access level across collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2, "View");

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session2, "Edit");

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection4.access.grant(session1, session2, "Comment");

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);
        await task.addCollection(session1, collection4);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes default grant in collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        await collection.access.grantDefault(session);

        await task.addCollection(session, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Manage"},
            urlGrant: null,
        });
    });

    test("access policy includes default grant in collection at correct access level", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        await collection.access.grantDefault(session, "View");

        await task.addCollection(session, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        });
    });

    test("access policy includes default grant in collection at max access level across collections", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantDefault(session, "View");

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});
        await collection2.access.grantDefault(session, "Edit");

        const collection3 = await TestTaskCollection.create(session, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session, {access: "Private"});
        await collection4.access.grantDefault(session, "Comment");

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);
        await task.addCollection(session, collection3);
        await task.addCollection(session, collection4);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        });
    });

    test("access policy excludes default grant from removed collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantDefault(session, "View");

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});
        await collection2.access.grantDefault(session, "Edit");

        const collection3 = await TestTaskCollection.create(session, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session, {access: "Private"});
        await collection4.access.grantDefault(session, "Comment");

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);
        await task.addCollection(session, collection3);
        await task.addCollection(session, collection4);

        await task.removeCollection(session, collection2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        });
    });

    test("access policy excludes default grant from deleted collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantDefault(session, "View");

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});
        await collection2.access.grantDefault(session, "Edit");

        const collection3 = await TestTaskCollection.create(session, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session, {access: "Private"});
        await collection4.access.grantDefault(session, "Comment");

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);
        await task.addCollection(session, collection3);
        await task.addCollection(session, collection4);

        await collection2.delete(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        });
    });

    test("access policy includes default grant from undeleted collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantDefault(session, "View");

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});
        await collection2.access.grantDefault(session, "Edit");

        const collection3 = await TestTaskCollection.create(session, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session, {access: "Private"});
        await collection4.access.grantDefault(session, "Comment");

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);
        await task.addCollection(session, collection3);
        await task.addCollection(session, collection4);

        await collection2.delete(session);
        await collection2.undelete(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        });
    });

    test("access policy includes url grant in collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        await collection.access.grantUrl(session);

        await task.addCollection(session, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        });
    });

    test("access policy includes url grant in collection even if only one collection has url grant", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantUrl(session);

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        });
    });

    test("access policy excludes url grant from removed collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantUrl(session);

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);

        await task.removeCollection(session, collection1);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy excludes url grant from deleted collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantUrl(session);

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);

        await collection1.delete(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy excludes url grant from undeleted collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantUrl(session);

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);

        await collection1.delete(session);
        await collection1.undelete(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        });
    });

    test("access policy includes parent task creator", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);
        const bot = await TestBot.createAndInstantiate(session1);

        const collection = await TestTaskCollection.create(session2, {access: "Public"});

        const task = await TestTask.create(session2);
        await task.addCollection(session2, collection);

        const parentTask = await TestTask.create(session3);
        await task.updateParentTask(session3, parentTask);

        await task.removeCollection(session2, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes parent task assignee", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask = await TestTask.create(session2);
        await parentTask.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes parent task creator recursively", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const collection = await TestTaskCollection.create(session2, {access: "Public"});

        const task = await TestTask.create(session2);
        await task.addCollection(session2, collection);

        const parentTask1 = await TestTask.create(session3);
        await parentTask1.addCollection(session3, collection);
        await task.updateParentTask(session3, parentTask1);

        const parentTask2 = await TestTask.create(session4);
        await parentTask2.addCollection(session4, collection);
        await parentTask1.updateParentTask(session4, parentTask2);

        const parentTask3 = await TestTask.create(session5);
        await parentTask2.updateParentTask(session5, parentTask3);

        await task.removeCollection(session2, collection);
        await parentTask1.removeCollection(session2, collection);
        await parentTask2.removeCollection(session2, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes parent task assignee recursively", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections in task parent", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const parentTask = await TestTask.create(session1);
        await task.updateParentTask(session1, parentTask);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await parentTask.addCollection(session1, collection1);
        await parentTask.addCollection(session1, collection2);
        await parentTask.addCollection(session1, collection3);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections in task parent recursively", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const parentTask1 = await TestTask.create(session1);
        await task.updateParentTask(session1, parentTask1);

        const parentTask2 = await TestTask.create(session1);
        await parentTask1.updateParentTask(session1, parentTask2);

        const parentTask3 = await TestTask.create(session1);
        await parentTask2.updateParentTask(session1, parentTask3);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await parentTask1.addCollection(session1, collection1);
        await parentTask2.addCollection(session1, collection2);
        await parentTask3.addCollection(session1, collection3);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy doesn\u2019t include grants from deleted parent task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        await parentTask2.delete(session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes grants from undeleted parent task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        await parentTask2.delete(session2);
        await parentTask2.undelete(session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes old grants when task is deleted", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        await task.delete(session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes grants when task is undeleted", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        await task.delete(session2);
        await task.undelete(session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });
});
