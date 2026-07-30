import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    SiteId,
    SiteSideBarId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {printSiteContainerId} from "~/shared/sites/site_entry_id.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {
    TaskActionMaybeModel,
    TaskUpdateTaskActionMaybeModel,
} from "~/shared/tasks/actions/task_action_model.js";
import {TaskCollectionAction} from "~/shared/tasks/actions/task_collection_action.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

const clock = new HybridLogicalClock(unsynchronizedSystemClock);

const localAccessPolicy: CreateOrUpdateAccessPolicy = {
    type: "Local",
    accountGrantById: new Map(),
    defaultGrant: {level: "Manage", generation: 0},
    urlGrant: null,
};

function createTestSiteAccessPolicy(siteId: SiteId): CreateOrUpdateAccessPolicy {
    return {
        type: "Site",
        siteId,
        position: {
            parentId: printSiteContainerId({type: "SideBar", id: generateId<SiteSideBarId>()}),
            orderKey: assertOrderKey("a0"),
        },
    };
}

function createTestFilterableTime(): TaskFilterableTime {
    return new TaskFilterableTime({absoluteTime: clock.now(), setterTimeZone: defaultTimeZone});
}

function createTestUpdateTaskAction(
    taskAction: TaskUpdateTaskActionMaybeModel["taskAction"],
): Extract<TaskActionMaybeModel, {readonly type: "UpdateTask"}> {
    return {
        type: "UpdateTask",
        time: clock.now(),
        taskId: generateId<TaskId>(),
        taskAction,
    };
}

function createTestUpdateCollectionAction(
    collectionAction: TaskCollectionAction,
): Extract<TaskActionMaybeModel, {readonly type: "UpdateCollection"}> {
    return {
        type: "UpdateCollection",
        time: clock.now(),
        collectionId: generateId<TaskCollectionId>(),
        collectionAction,
    };
}

function collectIds(action: TaskActionMaybeModel) {
    const accountIds = new Set<AccountId>();
    const siteIds = new Set<SiteId>();

    collectReferencedIdsFromTaskAction(accountIds, siteIds, action);

    return {accountIds, siteIds};
}

test("collects the creator account id from a create action", () => {
    const creatorId = generateId<AccountId>();

    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "Create",
            creator: {accountId: creatorId, from: null},
            creatorTimeZone: defaultTimeZone,
        }),
    );

    expect(ids).toEqual({accountIds: new Set([creatorId]), siteIds: new Set()});
});

test("doesn\u2019t collect an unknown creator account id from a create action", () => {
    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "Create",
            creator: {accountId: unknownAccountId, from: null},
            creatorTimeZone: defaultTimeZone,
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("collects the site id from a create action with a site access policy", () => {
    const creatorId = generateId<AccountId>();
    const siteId = generateId<SiteId>();

    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "Create",
            creator: {accountId: creatorId, from: null},
            creatorTimeZone: defaultTimeZone,
            accessPolicy: createTestSiteAccessPolicy(siteId),
        }),
    );

    expect(ids).toEqual({accountIds: new Set([creatorId]), siteIds: new Set([siteId])});
});

test("doesn\u2019t collect site ids from a create action with a local access policy", () => {
    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "Create",
            creator: {accountId: generateId<AccountId>(), from: null},
            creatorTimeZone: defaultTimeZone,
            accessPolicy: localAccessPolicy,
        }),
    );

    expect(ids.siteIds).toEqual(new Set());
});

test("collects the closer account id from an update status action closing the task", () => {
    const closerId = generateId<AccountId>();

    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "UpdateStatus",
            status: {type: "Closed", closerId, closedTime: createTestFilterableTime()},
        }),
    );

    expect(ids).toEqual({accountIds: new Set([closerId]), siteIds: new Set()});
});

test("doesn\u2019t collect an unknown closer account id from an update status action", () => {
    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "UpdateStatus",
            status: {
                type: "Closed",
                closerId: unknownAccountId,
                closedTime: createTestFilterableTime(),
            },
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("doesn\u2019t collect account ids from an update status action opening the task", () => {
    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "UpdateStatus",
            status: {type: "Open"},
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("collects the assignee and assigner account ids from an update assignee action", () => {
    const assigneeId = generateId<AccountId>();
    const assignerId = generateId<AccountId>();

    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "UpdateAssignee",
            assignee: {assigneeId, assignerId, assignedTime: createTestFilterableTime()},
        }),
    );

    expect(ids).toEqual({accountIds: new Set([assigneeId, assignerId]), siteIds: new Set()});
});

test("doesn\u2019t collect unknown account ids from an update assignee action", () => {
    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "UpdateAssignee",
            assignee: {
                assigneeId: unknownAccountId,
                assignerId: unknownAccountId,
                assignedTime: createTestFilterableTime(),
            },
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("doesn\u2019t collect account ids from an update assignee action removing the assignee", () => {
    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "UpdateAssignee",
            assignee: null,
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("collects the site id from an update access policy action with a site access policy", () => {
    const siteId = generateId<SiteId>();

    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "UpdateAccessPolicy",
            accessPolicy: createTestSiteAccessPolicy(siteId),
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set([siteId])});
});

test("doesn\u2019t collect site ids from an update access policy action with a local access policy", () => {
    const ids = collectIds(
        createTestUpdateTaskAction({
            type: "UpdateAccessPolicy",
            accessPolicy: localAccessPolicy,
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("doesn\u2019t collect ids from task actions without account or site references", () => {
    const ids = collectIds(createTestUpdateTaskAction({type: "Delete"}));

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("doesn\u2019t collect action actor account ids from a task action", () => {
    const accountId = generateId<AccountId>();
    const botAccountId = generateId<AccountId>();

    const ids = collectIds({
        ...createTestUpdateTaskAction({type: "Delete"}),
        actor: {
            accountId,
            from: {type: "Bot", accountId: botAccountId},
        },
    });

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("doesn\u2019t collect unknown action actor account ids from a task action", () => {
    const ids = collectIds({
        ...createTestUpdateTaskAction({type: "Delete"}),
        actor: {
            accountId: unknownAccountId,
            from: {type: "Bot", accountId: unknownAccountId},
        },
    });

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("collects the site id from a create collection action with a site access policy", () => {
    const siteId = generateId<SiteId>();

    const ids = collectIds(
        createTestUpdateCollectionAction({
            type: "Create",
            creator: null,
            name: "Test",
            accessPolicy: createTestSiteAccessPolicy(siteId),
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set([siteId])});
});

test("doesn\u2019t collect site ids from a create collection action with a local access policy", () => {
    const ids = collectIds(
        createTestUpdateCollectionAction({
            type: "Create",
            creator: null,
            name: "Test",
            accessPolicy: localAccessPolicy,
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("collects the site id from an update collection access policy action with a site access policy", () => {
    const siteId = generateId<SiteId>();

    const ids = collectIds(
        createTestUpdateCollectionAction({
            type: "UpdateAccessPolicy",
            accessPolicy: createTestSiteAccessPolicy(siteId),
        }),
    );

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set([siteId])});
});

test("doesn\u2019t collect ids from collection actions without site references", () => {
    const ids = collectIds(createTestUpdateCollectionAction({type: "Delete"}));

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("doesn\u2019t collect action actor account ids from a collection action", () => {
    const accountId = generateId<AccountId>();
    const botAccountId = generateId<AccountId>();

    const ids = collectIds({
        ...createTestUpdateCollectionAction({type: "Delete"}),
        actor: {
            accountId,
            from: {type: "Bot", accountId: botAccountId},
        },
    });

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("collects the account id from an update account name action", () => {
    const accountId = generateId<AccountId>();

    const ids = collectIds({
        type: "UpdateAccountName",
        time: clock.now(),
        accountId,
        accountName: "Test Account",
        accountNameVersion: 1,
    });

    expect(ids).toEqual({accountIds: new Set([accountId]), siteIds: new Set()});
});

test("doesn\u2019t collect an unknown account id from an update account name action", () => {
    const ids = collectIds({
        type: "UpdateAccountName",
        time: clock.now(),
        accountId: unknownAccountId,
        accountName: "Test Account",
        accountNameVersion: 1,
    });

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});

test("doesn\u2019t collect ids from an update notepad page action", () => {
    const ids = collectIds({type: "UpdateNotepadPage", time: clock.now()});

    expect(ids).toEqual({accountIds: new Set(), siteIds: new Set()});
});
