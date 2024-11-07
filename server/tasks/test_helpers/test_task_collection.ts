import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {
    TaskCollectionEssentialAttributesItem,
    commitTaskActionTransaction,
    getTaskCollectionItemForTest,
} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {
    TaskCollectionAccessLevel,
    TaskCollectionAccessPolicy,
} from "~/shared/tasks/task_collection_access_policy.js";

let testTaskCollectionCount = 1;

export class TestTaskCollection {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: TaskCollectionId;
    public readonly createdTime: HybridLogicalTime;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: TaskCollectionId,
        createdTime: HybridLogicalTime,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this.createdTime = createdTime;
    }

    public static getNewName() {
        return `Test Collection ${testTaskCollectionCount++}`;
    }

    public static async createPrivate(
        session: TestSpaceSession,
        {
            name = TestTaskCollection.getNewName(),
            otherGrantedAccounts = [],
        }: {
            name?: string;
            otherGrantedAccounts?: ReadonlyArray<TestSession | TestAccount>;
        } = {},
    ) {
        const id = generateId<TaskCollectionId>();

        const time = testClock.nowLogical();

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time,
                collectionId: id,
                collectionAction: {
                    type: "Create",
                    creatorId: session.account.id,
                    name,
                    accessPolicy: {
                        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
                            [session.account.id, {level: "Manage"}],
                            ...otherGrantedAccounts.map(
                                account =>
                                    [
                                        account instanceof TestSession
                                            ? account.account.id
                                            : account.id,
                                        {level: "Edit"},
                                    ] as const,
                            ),
                        ]),
                        defaultGrant: null,
                    },
                },
            },
        ]);

        return new TestTaskCollection(session.context, session.space, id, time);
    }

    public static async createPublic(
        session: TestSpaceSession,
        {name = TestTaskCollection.getNewName()}: {name?: string} = {},
    ) {
        const id = generateId<TaskCollectionId>();

        const time = testClock.nowLogical();

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time,
                collectionId: id,
                collectionAction: {
                    type: "Create",
                    creatorId: session.account.id,
                    name,
                    accessPolicy: {
                        accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                },
            },
        ]);

        return new TestTaskCollection(session.context, session.space, id, time);
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

    public async updateColor(session: TestSpaceSession, color: ThemeColor | null) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: this.id,
                collectionAction: {
                    type: "UpdateColor",
                    color,
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

    public async setPrivateAccessPolicy(
        session: TestSpaceSession,
        {
            otherGrantedAccounts = [],
        }: {
            otherGrantedAccounts?: ReadonlyArray<TestSession | TestAccount>;
        } = {},
    ) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateCollection",
                time: testClock.nowLogical(),
                collectionId: this.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
                            [session.account.id, {level: "Manage"}],
                            ...otherGrantedAccounts.map(
                                account =>
                                    [
                                        account instanceof TestSession
                                            ? account.account.id
                                            : account.id,
                                        {level: "Edit"},
                                    ] as const,
                            ),
                        ]),
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
