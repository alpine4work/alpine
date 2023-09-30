import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {
    TaskCollectionEssentialAttributesItem,
    commitTaskActionTransaction,
    getTaskCollectionItemForTest,
} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskCollectionAccessPolicy} from "~/shared/tasks/task_collection_access_policy.js";

let testTaskCollectionCount = 1;

export class TestTaskCollection {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: TaskCollectionId;

    private constructor(context: TestContext, space: TestSpace, id: TaskCollectionId) {
        this.context = context;
        this.space = space;
        this.id = id;
    }

    public static async createPrivate(session: TestSpaceSession) {
        const id = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: id,
                collectionAction: {
                    type: "Create",
                    name: `Test Collection ${testTaskCollectionCount++}`,
                    accessPolicy: {
                        accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
        ]);

        return new TestTaskCollection(session.context, session.space, id);
    }

    public static async createPublic(session: TestSpaceSession) {
        const id = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: id,
                collectionAction: {
                    type: "Create",
                    name: "Test",
                    accessPolicy: {
                        accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                },
            },
        ]);

        return new TestTaskCollection(session.context, session.space, id);
    }

    public getItem(): Promise<TaskCollectionEssentialAttributesItem> {
        return getTaskCollectionItemForTest(this.context, this.id);
    }

    public async delete(session: TestSpaceSession) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: this.id,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);
    }

    public async undelete(session: TestSpaceSession) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: this.id,
                collectionAction: {
                    type: "Undelete",
                },
            },
        ]);
    }

    public async updateName(session: TestSpaceSession, name: string) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: this.id,
                collectionAction: {
                    type: "UpdateName",
                    name,
                },
            },
        ]);
    }

    public async updateAccessPolicy(
        session: TestSpaceSession,
        accessPolicy: TaskCollectionAccessPolicy,
    ) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: this.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy,
                },
            },
        ]);
    }

    public async setPrivateAccessPolicy(session: TestSpaceSession) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: this.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
        ]);
    }

    public async setPublicAccessPolicy(session: TestSpaceSession) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: this.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                },
            },
        ]);
    }
}
