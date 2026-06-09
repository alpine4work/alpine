import {TestAccessPolicy} from "~/server/access/test_helpers/test_access_policy.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {TaskCollectionEssentialAttributesItem} from "~/server/tasks/data/internal/task_table.js";
import {getTaskCollectionItemForTest} from "~/server/tasks/data/test_helpers/get_task_collection_item_for_test.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SiteTopBarId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

let testTaskCollectionCount = 1;

export class TestTaskCollection {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: TaskCollectionId;
    public readonly createdTime: HybridLogicalTime;
    public readonly initialName: string;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: TaskCollectionId,
        createdTime: HybridLogicalTime,
        initialName: string,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this.createdTime = createdTime;
        this.initialName = initialName;
    }

    public static getNewName() {
        return `Test Collection ${testTaskCollectionCount++}`;
    }

    public static async create(
        session: TestSpaceSession,
        {
            name = TestTaskCollection.getNewName(),
            access,
            color = null,
        }: {
            name?: string;
            access?: "Public" | "Private" | CreateOrUpdateAccessPolicy;
            color?: ThemeColor | null;
        } = {},
    ) {
        const id = generateId<TaskCollectionId>();

        const time = testTaskClock.now();

        let accessPolicy: CreateOrUpdateAccessPolicy;
        if (access === "Public") {
            accessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: {level: "Manage", generation: 1},
                urlGrant: null,
            };
        } else if (access === "Private" || access === undefined) {
            accessPolicy = {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            };
        } else {
            accessPolicy = access;
        }

        const actions: Array<TaskAction> = [
            {
                type: "UpdateCollection",
                time,
                collectionId: id,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session.account.id, from: null},
                    name,
                    accessPolicy:
                        accessPolicy.type === "Site"
                            ? {
                                  ...accessPolicy,
                                  position: accessPolicy.position ?? {
                                      parentId: `TopBar:${generateId<SiteTopBarId>()}`,
                                      orderKey: initialOrderKey,
                                  },
                              }
                            : accessPolicy,
                },
            },
        ];

        if (color !== null) {
            actions.push({
                type: "UpdateCollection",
                time: testTaskClock.now(),
                collectionId: id,
                collectionAction: {
                    type: "UpdateColor",
                    color,
                },
            });
        }

        await commitTaskActionTransaction(session.action(), session.space.id, actions);

        return new TestTaskCollection(session.context, session.space, id, time, name);
    }

    public getItem(): Promise<TaskCollectionEssentialAttributesItem> {
        return getTaskCollectionItemForTest(this.context, this.id);
    }

    public readonly access = new TestAccessPolicy({
        get: async () => {
            const item = await this.getItem();
            return item.accessPolicy.value;
        },
        set: async (session, accessPolicy) => {
            await commitTaskActionTransaction(session.action(), session.space.id, [
                {
                    type: "UpdateCollection",
                    time: testTaskClock.now(),
                    collectionId: this.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy,
                    },
                },
            ]);
        },
    });

    public async delete(session: TestSpaceSession) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateCollection",
                time: testTaskClock.now(),
                collectionId: this.id,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);
    }

    public async undelete(session: TestSpaceSession) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateCollection",
                time: testTaskClock.now(),
                collectionId: this.id,
                collectionAction: {
                    type: "Undelete",
                },
            },
        ]);
    }

    public async updateName(session: TestSpaceSession, name: string) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateCollection",
                time: testTaskClock.now(),
                collectionId: this.id,
                collectionAction: {
                    type: "UpdateName",
                    name,
                },
            },
        ]);
    }

    public async updateColor(session: TestSpaceSession, color: ThemeColor | null) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateCollection",
                time: testTaskClock.now(),
                collectionId: this.id,
                collectionAction: {
                    type: "UpdateColor",
                    color,
                },
            },
        ]);
    }
}
