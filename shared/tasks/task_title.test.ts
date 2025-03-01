import * as Y from "yjs";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    TaskTitleModel,
    applyTaskTitleUpdate,
    createTaskTitleFromText,
    emptyTaskTitle,
    emptyTaskTitleModel,
    getTaskTitleText,
    realmTaskTitleClientId,
} from "~/shared/tasks/task_title.js";
import {wordTaskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";

test("can get task title text", () => {
    expect(getTaskTitleText(emptyTaskTitle.get())).toEqual("");
    expect(getTaskTitleText(wordTaskTitleTestScenario.title4)).toEqual("Hello");
    expect(getTaskTitleText(createTaskTitleFromText("abc123"))).toEqual("abc123");
});

test("decoded empty task title is empty", () => {
    expect(Y.decodeUpdateV2(emptyTaskTitle.get())).toEqual({
        structs: [],
        ds: {clients: new Map()},
    });
});

test("noop task title updates", () => {
    expect(emptyTaskTitleModel.get().replace(0, 0, "")).toEqual(null);
    expect(TaskTitleModel.from(wordTaskTitleTestScenario.title4).replace(2, 2, "")).toEqual(null);
});

test("can create task title updates", () => {
    let title = emptyTaskTitleModel.get();

    expect(title.getText()).toEqual("");

    {
        const titleUpdate = assertExists(title.replace(0, 0, "a"));

        expect(Y.decodeUpdateV2(titleUpdate.raw)).toEqual({
            structs: [
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 0),
                    length: 1,
                    origin: null,
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: "doc",
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentType(expect.any(Y.XmlText)),
                    info: 2,
                },
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 1),
                    length: 1,
                    origin: null,
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentString("a"),
                    info: 2,
                },
            ],
            ds: {clients: new Map()},
        });

        title = titleUpdate.newTitle;
    }

    expect(title.getText()).toEqual("a");

    {
        const titleUpdate = assertExists(title.replace(1, 1, "b"));

        expect(Y.decodeUpdateV2(titleUpdate.raw)).toEqual({
            structs: [
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 2),
                    length: 1,
                    origin: new Y.ID(realmTaskTitleClientId.get(), 1),
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: null,
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentString("b"),
                    info: 2,
                },
            ],
            ds: {clients: new Map()},
        });

        title = titleUpdate.newTitle;
    }

    expect(title.getText()).toEqual("ab");

    {
        const titleUpdate = assertExists(title.replace(2, 2, "c"));

        expect(Y.decodeUpdateV2(titleUpdate.raw)).toEqual({
            structs: [
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 3),
                    length: 1,
                    origin: new Y.ID(realmTaskTitleClientId.get(), 2),
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: null,
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentString("c"),
                    info: 2,
                },
            ],
            ds: {clients: new Map()},
        });

        title = titleUpdate.newTitle;
    }

    expect(title.getText()).toEqual("abc");

    {
        const titleUpdate = assertExists(title.replace(3, 3, "123"));

        expect(Y.decodeUpdateV2(titleUpdate.raw)).toEqual({
            structs: [
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 4),
                    length: 3,
                    origin: new Y.ID(realmTaskTitleClientId.get(), 3),
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: null,
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentString("123"),
                    info: 2,
                },
            ],
            ds: {clients: new Map()},
        });

        title = titleUpdate.newTitle;
    }

    expect(title.getText()).toEqual("abc123");

    {
        const titleUpdate = assertExists(title.replace(1, 2, ""));

        expect(Y.decodeUpdateV2(titleUpdate.raw)).toEqual({
            structs: [],
            ds: {clients: new Map([[realmTaskTitleClientId.get(), [{clock: 2, len: 1}]]])},
        });

        title = titleUpdate.newTitle;
    }

    expect(title.getText()).toEqual("ac123");

    {
        const titleUpdate = assertExists(title.replace(1, 2, "C"));

        expect(Y.decodeUpdateV2(titleUpdate.raw)).toEqual({
            structs: [
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 7),
                    length: 1,
                    origin: new Y.ID(realmTaskTitleClientId.get(), 3),
                    left: null,
                    right: null,
                    rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 4),
                    parent: null,
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentString("C"),
                    info: 2,
                },
            ],
            ds: {clients: new Map([[realmTaskTitleClientId.get(), [{clock: 3, len: 1}]]])},
        });

        title = titleUpdate.newTitle;
    }

    expect(title.getText()).toEqual("aC123");

    {
        const titleUpdate = assertExists(title.replace(0, 2, "xyz"));

        expect(Y.decodeUpdateV2(titleUpdate.raw)).toEqual({
            structs: [
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 8),
                    length: 3,
                    origin: new Y.ID(realmTaskTitleClientId.get(), 7),
                    left: null,
                    right: null,
                    rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 4),
                    parent: null,
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentString("xyz"),
                    info: 2,
                },
            ],
            ds: {
                clients: new Map([
                    [
                        realmTaskTitleClientId.get(),
                        [
                            {clock: 1, len: 1},
                            {clock: 7, len: 1},
                        ],
                    ],
                ]),
            },
        });

        title = titleUpdate.newTitle;
    }
});

test("can invert task title updates", () => {
    const title0 = emptyTaskTitleModel.get();
    const update1 = assertExists(title0.replace(0, 0, "a"));
    const title1 = update1.newTitle;
    const update2 = assertExists(title1.replace(1, 1, "b"));
    const title2 = update2.newTitle;
    const update3 = assertExists(title2.replace(2, 2, "c"));
    const title3 = update3.newTitle;
    const update4 = assertExists(title3.replace(1, 2, ""));
    const title4 = update4.newTitle;
    const update5 = assertExists(title4.replace(1, 1, "d"));
    const title5 = update5.newTitle;

    expect(title0.getText()).toEqual("");
    expect(title1.getText()).toEqual("a");
    expect(title2.getText()).toEqual("ab");
    expect(title3.getText()).toEqual("abc");
    expect(title4.getText()).toEqual("ac");
    expect(title5.getText()).toEqual("adc");

    const undoUpdate2OnTitle3 = assertExists(update2.invert(title3));

    expect(undoUpdate2OnTitle3.newTitle.getText()).toEqual("ac");

    expect(Y.decodeUpdateV2(undoUpdate2OnTitle3.raw)).toEqual({
        structs: [],
        ds: {
            clients: new Map([[realmTaskTitleClientId.get(), [{clock: 2, len: 1}]]]),
        },
    });

    const undoUpdate4OnTitle5 = assertExists(update4.invert(title5));

    expect(undoUpdate4OnTitle5.newTitle.getText()).toEqual("abdc");

    expect(Y.decodeUpdateV2(undoUpdate4OnTitle5.raw)).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 5),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 1),
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 2),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("b"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map(),
        },
    });
});

test("will GC deleted content", () => {
    const title0 = emptyTaskTitleModel.get();
    const update1 = assertExists(title0.replace(0, 0, "a"));
    const title1 = update1.newTitle;
    const update2 = assertExists(title1.replace(1, 1, "bbbb"));
    const title2 = update2.newTitle;
    const update3 = assertExists(title2.replace(5, 5, "c"));
    const title3 = update3.newTitle;
    const update4 = assertExists(title3.replace(1, 5, ""));
    const title4 = update4.newTitle;
    const update5 = assertExists(title4.replace(1, 1, "d"));
    const title5 = update5.newTitle;

    expect(title0.getText()).toEqual("");
    expect(title1.getText()).toEqual("a");
    expect(title2.getText()).toEqual("abbbb");
    expect(title3.getText()).toEqual("abbbbc");
    expect(title4.getText()).toEqual("ac");
    expect(title5.getText()).toEqual("adc");

    expect(Y.decodeUpdateV2(title5.getRaw())).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 0),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: "doc",
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.AbstractType)),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 1),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("a"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 2),
                length: 4,
                origin: new Y.ID(realmTaskTitleClientId.get(), 1),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("bbbb"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 6),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("c"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 7),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 6),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("d"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map([[realmTaskTitleClientId.get(), [{clock: 2, len: 4}]]]),
        },
    });

    expect(
        Y.decodeUpdateV2(
            assertExists(TaskTitleModel.from(title5.getRaw()).replace(3, 3, "e")).newTitle.getRaw(),
        ),
    ).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 0),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: "doc",
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.AbstractType)),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 1),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("a"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 2),
                length: 4,
                origin: new Y.ID(realmTaskTitleClientId.get(), 1),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentDeleted(4),
                info: 0,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 6),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("c"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 7),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 6),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("d"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 8),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 6),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("e"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map([[realmTaskTitleClientId.get(), [{clock: 2, len: 4}]]]),
        },
    });

    const undoUpdate2OnTitle3 = assertExists(update2.invert(title3));

    expect(undoUpdate2OnTitle3.newTitle.getText()).toEqual("ac");

    expect(Y.decodeUpdateV2(undoUpdate2OnTitle3.newTitle.getRaw())).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 0),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: "doc",
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.AbstractType)),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 1),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("a"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 2),
                length: 4,
                origin: new Y.ID(realmTaskTitleClientId.get(), 1),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("bbbb"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 6),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("c"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map([[realmTaskTitleClientId.get(), [{clock: 2, len: 4}]]]),
        },
    });

    expect(
        Y.decodeUpdateV2(
            assertExists(undoUpdate2OnTitle3.newTitle.replace(1, 1, "d")).newTitle.getRaw(),
        ),
    ).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 0),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: "doc",
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.AbstractType)),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 1),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("a"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 2),
                length: 4,
                origin: new Y.ID(realmTaskTitleClientId.get(), 1),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("bbbb"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 6),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("c"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 7),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 6),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("d"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map([[realmTaskTitleClientId.get(), [{clock: 2, len: 4}]]]),
        },
    });

    expect(
        Y.decodeUpdateV2(
            assertExists(
                TaskTitleModel.from(undoUpdate2OnTitle3.newTitle.getRaw()).replace(1, 1, "d"),
            ).newTitle.getRaw(),
        ),
    ).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 0),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: "doc",
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.AbstractType)),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 1),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("a"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 2),
                length: 4,
                origin: new Y.ID(realmTaskTitleClientId.get(), 1),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentDeleted(4),
                info: 0,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 6),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("c"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 7),
                length: 1,
                origin: new Y.ID(realmTaskTitleClientId.get(), 5),
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 6),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("d"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map([[realmTaskTitleClientId.get(), [{clock: 2, len: 4}]]]),
        },
    });
});

test("can use inverted task title updates to undo/redo changes", () => {
    const title0 = emptyTaskTitleModel.get();
    const update1 = assertExists(title0.replace(0, 0, "quick undo test"));
    const title1 = update1.newTitle;
    const update2 = assertExists(title1.replace(6, 10, "redo"));
    const title2 = update2.newTitle;

    expect(title2.getText()).toEqual("quick redo test");

    const undoUpdate2OnTitle2 = assertExists(update2.invert(title2));
    const title3 = undoUpdate2OnTitle2.newTitle;

    expect(title3.getText()).toEqual("quick undo test");

    expect(Y.decodeUpdateV2(undoUpdate2OnTitle2.raw)).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 20),
                length: 4,
                origin: new Y.ID(realmTaskTitleClientId.get(), 6),
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 7),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("undo"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map([[realmTaskTitleClientId.get(), [{clock: 16, len: 4}]]]),
        },
    });

    const undoUpdate1OnTitle3 = assertExists(update1.invert(title3));
    const title4 = undoUpdate1OnTitle3.newTitle;

    expect(title4.getText()).toEqual("");

    expect(Y.decodeUpdateV2(undoUpdate1OnTitle3.raw)).toEqual({
        structs: [],
        ds: {
            clients: new Map([
                [
                    realmTaskTitleClientId.get(),
                    [
                        {clock: 0, len: 7},
                        {clock: 11, len: 5},
                        {clock: 20, len: 4},
                    ],
                ],
            ]),
        },
    });

    const redoUpdate1OnTitle4 = assertExists(undoUpdate1OnTitle3.invert(title4));
    const title5 = redoUpdate1OnTitle4.newTitle;

    expect(title5.getText()).toEqual("quick undo test");

    expect(Y.decodeUpdateV2(redoUpdate1OnTitle4.raw)).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 24),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 0),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.XmlText)),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 25),
                length: 6,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 24),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("quick "),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 31),
                length: 5,
                origin: new Y.ID(realmTaskTitleClientId.get(), 30),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString(" test"),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 36),
                length: 4,
                origin: new Y.ID(realmTaskTitleClientId.get(), 30),
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 31),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("undo"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map(),
        },
    });

    const redoUpdate2OnTitle5 = assertExists(undoUpdate2OnTitle2.invert(title5));
    const title6 = redoUpdate2OnTitle5.newTitle;

    expect(title6.getText()).toEqual("quick redo test");

    expect(Y.decodeUpdateV2(redoUpdate2OnTitle5.raw)).toEqual({
        structs: [
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 40),
                length: 4,
                origin: new Y.ID(realmTaskTitleClientId.get(), 39),
                left: null,
                right: null,
                rightOrigin: new Y.ID(realmTaskTitleClientId.get(), 31),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("redo"),
                info: 2,
            },
        ],
        ds: {
            clients: new Map([[realmTaskTitleClientId.get(), [{clock: 36, len: 4}]]]),
        },
    });
});

test("what happens when there's task title corruption?", () => {
    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = assertExists(title1.replace(0, 0, "a"));
        const updateB = assertExists(title1.replace(0, 0, "b"));
        const title2 = applyTaskTitleUpdate(title1.getRaw(), updateA.raw);
        const title3 = applyTaskTitleUpdate(title2, updateB.raw);

        expect(getTaskTitleText(title3)).toEqual("a");

        expect(Y.decodeUpdateV2(title3)).toEqual({
            structs: [
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 0),
                    length: 1,
                    origin: null,
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: "doc",
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentType(expect.any(Y.AbstractType)),
                    info: 2,
                },
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 1),
                    length: 1,
                    origin: null,
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentString("a"),
                    info: 2,
                },
            ],
            ds: {
                clients: new Map(),
            },
        });
    }

    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = assertExists(title1.replace(0, 0, "b"));
        const updateB = assertExists(title1.replace(0, 0, "a"));
        const title2 = applyTaskTitleUpdate(title1.getRaw(), updateA.raw);
        const title3 = applyTaskTitleUpdate(title2, updateB.raw);

        expect(getTaskTitleText(title3)).toEqual("b");

        expect(Y.decodeUpdateV2(title3)).toEqual({
            structs: [
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 0),
                    length: 1,
                    origin: null,
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: "doc",
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentType(expect.any(Y.AbstractType)),
                    info: 2,
                },
                {
                    id: new Y.ID(realmTaskTitleClientId.get(), 1),
                    length: 1,
                    origin: null,
                    left: null,
                    right: null,
                    rightOrigin: null,
                    parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                    parentSub: null,
                    redone: null,
                    content: new Y.ContentString("b"),
                    info: 2,
                },
            ],
            ds: {
                clients: new Map(),
            },
        });
    }
});
