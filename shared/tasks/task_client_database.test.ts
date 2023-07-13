import {Fragment, Slice} from "prosemirror-model";
import {EditorState} from "prosemirror-state";
import {ReplaceStep} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {prosemirrorToYXmlFragment, ySyncPlugin} from "y-prosemirror";
import * as Y from "yjs";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/task_action_model.js";
import {TaskClientDatabase} from "~/shared/tasks/task_client_database.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskAccountModel, TaskDateModel, TaskModel} from "~/shared/tasks/task_model.js";
import {
    TaskTitle,
    TaskTitleProsemirrorSchema,
    TaskTitleUpdate,
    emptyTaskTitle,
    getTaskTitleProsemirrorNode,
} from "~/shared/tasks/task_title.js";

const accountCreatedTime = new Date("2023-07-10T21:06:29.897Z");

function asTaskAccountModel(account: AccountModel): TaskAccountModel {
    return new TaskAccountModel({
        staleAccount: account,
        accountName: account.name,
    });
}

const account1 = asTaskAccountModel(
    new AccountModel({id: generateId(), name: "Test 1", createdTime: accountCreatedTime}),
);
const account2 = asTaskAccountModel(
    new AccountModel({id: generateId(), name: "Test 2", createdTime: accountCreatedTime}),
);

const createdTime1 = new TaskDateModel({
    absoluteTime: new Date("2023-07-12T21:06:52.460Z"),
    setterTimeZone: defaultTimeZone,
});

const createdTime2 = new TaskDateModel({
    absoluteTime: new Date("2023-07-11T21:07:11.096Z"),
    setterTimeZone: defaultTimeZone,
});

const createdTime3 = new TaskDateModel({
    absoluteTime: createdTime1.absoluteTime,
    setterTimeZone: assertTimeZone("America/Denver"),
});

const taskId = generateId<TaskId>();
const taskCollectionId1 = generateId<TaskCollectionId>();
const taskCollectionId2 = generateId<TaskCollectionId>();

function generateTaskTitleUpdates() {
    function textSlice(text: string) {
        if (text.length === 0) return Slice.empty;
        return new Slice(Fragment.from(TaskTitleProsemirrorSchema.text(text)), 0, 0);
    }

    const node = TaskTitleProsemirrorSchema.node("doc", {}, []);
    const doc = new Y.Doc();
    const xmlFragment = doc.getXmlFragment("doc");
    prosemirrorToYXmlFragment(node, xmlFragment);

    const updates: Array<TaskTitleUpdate> = [];

    doc.on("updateV2", update => {
        updates.push(update);
    });

    const view = new EditorView(document.createElement("div"), {
        state: EditorState.create({
            schema: TaskTitleProsemirrorSchema,
            plugins: [ySyncPlugin(xmlFragment)],
        }),
    });

    const title0 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(0, 0, textSlice("h"))));
    const title1 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(1, 1, textSlice("e"))));
    const title2 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(2, 2, textSlice("llo"))));
    const title3 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(0, 1, textSlice("H"))));
    const title4 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;

    assert(updates.length === 4);

    return {
        title0,
        update0: updates[0]!,
        title1,
        update1: updates[1]!,
        title2,
        update2: updates[2]!,
        title3,
        update3: updates[3]!,
        title4,
    };
}

const titles = generateTaskTitleUpdates();

const testCases: Array<{
    name: string;
    actions: Array<TaskActionModel>;
    task: TaskModel | {new (...args: Array<any>): Error};
}> = [
    {
        name: "create task",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.empty,
        }),
    },
    {
        name: "create task incompatible accounts",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "Create",
                creator: account2,
                createdTime: createdTime1,
            },
        ],
        task: FailedPreconditionError,
    },
    {
        name: "create task incompatible absolute created time",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime2,
            },
        ],
        task: FailedPreconditionError,
    },
    {
        name: "create task incompatible setter created time zone",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime3,
            },
        ],
        task: FailedPreconditionError,
    },
    {
        name: "update task title (1x)",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateTitle",
                titleUpdate: titles.update0,
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: titles.title1,
            collections: TaskCollectionSet.empty,
        }),
    },
    {
        name: "update task title (2x)",
        actions: [
            {
                type: "Create",
                creator: account2,
                createdTime: createdTime1,
            },
            {
                type: "UpdateTitle",
                titleUpdate: titles.update0,
            },
            {
                type: "UpdateTitle",
                titleUpdate: titles.update1,
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account2,
            createdTime: createdTime1,
            title: titles.title2,
            collections: TaskCollectionSet.empty,
        }),
    },
    {
        name: "update task title (4x)",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime2,
            },
            {
                type: "UpdateTitle",
                titleUpdate: titles.update0,
            },
            {
                type: "UpdateTitle",
                titleUpdate: titles.update1,
            },
            {
                type: "UpdateTitle",
                titleUpdate: titles.update2,
            },
            {
                type: "UpdateTitle",
                titleUpdate: titles.update3,
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime2,
            title: titles.title4,
            collections: TaskCollectionSet.empty,
        }),
    },
    {
        name: "add and remove collection",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId2,
                    orderKey: assertOrderKey("a1"),
                    updatedTime: new Date("2023-07-13T15:22:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Delete",
                    collectionId: taskCollectionId1,
                    updatedTime: new Date("2023-07-13T15:23:45.430Z"),
                },
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.schema.deserialize([
                [
                    taskCollectionId1,
                    {
                        type: "Absent",
                        updatedTime: "2023-07-13T15:23:45.430Z",
                    },
                ],
                [
                    taskCollectionId2,
                    {
                        type: "Present",
                        updatedTime: "2023-07-13T15:22:45.430Z",
                        orderKey: "a1",
                    },
                ],
            ]),
        }),
    },
    {
        name: "add, remove, and add collection",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Delete",
                    collectionId: taskCollectionId1,
                    updatedTime: new Date("2023-07-13T15:22:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:23:45.430Z"),
                },
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.schema.deserialize([
                [
                    taskCollectionId1,
                    {
                        type: "Present",
                        updatedTime: "2023-07-13T15:23:45.430Z",
                        orderKey: "a0",
                    },
                ],
            ]),
        }),
    },
    {
        name: "collection updated time conflict, remove wins",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Delete",
                    collectionId: taskCollectionId1,
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.schema.deserialize([
                [
                    taskCollectionId1,
                    {
                        type: "Absent",
                        updatedTime: "2023-07-13T15:21:45.430Z",
                    },
                ],
            ]),
        }),
    },
    {
        name: "collection updated time conflict, higher order key wins",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a1"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.schema.deserialize([
                [
                    taskCollectionId1,
                    {
                        type: "Present",
                        updatedTime: "2023-07-13T15:21:45.430Z",
                        orderKey: "a1",
                    },
                ],
            ]),
        }),
    },
];

/**
 * Generate all the permutations of an array. Derived from [StackOverflow][1].
 *
 * [1]: https://stackoverflow.com/a/20871714/1568890
 */
function permutator<Item>(inputArray: ReadonlyArray<Item>): Array<Array<Item>> {
    const results: Array<Array<Item>> = [];

    const permute = (array: ReadonlyArray<Item>, result: Array<Item> = []) => {
        if (array.length === 0) {
            results.push(result);
        } else {
            for (let i = 0; i < array.length; i++) {
                const remainingArray = array.slice();
                const additionalResult = remainingArray.splice(i, 1);
                permute(remainingArray.slice(), result.concat(additionalResult));
            }
        }
    };

    permute(inputArray);

    return results;
}

for (const testCase of testCases) {
    describe(`${testCase.name}`, () => {
        const actionIndexes = testCase.actions.map((action, index) => index);
        const actionIndexesWithDuplicates = actionIndexes.map(index => [...actionIndexes, index]);

        const permutations = [
            ...permutator(actionIndexes),
            ...actionIndexesWithDuplicates.flatMap(permutator),
        ];

        const uniquePermutationStrings = new Set(
            permutations.map(permutation => JSON.stringify(permutation)),
        );

        for (const permutationString of uniquePermutationStrings) {
            const permutation: Array<number> = JSON.parse(permutationString);

            test(`[${permutation.join(", ")}]`, () => {
                if ("prototype" in testCase.task && testCase.task.prototype instanceof Error) {
                    expect(() => {
                        permutation.reduce(
                            (database, actionIndex) =>
                                database.applyTaskAction(taskId, testCase.actions[actionIndex]!),
                            TaskClientDatabase.empty,
                        );
                    }).toThrow(testCase.task);
                } else {
                    let database = TaskClientDatabase.empty;

                    database = permutation.reduce(
                        (database, actionIndex) =>
                            database.applyTaskAction(taskId, testCase.actions[actionIndex]!),
                        database,
                    );

                    const actualTask = database.getTask(taskId);
                    const expectedTask = testCase.task as TaskModel;

                    expect({
                        ...actualTask,
                        title: getTaskTitleProsemirrorNode(actualTask.title).toJSON(),
                    }).toEqual({
                        ...expectedTask,
                        title: getTaskTitleProsemirrorNode(expectedTask.title).toJSON(),
                    });
                }
            });
        }
    });
}
