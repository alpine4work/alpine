import * as Y from "yjs";
import {decodeBase64} from "~/shared/helpers/binary/base64.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {wordTaskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";
import {
    TaskTitle,
    TaskTitleModel,
    TaskTitleProsemirrorSchema,
    TaskTitleUpdate,
    TaskTitleUpdateModel,
    addFallbackToTaskTitle,
    applyTaskTitleUpdate,
    createTaskTitleFromText,
    emptyTaskTitle,
    emptyTaskTitleModel,
    getTaskTitleProsemirrorNode,
    getTaskTitleProsemirrorNodeText,
    getTaskTitleText,
    isTaskTitle,
    mergeTaskTitleUpdates,
    realmTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

test("can get task title text", () => {
    expect(getTaskTitleText(emptyTaskTitle.get())).toEqual("");
    expect(getTaskTitleText(wordTaskTitleTestScenario.title4)).toEqual("Hello");
    expect(getTaskTitleText(createTaskTitleFromText("abc123"))).toEqual("abc123");
});

test("decoded empty task title is empty and has no client IDs", () => {
    expect(Y.decodeUpdateV2(emptyTaskTitle.get())).toEqual({
        structs: [],
        ds: {clients: new Map()},
    });
});

test("noop task title updates", () => {
    expect(() => emptyTaskTitleModel.get().replace(0, 0, "")).toThrow(
        "Step must either delete or insert text",
    );
    expect(() => new TaskTitleModel(wordTaskTitleTestScenario.title4).replace(2, 2, "")).toThrow(
        "Step must either delete or insert text",
    );
});

test("can create task title updates", () => {
    let title = emptyTaskTitleModel.get();

    expect(title.getText()).toEqual("");

    {
        const titleUpdate = title.replace(0, 0, "a");

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
        const titleUpdate = title.replace(1, 1, "b");

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
        const titleUpdate = title.replace(2, 2, "c");

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
        const titleUpdate = title.replace(3, 3, "123");

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
        const titleUpdate = title.replace(1, 2, "");

        expect(Y.decodeUpdateV2(titleUpdate.raw)).toEqual({
            structs: [],
            ds: {clients: new Map([[realmTaskTitleClientId.get(), [{clock: 2, len: 1}]]])},
        });

        title = titleUpdate.newTitle;
    }

    expect(title.getText()).toEqual("ac123");

    {
        const titleUpdate = title.replace(1, 2, "C");

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
        const titleUpdate = title.replace(0, 2, "xyz");

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
    const update1 = title0.replace(0, 0, "a");
    const title1 = update1.newTitle;
    const update2 = title1.replace(1, 1, "b");
    const title2 = update2.newTitle;
    const update3 = title2.replace(2, 2, "c");
    const title3 = update3.newTitle;
    const update4 = title3.replace(1, 2, "");
    const title4 = update4.newTitle;
    const update5 = title4.replace(1, 1, "d");
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
    const update1 = title0.replace(0, 0, "a");
    const title1 = update1.newTitle;
    const update2 = title1.replace(1, 1, "bbbb");
    const title2 = update2.newTitle;
    const update3 = title2.replace(5, 5, "c");
    const title3 = update3.newTitle;
    const update4 = title3.replace(1, 5, "");
    const title4 = update4.newTitle;
    const update5 = title4.replace(1, 1, "d");
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
        Y.decodeUpdateV2(new TaskTitleModel(title5.getRaw()).replace(3, 3, "e").newTitle.getRaw()),
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
        Y.decodeUpdateV2(undoUpdate2OnTitle3.newTitle.replace(1, 1, "d").newTitle.getRaw()),
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
            new TaskTitleModel(undoUpdate2OnTitle3.newTitle.getRaw())
                .replace(1, 1, "d")
                .newTitle.getRaw(),
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
    const update1 = title0.replace(0, 0, "quick undo test");
    const title1 = update1.newTitle;
    const update2 = title1.replace(6, 10, "redo");
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

test("catches task title corruption and throws an error", () => {
    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = title1.replace(0, 0, "a");
        const updateB = title1.replace(0, 0, "b");
        const title2 = title1.apply(updateA);

        expect(() => title2.apply(updateB)).toThrow(
            `Conflicting item, the item we’re trying to integrate has an ID matching an existing item but the item we’re trying to integrate’s content doesn’t match the existing item (ID client: ${realmTaskTitleClientId.get()}, ID clock: 1)`,
        );
    }

    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = title1.replace(0, 0, "b");
        const updateB = title1.replace(0, 0, "a");
        const title2 = title1.apply(updateA);

        expect(() => title2.apply(updateB)).toThrow(
            `Conflicting item, the item we’re trying to integrate has an ID matching an existing item but the item we’re trying to integrate’s content doesn’t match the existing item (ID client: ${realmTaskTitleClientId.get()}, ID clock: 1)`,
        );
    }

    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = title1.replace(0, 0, "a");
        const updateB = title1.replace(0, 0, "bc");
        const title2 = title1.apply(updateA);

        expect(() => title2.apply(updateB)).toThrow(
            `Conflicting item, the item we’re trying to integrate has an ID matching an existing item but the item we’re trying to integrate’s content doesn’t match the existing item (ID client: ${realmTaskTitleClientId.get()}, ID clock: 1)`,
        );
    }

    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = title1.replace(0, 0, "ab");
        const updateB = title1.replace(0, 0, "c");
        const title2 = title1.apply(updateA);

        expect(() => title2.apply(updateB)).toThrow(
            `Conflicting item, the item we’re trying to integrate has an ID matching an existing item but the item we’re trying to integrate’s content doesn’t match the existing item (ID client: ${realmTaskTitleClientId.get()}, ID clock: 1)`,
        );
    }

    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = title1.replace(0, 0, "a");
        const updateB = title1.replace(0, 0, "ab");
        const title2 = title1.apply(updateA);

        expect(title2.apply(updateB).getText()).toEqual("ab");
    }

    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = title1.replace(0, 0, "ab");
        const updateB = title1.replace(0, 0, "a");
        const title2 = title1.apply(updateA);

        expect(title2.apply(updateB).getText()).toEqual("ab");
    }

    {
        const title1 = emptyTaskTitleModel.get().replace(0, 0, "a").newTitle;
        const updateA = title1.replace(0, 0, "b");
        const updateB = title1.replace(0, 0, "c");
        const title2 = title1.apply(updateA);

        expect(() => title2.apply(updateB)).toThrow(
            `Conflicting item, the item we’re trying to integrate has an ID matching an existing item but the item we’re trying to integrate’s content doesn’t match the existing item (ID client: ${realmTaskTitleClientId.get()}, ID clock: 2)`,
        );
    }

    {
        const title1 = emptyTaskTitleModel.get();
        const updateA = title1.replace(0, 0, "a");
        const updateB = title1.apply(updateA).replace(0, 0, "b");
        const title2 = title1.apply(updateA).apply(updateB);

        expect(title2.getText()).toEqual("ba");
    }
});

test("can merge task title with itself", () => {
    const title1 = emptyTaskTitleModel.get();
    const title2 = title1
        .replace(0, 0, "a")
        .newTitle.replace(0, 0, "b")
        .newTitle.replace(0, 0, "c").newTitle;

    expect(title2.getText()).toEqual("cba");

    const title3 = title2.replace(1, 1, "x").newTitle;

    expect(title3.getText()).toEqual("cxba");

    expect(title2.apply(title2).getText()).toEqual("cba");
    expect(title2.apply(title3).getText()).toEqual("cxba");
    expect(title3.apply(title2).getText()).toEqual("cxba");
});

test("reproduce bugged merge error when update is not in optimized form", () => {
    const rawTitle = decodeBase64(
        "AAAG5pX11Q4AAQAAAwcABA4LZG9jbmV3IHRhc2sDCAMBAAABBgABAgAA",
    ) as TaskTitle;
    const update = decodeBase64(
        "AAAG5pX11Q4HAwADBQAFBwAEAIQPC2RvY25ldyB0YXNrA0EGAwEAAAEGAAEJAAA=",
    ) as TaskTitleUpdate;

    expect(Y.decodeUpdateV2(rawTitle)).toEqual({
        structs: [
            {
                id: new Y.ID(1969136998, 0),
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
                id: new Y.ID(1969136998, 1),
                length: 8,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(1969136998, 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("new task"),
                info: 2,
            },
        ],
        ds: {clients: new Map()},
    });

    // This test is specifically exercising the case where `update` isn't in an
    // optimized, merged, format.
    expect(Y.decodeUpdateV2(update)).toEqual({
        structs: [
            {
                id: new Y.ID(1969136998, 0),
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
                id: new Y.ID(1969136998, 1),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(1969136998, 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("n"),
                info: 2,
            },
            {
                id: new Y.ID(1969136998, 2),
                length: 1,
                origin: new Y.ID(1969136998, 1),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("e"),
                info: 2,
            },
            {
                id: new Y.ID(1969136998, 3),
                length: 1,
                origin: new Y.ID(1969136998, 2),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("w"),
                info: 2,
            },
            {
                id: new Y.ID(1969136998, 4),
                length: 1,
                origin: new Y.ID(1969136998, 3),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString(" "),
                info: 2,
            },
            {
                id: new Y.ID(1969136998, 5),
                length: 1,
                origin: new Y.ID(1969136998, 4),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("t"),
                info: 2,
            },
            {
                id: new Y.ID(1969136998, 6),
                length: 1,
                origin: new Y.ID(1969136998, 5),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("a"),
                info: 2,
            },
            {
                id: new Y.ID(1969136998, 7),
                length: 1,
                origin: new Y.ID(1969136998, 6),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("s"),
                info: 2,
            },
            {
                id: new Y.ID(1969136998, 8),
                length: 1,
                origin: new Y.ID(1969136998, 7),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("k"),
                info: 2,
            },
        ],
        ds: {clients: new Map()},
    });

    const title = new TaskTitleModel(rawTitle);

    expect(title.getText()).toEqual("new task");
    expect(title.apply(update, {clientIdForTest: 1969136998}).getText()).toEqual("new task");
});

test("reproduce bugged merge error when update is not in optimized form and there’s some right origin", () => {
    const rawTitle = decodeBase64(
        "AAAGwqWY3RoBAQABAgUHAAQARBIOZG9jd29ybGRoZWxsbyADBQYDAQAAAQYAAQMAAA==",
    ) as TaskTitle;
    const update = decodeBase64(
        "AAAGwqWY3RoPBgADAgQDAgMCAQMJBwAEAIQDRADEEg5kb2N3b3JsZGhlbGxvIANBCQMBAAABBgABDAAA",
    ) as TaskTitleUpdate;

    expect(Y.decodeUpdateV2(rawTitle)).toEqual({
        structs: [
            {
                id: new Y.ID(3587377474, 0),
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
                id: new Y.ID(3587377474, 1),
                length: 5,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(3587377474, 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("world"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 6),
                length: 6,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(3587377474, 1),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("hello "),
                info: 2,
            },
        ],
        ds: {clients: new Map()},
    });

    // This test is specifically exercising the case where `update` isn't in an
    // optimized, merged, format.
    expect(Y.decodeUpdateV2(update)).toEqual({
        structs: [
            {
                id: new Y.ID(3587377474, 0),
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
                id: new Y.ID(3587377474, 1),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(3587377474, 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("w"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 2),
                length: 1,
                origin: new Y.ID(3587377474, 1),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("o"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 3),
                length: 1,
                origin: new Y.ID(3587377474, 2),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("r"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 4),
                length: 1,
                origin: new Y.ID(3587377474, 3),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("l"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 5),
                length: 1,
                origin: new Y.ID(3587377474, 4),
                left: null,
                right: null,
                rightOrigin: null,
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("d"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 6),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(3587377474, 1),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("h"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 7),
                length: 1,
                origin: new Y.ID(3587377474, 6),
                left: null,
                right: null,
                rightOrigin: new Y.ID(3587377474, 1),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("e"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 8),
                length: 1,
                origin: new Y.ID(3587377474, 7),
                left: null,
                right: null,
                rightOrigin: new Y.ID(3587377474, 1),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("l"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 9),
                length: 1,
                origin: new Y.ID(3587377474, 8),
                left: null,
                right: null,
                rightOrigin: new Y.ID(3587377474, 1),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("l"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 10),
                length: 1,
                origin: new Y.ID(3587377474, 9),
                left: null,
                right: null,
                rightOrigin: new Y.ID(3587377474, 1),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString("o"),
                info: 2,
            },
            {
                id: new Y.ID(3587377474, 11),
                length: 1,
                origin: new Y.ID(3587377474, 10),
                left: null,
                right: null,
                rightOrigin: new Y.ID(3587377474, 1),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentString(" "),
                info: 2,
            },
        ],
        ds: {clients: new Map()},
    });

    const title = new TaskTitleModel(rawTitle);

    expect(title.getText()).toEqual("hello world");
    expect(title.apply(update, {clientIdForTest: 3587377474}).getText()).toEqual("hello world");
});

test("applying task title update to task title produces optimized form", () => {
    const title0 = emptyTaskTitleModel.get();
    const update1 = title0.replace(0, 0, "a");
    const title1 = update1.newTitle;
    const update2 = title1.replace(1, 1, "b");
    const title2 = update2.newTitle;
    const update3 = title2.replace(2, 2, "c");
    const title3 = update3.newTitle;

    expect(Y.decodeUpdateV2(title3.getRaw())).toEqual({
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
                length: 3,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("abc"),
                info: 2,
            },
        ],
        ds: {clients: new Map()},
    });

    // Yjs's `mergeUpdatesV2()` function does not produce an update in
    // optimized form.
    expect(
        Y.decodeUpdateV2(
            Y.mergeUpdatesV2([title0.getRaw(), update1.raw, update2.raw, update3.raw]),
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

    // Yjs's `mergeUpdatesV2()` function does not produce an update in
    // optimized form.
    expect(Y.decodeUpdateV2(Y.mergeUpdatesV2([update2.raw, update3.raw]))).toEqual({
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

    expect(
        Y.decodeUpdateV2(
            applyTaskTitleUpdate(
                applyTaskTitleUpdate(
                    applyTaskTitleUpdate(title0.getRaw(), update1.raw),
                    update2.raw,
                ),
                update3.raw,
            ),
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
                content: new Y.ContentType(expect.any(Y.XmlText)),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 1),
                length: 3,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("abc"),
                info: 2,
            },
        ],
        ds: {clients: new Map()},
    });

    expect(Y.decodeUpdateV2(mergeTaskTitleUpdates(update2.raw, update3.raw))).toEqual({
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

    expect(
        Y.decodeUpdateV2(
            mergeTaskTitleUpdates(update1.raw, mergeTaskTitleUpdates(update2.raw, update3.raw)),
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
                content: new Y.ContentType(expect.any(Y.XmlText)),
                info: 2,
            },
            {
                id: new Y.ID(realmTaskTitleClientId.get(), 1),
                length: 3,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(realmTaskTitleClientId.get(), 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("abc"),
                info: 2,
            },
        ],
        ds: {clients: new Map()},
    });
});

test("reproduce bugged merge error when merging item with GCed content with item with deleted content that hasn’t been GCed", () => {
    const rawTitle = decodeBase64(
        "AAAG5uy+8xkGAwAPAQMADwAPBwAEAEcABABHAAQARwAEHxtkb2N0YXNrIDJ0YXNrIDJ0YXNrIDJ0YXNrIDIDRgIDAQAAAkYCAAEIAAGmtt/5DAEAFA==",
    ) as TaskTitle;
    const update = decodeBase64(
        "AAAG5uy+8xkDASoDAA8ADwEAAABBAAAAQQAAAEcABAwJZG9jdGFzayAyAwYDAQAAAQYGAQYBBgEGAQgAAaa23/kMAQAU",
    ) as TaskTitleUpdate;

    expect(Y.decodeUpdateV2(rawTitle)).toEqual({
        structs: [
            {
                id: new Y.ID(3476544294, 0),
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
                id: new Y.ID(3476544294, 1),
                length: 6,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(3476544294, 0),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("task 2"),
                info: 2,
            },
            {
                id: new Y.ID(3476544294, 7),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(3476544294, 0),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.XmlText)),
                info: 2,
            },
            {
                id: new Y.ID(3476544294, 8),
                length: 6,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(3476544294, 7),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("task 2"),
                info: 2,
            },
            {
                id: new Y.ID(3476544294, 14),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(3476544294, 7),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.XmlText)),
                info: 2,
            },
            {
                id: new Y.ID(3476544294, 15),
                length: 6,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(3476544294, 14),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("task 2"),
                info: 2,
            },
            {
                id: new Y.ID(3476544294, 21),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(3476544294, 14),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.XmlText)),
                info: 2,
            },
            {
                id: new Y.ID(3476544294, 22),
                length: 6,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(3476544294, 21),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("task 2"),
                info: 2,
            },
        ],
        ds: {clients: new Map([[3476544294, [{clock: 0, len: 21}]]])},
    });

    expect(Y.decodeUpdateV2(update)).toEqual({
        structs: [
            {
                id: new Y.ID(3476544294, 0),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: "doc",
                parentSub: null,
                redone: null,
                content: new Y.ContentDeleted(1),
                info: 0,
            },
            {
                id: new Y.ID(3476544294, 1),
                length: 6,
            },
            {
                id: new Y.ID(3476544294, 7),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(3476544294, 0),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentDeleted(1),
                info: 0,
            },
            {
                id: new Y.ID(3476544294, 8),
                length: 6,
            },
            {
                id: new Y.ID(3476544294, 14),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(3476544294, 7),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentDeleted(1),
                info: 0,
            },
            {
                id: new Y.ID(3476544294, 15),
                length: 6,
            },
            {
                id: new Y.ID(3476544294, 21),
                length: 1,
                origin: null,
                left: null,
                right: null,
                rightOrigin: new Y.ID(3476544294, 14),
                parent: null,
                parentSub: null,
                redone: null,
                content: new Y.ContentType(expect.any(Y.XmlText)),
                info: 2,
            },
            {
                id: new Y.ID(3476544294, 22),
                length: 6,
                origin: null,
                left: null,
                right: null,
                rightOrigin: null,
                parent: new Y.ID(3476544294, 21),
                parentSub: null,
                redone: null,
                content: new Y.ContentString("task 2"),
                info: 2,
            },
        ],
        ds: {clients: new Map([[3476544294, [{clock: 0, len: 21}]]])},
    });

    const title = new TaskTitleModel(new TaskTitleModel(rawTitle).getDocForTest());

    // `title` will be garbage collected since `item.keep = true` was not set on
    // any items while constructing the `TaskTitleModel`.
    expect(Y.decodeUpdateV2(title.getRaw())).toEqual(Y.decodeUpdateV2(update));

    expect(title.getText()).toEqual("task 2");
    expect(title.apply(update, {clientIdForTest: 3476544294}).getText()).toEqual("task 2");

    const titleFromEmpty = emptyTaskTitleModel
        .get()
        .replace(0, 0, "task 2", {clientIdForTest: 3476544294})
        .newTitle.clear({clientIdForTest: 3476544294})
        .newTitle.replace(0, 0, "task 2", {clientIdForTest: 3476544294})
        .newTitle.clear({clientIdForTest: 3476544294})
        .newTitle.replace(0, 0, "task 2", {clientIdForTest: 3476544294})
        .newTitle.clear({clientIdForTest: 3476544294})
        .newTitle.replace(0, 0, "task 2", {clientIdForTest: 3476544294}).newTitle;

    // `title` should not be garbage collected since `item.keep = true` is set on
    // all updates made with `replace()`.
    expect(Y.decodeUpdateV2(titleFromEmpty.getRaw())).toEqual(Y.decodeUpdateV2(rawTitle));

    expect(titleFromEmpty.getText()).toEqual("task 2");
    expect(titleFromEmpty.apply(update, {clientIdForTest: 3476544294}).getText()).toEqual("task 2");
    expect(title.apply(titleFromEmpty, {clientIdForTest: 3476544294}).getText()).toEqual("task 2");
});

// NOTE(calebmer, 2025-03-05): The following tests are written by AI with
// modifications by me to make sure they pass. Hence all the comments. The
// region comment allows you to collapse these tests in VS Code.
//
// #region 2025-03-05 AI tests

test("can handle concurrent independent updates", () => {
    const title0 = emptyTaskTitleModel.get();

    // Create two independent updates from the same initial state
    const updateA = title0.replace(0, 0, "Hello ", {clientIdForTest: 1});
    const titleA = updateA.newTitle;

    const updateB = title0.replace(0, 0, "World!", {clientIdForTest: 2});
    const titleB = updateB.newTitle;

    // Apply updates in different orders - they should commute
    const titleAB = titleA.apply(updateB);
    const titleBA = titleB.apply(updateA);

    // Content should be the same regardless of application order
    expect(titleAB.getText()).toEqual(titleBA.getText());
    expect(titleAB.getText()).toEqual("Hello World!");
});

test("resolves concurrent conflicting updates deterministically", () => {
    // Make two clients with different titles
    const titleA = TaskTitleModel.fromText("Hello ", {clientIdForTest: 1});
    const titleB = TaskTitleModel.fromText("Hello ", {clientIdForTest: 1});

    // Client A adds "world" at the end
    const updateA = titleA.replace(6, 6, "world", {clientIdForTest: 2});
    const titleA2 = updateA.newTitle;

    // Client B adds "everyone" at the end
    const updateB = titleB.replace(6, 6, "everyone", {clientIdForTest: 3});
    const titleB2 = updateB.newTitle;

    // Client A receives Client B's update and applies it
    const titleA3 = titleA2.apply(updateB);

    // Client B receives Client A's update and applies it
    const titleB3 = titleB2.apply(updateA);

    // Both clients should end up with the same text
    expect(titleA3.getText()).toEqual(titleB3.getText());
});

test("handles concurrent edits at same position", () => {
    const title = TaskTitleModel.fromText("ABC");

    // Two concurrent updates at the same position
    const updateX = title.replace(1, 1, "X", {clientIdForTest: 1});
    const updateY = title.replace(1, 1, "Y", {clientIdForTest: 2});

    // Apply both updates
    const titleXY = title.apply(updateX).apply(updateY);
    const titleYX = title.apply(updateY).apply(updateX);

    // Both should be the same and deterministic
    expect(titleXY.getText()).toEqual(titleYX.getText());
});

test("deep cloning preserves document structure", () => {
    // Create a complex title with some operations
    let title = emptyTaskTitleModel.get();
    title = title.replace(0, 0, "Hello").newTitle;
    title = title.replace(5, 5, " World").newTitle;
    title = title.replace(5, 11, " Beautiful").newTitle;

    // Create a mutation on this title
    const update = title.replace(0, 5, "Goodbye");
    const newTitle = update.newTitle;

    // Original title should be unchanged
    expect(title.getText()).toEqual("Hello Beautiful");
    expect(newTitle.getText()).toEqual("Goodbye Beautiful");

    // Check that we can apply additional mutations to both titles
    const originalUpdate = title.replace(5, 15, " Planet");
    const newUpdate = newTitle.replace(7, 17, " Earth");

    expect(originalUpdate.newTitle.getText()).toEqual("Hello Planet");
    expect(newUpdate.newTitle.getText()).toEqual("Goodbye Earth");
});

test("correctly converts between absolute and relative positions", () => {
    const title = TaskTitleModel.fromText("Hello World");

    // Create a relative position for different locations in the text
    const poss = [0, 5, 6, 11];

    for (const pos of poss) {
        const relativePos = title.intoRelativePosition(pos);
        // Convert back to absolute
        const absolutePos = title.fromRelativePosition(relativePos);

        // Position should round-trip correctly
        expect(absolutePos).toEqual(pos);
    }
});

test("relative positions are preserved across mutations", () => {
    const title1 = TaskTitleModel.fromText("Hello World");

    // Create a relative position for the space between "Hello" and "World"
    const relativePos = title1.intoRelativePosition(5);

    // Make a change that doesn't affect the position
    const update1 = title1.replace(0, 0, "Say ");
    const title2 = update1.newTitle;

    // The position should still be valid at the same logical location
    const newAbsolutePos = assertExists(title2.fromRelativePosition(relativePos));
    expect(newAbsolutePos).toEqual(9); // "Say " + "Hello" = 9 chars

    // Now modify the text at the marked position
    const update2 = title2.replace(newAbsolutePos, newAbsolutePos, ",");
    const title3 = update2.newTitle;

    // Verify the text is as expected
    expect(title3.getText()).toEqual("Say Hello, World");
});

test("correctly identifies model equivalence", () => {
    // Create two models with the same content but different instances
    const titleA = TaskTitleModel.fromText("Hello", {clientIdForTest: 1});

    const titleB = TaskTitleModel.fromText("Hello", {clientIdForTest: 2});

    // Different content
    const titleC = TaskTitleModel.fromText("World", {clientIdForTest: 1});

    // Check equality
    expect(titleA.isEqual(titleA)).toBe(true); // Same instance
    expect(titleA.isEqual(titleB)).toBe(false); // Same content, different instances with different IDs
    expect(titleA.isEqual(titleC)).toBe(false); // Different content

    // Create the same content through operations
    let titleD = emptyTaskTitleModel.get();
    titleD = titleD.replace(0, 0, "Hello", {clientIdForTest: 1}).newTitle;

    expect(titleA.isEqual(titleD)).toBe(true);
});

test("manages complex undo/redo chains correctly", () => {
    let title = emptyTaskTitleModel.get();

    // Build a series of changes
    const update1 = title.replace(0, 0, "First");
    title = update1.newTitle;

    const update2 = title.replace(5, 5, " Second");
    title = update2.newTitle;

    const update3 = title.replace(12, 12, " Third");
    title = update3.newTitle;

    expect(title.getText()).toEqual("First Second Third");

    // Undo in reverse order
    const undo3 = assertExists(update3.invert(title));
    title = undo3.newTitle;
    expect(title.getText()).toEqual("First Second");

    const undo2 = assertExists(update2.invert(title));
    title = undo2.newTitle;
    expect(title.getText()).toEqual("First");

    const undo1 = assertExists(update1.invert(title));
    title = undo1.newTitle;
    expect(title.getText()).toEqual("");

    // Redo in original order
    const redo1 = assertExists(undo1.invert(title));
    title = redo1.newTitle;
    expect(title.getText()).toEqual("First");

    const redo2 = assertExists(undo2.invert(title));
    title = redo2.newTitle;
    expect(title.getText()).toEqual("First Second");

    const redo3 = assertExists(undo3.invert(title));
    title = redo3.newTitle;
    expect(title.getText()).toEqual("First Second Third");
});

test("all conversion functions work correctly", () => {
    const text = "Sample Task Title";

    // Create from text
    const title = createTaskTitleFromText(text);

    // Validate it's a TaskTitle
    expect(isTaskTitle(title)).toBe(true);
    expect(isTaskTitle(new Uint8Array([1, 2, 3]))).toBe(false);

    // Get text content
    expect(getTaskTitleText(title)).toEqual(text);

    // Get ProseMirror node
    const node = getTaskTitleProsemirrorNode(title);
    expect(node.toJSON()).toEqual({
        type: "doc",
        content: [{type: "text", text: "Sample Task Title"}],
    });

    // Get text from node
    expect(getTaskTitleProsemirrorNodeText(node)).toEqual(text);

    // Test fallback functionality
    expect(addFallbackToTaskTitle("")).toEqual("Untitled");
    expect(addFallbackToTaskTitle("  ")).toEqual("Untitled");
    expect(addFallbackToTaskTitle("Valid Title")).toEqual("Valid Title");
});

test("handles invalid positions gracefully", () => {
    const title = TaskTitleModel.fromText("Hello");

    // Replacing before the start should throw
    expect(() => title.replace(-1, 0, "X")).toThrow(
        "Step `from` must be greater than or equal to 0",
    );

    // Replacing after the end should throw
    expect(() => title.replace(6, 7, "X")).toThrow("Step `to` is out of bounds");

    // From > to should throw
    expect(() => title.replace(3, 2, "X")).toThrow(
        "Step `to` must be greater than or equal to `from`",
    );
});

test("handles empty updates correctly", () => {
    const title = TaskTitleModel.fromText("Hello");

    // No-op updates should throw
    expect(() => title.replace(2, 2, "")).toThrow("Step must either delete or insert text");

    // But deletion should be fine
    const update = title.replace(2, 3, "");
    expect(update.newTitle.getText()).toEqual("Helo");

    // And insertion should be fine
    const update2 = title.replace(2, 2, "X");
    expect(update2.newTitle.getText()).toEqual("HeXllo");
});

test("handles multiple interleaved updates with undo/redo", () => {
    let titleA = emptyTaskTitleModel.get();
    let titleB = emptyTaskTitleModel.get();

    // Client A adds "Hello"
    const updateA1 = titleA.replace(0, 0, "Hello", {clientIdForTest: 1});
    titleA = updateA1.newTitle;

    // Client B adds "World"
    const updateB1 = titleB.replace(0, 0, "World", {clientIdForTest: 2});
    titleB = updateB1.newTitle;

    // Synchronize
    titleA = titleA.apply(updateB1);
    titleB = titleB.apply(updateA1);

    // Both should have "HelloWorld"
    expect(titleA.getText()).toEqual(titleB.getText());
    expect(titleA.getText()).toEqual("HelloWorld");

    // Client A adds space in the middle
    const updateA2 = titleA.replace(5, 5, " ", {clientIdForTest: 1});
    titleA = updateA2.newTitle;

    // Client B adds "!" at the end
    const updateB2 = titleB.replace(10, 10, "!", {clientIdForTest: 2});
    titleB = updateB2.newTitle;

    // Synchronize again
    titleA = titleA.apply(updateB2);
    titleB = titleB.apply(updateA2);

    // Both should have "Hello World!"
    expect(titleA.getText()).toEqual(titleB.getText());
    expect(titleA.getText()).toEqual("Hello World!");

    // Client A undoes their last edit
    const undoA2 = assertExists(updateA2.invert(titleA, {clientIdForTest: 1}));
    titleA = undoA2.newTitle;

    // Client B undoes their last edit
    const undoB2 = assertExists(updateB2.invert(titleB, {clientIdForTest: 2}));
    titleB = undoB2.newTitle;

    // Synchronize the undo operations
    titleA = titleA.apply(undoB2);
    titleB = titleB.apply(undoA2);

    // Both should have "HelloWorld" again
    expect(titleA.getText()).toEqual(titleB.getText());
    expect(titleA.getText()).toEqual("HelloWorld");
});

test("handles large document manipulations", () => {
    // Create a large text document
    const largeText = "x".repeat(10000);
    let title = TaskTitleModel.fromText(largeText);

    // Make some edits at various positions
    title = title.replace(5000, 5010, "MIDDLE").newTitle;
    title = title.replace(0, 0, "Start: ").newTitle;
    title = title.replace(10003, 10003, " :End").newTitle;

    // Verify results
    expect(title.getText()).toEqual(
        "Start: " + largeText.substring(0, 5000) + "MIDDLE" + largeText.substring(5010) + " :End",
    );
});

test("replace and replace many produce identical results", () => {
    const title = TaskTitleModel.fromText("Hello World");

    // Single replace
    const update1 = title.replace(6, 11, "Everyone");

    // Same operation with replaceMany
    const update2 = title.replaceMany([{from: 6, to: 11, text: "Everyone"}]);

    // Compare outputs
    expect(update1.newTitle.getText()).toEqual(update2.newTitle.getText());
    expect(update1.newTitle.isEqual(update2.newTitle)).toBe(true);
});

test("replace many correctly applies multiple operations", () => {
    const title = TaskTitleModel.fromText("Hello World");

    const update = title.replaceMany([
        {from: 0, to: 5, text: "Greetings"}, // Replace "Hello"
        {from: 10, to: 15, text: "Everyone"}, // Replace "World"
    ]);

    expect(update.newTitle.getText()).toEqual("Greetings Everyone");

    // Compare with sequential operations
    let otherTitle = title;
    otherTitle = otherTitle.replace(0, 5, "Greetings").newTitle;
    otherTitle = otherTitle.replace(10, 15, "Everyone").newTitle;

    expect(otherTitle.getText()).toEqual("Greetings Everyone");
});

test("frozen docs cannot be modified", () => {
    const title = TaskTitleModel.fromText("Test");

    const xmlFragment = title.getDocForTest().getXmlFragment("doc");

    // Attempt to modify should throw
    expect(() => {
        xmlFragment.insert(0, [new Y.XmlText("Modify")]);
    }).toThrow();
});

test("correctly integrates with ProseMirror", () => {
    // Create a ProseMirror node directly
    const prosemirrorNode = TaskTitleProsemirrorSchema.node("doc", {}, [
        TaskTitleProsemirrorSchema.text("ProseMirror Node"),
    ]);

    // Convert to task title and back
    const title = new TaskTitleModel(emptyTaskTitle.get()).replace(
        0,
        0,
        "ProseMirror Node",
    ).newTitle;

    const retrievedNode = title.getProsemirrorNode();

    // Compare text content
    expect(getTaskTitleProsemirrorNodeText(retrievedNode)).toEqual("ProseMirror Node");

    // Check node structure
    expect(retrievedNode.type.name).toEqual(prosemirrorNode.type.name);
    expect(retrievedNode.childCount).toEqual(prosemirrorNode.childCount);
});

test("handles special characters and unicode correctly", () => {
    const specialChars = "ñáéíóúü€£¥©®™😀🚀\n\t";
    const title = TaskTitleModel.fromText(specialChars);

    // Verify the text is preserved
    expect(title.getText()).toEqual(specialChars);

    // Make edits with special characters
    const updated = title.replace(2, 5, "👨‍👩‍👧‍👦").newTitle;

    // Verify edits worked correctly
    expect(updated.getText().includes("👨‍👩‍👧‍👦")).toBe(true);
});

test("multiple small updates compose correctly", () => {
    let title = emptyTaskTitleModel.get();
    const operations = [
        {pos: 0, text: "1"},
        {pos: 1, text: "2"},
        {pos: 2, text: "3"},
        {pos: 3, text: "4"},
        {pos: 4, text: "5"},
    ];

    // Apply operations individually
    for (const op of operations) {
        title = title.replace(op.pos, op.pos, op.text).newTitle;
    }

    expect(title.getText()).toEqual("12345");

    // Apply multiple operations at once using replaceMany
    const initialModel = emptyTaskTitleModel.get();
    const steps = operations.map(op => ({from: op.pos, to: op.pos, text: op.text}));

    const batchUpdate = initialModel.replaceMany(steps);
    expect(batchUpdate.newTitle.getText()).toEqual("12345");
});

test("deleted content is properly handled after GC", () => {
    // Create initial text
    let title = emptyTaskTitleModel.get().replace(0, 0, "This text will be deleted").newTitle;

    // Delete all the text
    title = title.replace(0, 25, "").newTitle;

    // Add new content
    title = title.replace(0, 0, "New content").newTitle;

    // Ensure the new text is correct
    expect(title.getText()).toEqual("New content");

    // Add more text and ensure it works correctly
    title = title.replace(11, 11, " added").newTitle;
    expect(title.getText()).toEqual("New content added");
});

test("doesn’t retain references to old versions", () => {
    let title = emptyTaskTitleModel.get();
    const versions = [];

    // Create a bunch of versions
    for (let i = 0; i < 10; i++) {
        title = title.replace(title.getText().length, title.getText().length, "v" + i).newTitle;
        versions.push(title);
    }

    // Modify the latest version
    title = title.replace(0, 0, "Modified: ").newTitle;

    // All previous versions should be untouched
    for (let i = 0; i < 10; i++) {
        expect(versions[i]!.getText()).toEqual("v0v1v2v3v4v5v6v7v8v9".substring(0, i * 2 + 2));
    }

    // The latest version should have the modification
    expect(title.getText()).toEqual("Modified: v0v1v2v3v4v5v6v7v8v9");
});

test("properly handles empty documents", () => {
    const empty = emptyTaskTitleModel.get();

    // Test that it is indeed empty
    expect(empty.getText()).toEqual("");

    // Add and then remove text
    const withText = empty.replace(0, 0, "Some text").newTitle;
    expect(withText.getText()).toEqual("Some text");

    const emptyAgain = withText.replace(0, 9, "").newTitle;
    expect(emptyAgain.getText()).toEqual("");

    // Verify that we can still add text after clearing
    const textAgain = emptyAgain.replace(0, 0, "New text").newTitle;
    expect(textAgain.getText()).toEqual("New text");
});

test("handles multi-user simultaneous cursor position deletions", () => {
    const title = TaskTitleModel.fromText("abcdefghijklm");

    // Three users concurrently delete content at different cursor positions
    // First user removes "cde"
    const update1 = title.replace(2, 5, "", {clientIdForTest: 1});

    // Second user removes "hij"
    const update2 = title.replace(7, 10, "", {clientIdForTest: 2});

    // Third user removes "b"
    const update3 = title.replace(1, 2, "", {clientIdForTest: 3});

    // Apply updates in different orders and ensure convergence
    const title123 = title.apply(update1).apply(update2).apply(update3);
    const title132 = title.apply(update1).apply(update3).apply(update2);
    const title213 = title.apply(update2).apply(update1).apply(update3);
    const title231 = title.apply(update2).apply(update3).apply(update1);
    const title312 = title.apply(update3).apply(update1).apply(update2);
    const title321 = title.apply(update3).apply(update2).apply(update1);

    // All sequences should result in the same final text
    const expected = "afghijklm".replace("hij", "");
    expect(title123.getText()).toEqual(expected);
    expect(title132.getText()).toEqual(expected);
    expect(title213.getText()).toEqual(expected);
    expect(title231.getText()).toEqual(expected);
    expect(title312.getText()).toEqual(expected);
    expect(title321.getText()).toEqual(expected);
});

test("handles multi-user insertions at the same position", () => {
    const title = TaskTitleModel.fromText("Hello World");

    // Multiple users insert at position 5 (between "Hello" and " World")
    const update1 = title.replace(5, 5, ",", {clientIdForTest: 1});
    const update2 = title.replace(5, 5, "!", {clientIdForTest: 2});
    const update3 = title.replace(5, 5, "?", {clientIdForTest: 3});

    // Apply in different orders
    const title123 = title.apply(update1).apply(update2).apply(update3);
    const title321 = title.apply(update3).apply(update2).apply(update1);

    // Results should be consistent (though order of characters may depend on Yjs conflict resolution)
    expect(title123.getText()).toEqual(title321.getText());
});

test("handles overlapping replacements correctly", () => {
    const title = TaskTitleModel.fromText("The quick brown fox jumps");

    // User 1 replaces "quick brown" with "slow red"
    const update1 = title.replace(4, 15, "slow red", {clientIdForTest: 1});

    // User 2 replaces "brown fox" with "dog"
    const update2 = title.replace(10, 19, "dog", {clientIdForTest: 2});

    // Apply in different orders
    const title12 = title.apply(update1).apply(update2);
    const title21 = title.apply(update2).apply(update1);

    // Results should be consistent (though exact resolution depends on Yjs)
    expect(title12.getText()).toEqual(title21.getText());

    // Verify the result is deterministic (specific resolution depends on Yjs algorithm)
    // The outcome will depend on how Yjs resolves the conflict
    const finalText = title12.getText();

    // Check that applying the same updates to a fresh document gives the same result
    let freshTitle = TaskTitleModel.fromText("The quick brown fox jumps");
    freshTitle = freshTitle.apply(update1).apply(update2);
    expect(freshTitle.getText()).toEqual(finalText);
});

test("handles complex concurrent editing with interleaved inserts and deletes", () => {
    const title = TaskTitleModel.fromText("abcdefg");

    // Series of concurrent edits:
    // 1. Insert "X" between a and b
    const update1 = title.replace(1, 1, "X", {clientIdForTest: 1});

    // 2. Delete "cd"
    const update2 = title.replace(2, 4, "", {clientIdForTest: 2});

    // 3. Replace "fg" with "FG"
    const update3 = title.replace(5, 7, "FG", {clientIdForTest: 3});

    // 4. Insert "YZ" at start
    const update4 = title.replace(0, 0, "YZ", {clientIdForTest: 4});

    // Apply in different complex orders
    const title1234 = title.apply(update1).apply(update2).apply(update3).apply(update4);
    const title4321 = title.apply(update4).apply(update3).apply(update2).apply(update1);
    const title2413 = title.apply(update2).apply(update4).apply(update1).apply(update3);

    // All should converge to the same state
    expect(title1234.getText()).toEqual(title4321.getText());
    expect(title1234.getText()).toEqual(title2413.getText());
});

test("resolves complex undos with concurrent edits correctly", () => {
    let title1 = TaskTitleModel.fromText("Initial text", {clientIdForTest: 1});
    let title2 = title1; // User 2 starts with the same document

    // User 1 edits
    const update1 = title1.replace(8, 12, "content", {clientIdForTest: 1});
    title1 = update1.newTitle; // "Initial content"

    // User 2 makes a different edit before receiving user 1's update
    const update2 = title2.replace(0, 0, "Modified ", {clientIdForTest: 2});
    title2 = update2.newTitle; // "Modified Initial text"

    // User 1 undoes their edit
    const undo1 = assertExists(update1.invert(title1, {clientIdForTest: 1}));
    title1 = undo1.newTitle; // Back to "Initial text"

    // User 2 receives user 1's edits (first the update, then the undo)
    title2 = title2.apply(update1).apply(undo1);

    // User 1 receives user 2's edit
    title1 = title1.apply(update2);

    // Final states should be consistent
    expect(title1.getText()).toEqual(title2.getText());
    expect(title1.getText()).toEqual("Modified Initial text");
});

test("handles concurrent conflicting undos and redos", () => {
    let title1 = emptyTaskTitleModel.get();
    let title2 = emptyTaskTitleModel.get();

    // Both users start with same document
    // User 1 adds text
    const update1 = title1.replace(0, 0, "Hello", {clientIdForTest: 1});
    title1 = update1.newTitle;

    // Sync to user 2
    title2 = title2.apply(update1);

    // User 1 adds more text
    const update2 = title1.replace(5, 5, " World", {clientIdForTest: 1});
    title1 = update2.newTitle;

    // User 2 adds different text at same position before receiving update2
    const update3 = title2.replace(5, 5, " Universe", {clientIdForTest: 2});
    title2 = update3.newTitle;

    // User 1 undoes their second edit
    const undo2 = assertExists(update2.invert(title1, {clientIdForTest: 1}));
    title1 = undo2.newTitle;

    // User 1 receives User 2's update
    title1 = title1.apply(update3);

    // User 2 receives User 1's update and undo
    title2 = title2.apply(update2).apply(undo2);

    // Both users should have "Hello Universe"
    expect(title1.getText()).toEqual(title2.getText());
    expect(title1.getText()).toEqual("Hello Universe");

    // User 1 re-applies their "World" edit (redo)
    const redo2 = assertExists(undo2.invert(title1, {clientIdForTest: 1}));
    title1 = redo2.newTitle;

    // User 2 receives the redo
    title2 = title2.apply(redo2);

    // Check final state - should include both Universe and World
    expect(title1.getText()).toEqual(title2.getText());
    expect(title1.getText()).toEqual("Hello World Universe");
});

test("preserves document integrity with concurrent undos of non-sequential updates", () => {
    let title1 = TaskTitleModel.fromText("ABCDEFG", {clientIdForTest: 1});
    let title2 = title1; // Start with identical documents

    // User 1 performs three edits
    const update1 = title1.replace(1, 2, "1", {clientIdForTest: 1}); // A1CDEFG
    title1 = update1.newTitle;

    const update2 = title1.replace(3, 4, "2", {clientIdForTest: 1}); // A1C2EFG
    title1 = update2.newTitle;

    const update3 = title1.replace(5, 6, "3", {clientIdForTest: 1}); // A1C2E3G
    title1 = update3.newTitle;

    // User 2 receives all of user 1's updates
    title2 = title2.apply(update1).apply(update2).apply(update3);

    // User 1 undoes the second edit (not the most recent one)
    const undo2 = assertExists(update2.invert(title1, {clientIdForTest: 1}));
    title1 = undo2.newTitle; // Should be A1CDEF3G

    // User 2 simultaneously makes an edit
    const update4 = title2.replace(0, 1, "X", {clientIdForTest: 2}); // X1C2E3G
    title2 = update4.newTitle;

    // Both users receive each other's changes
    title1 = title1.apply(update4);
    title2 = title2.apply(undo2);

    // Verify they converge
    expect(title1.getText()).toEqual(title2.getText());
});

test("maintains internal structure integrity with multi-user complex operations", () => {
    const title = TaskTitleModel.fromText("Baseline text", {clientIdForTest: 1});

    // Series of edits by different users with overwrites
    // User 1 replaces "Base" with "Initial"
    const update1 = title.replace(0, 4, "Initial", {clientIdForTest: 1});

    // User 2 replaces "text" with "document"
    const update2 = title.replace(9, 13, "document", {clientIdForTest: 2});

    // User 3 inserts " important" before "text"
    const update3 = title.replace(9, 9, " important", {clientIdForTest: 3});

    // User 4 completely rewrites everything
    const update4 = title.replace(0, 13, "Completely different text", {clientIdForTest: 4});

    // Apply in different orders
    const title12 = title.apply(update1).apply(update2);
    const title34 = title.apply(update3).apply(update4);
    // Now merge these divergent states
    const title1234 = title12.apply(update3).apply(update4);
    const title3412 = title34.apply(update1).apply(update2);

    // Even with such divergent paths, the documents should eventually converge
    expect(title1234.getText()).toEqual(title3412.getText());

    // Verify the result remains stable with additional operations
    // Add another edit operation on the merged document
    const titleFinal = title1234.replace(
        title1234.getText().length,
        title1234.getText().length,
        " - FINAL",
        {clientIdForTest: 5},
    ).newTitle;

    // Create another merge path and ensure it gets the same content
    const titleAlt = title.apply(update4).apply(update1).apply(update2).apply(update3);
    const titleAltFinal = titleAlt.replace(
        titleAlt.getText().length,
        titleAlt.getText().length,
        " - FINAL",
        {clientIdForTest: 5},
    ).newTitle;

    expect(titleFinal.getText()).toEqual(titleAltFinal.getText());
});

test("handles extreme cascading position shifts from interleaved updates", () => {
    const title = TaskTitleModel.fromText("0123456789", {clientIdForTest: 1});

    // Create a series of non-sequential position updates that cascade
    // Each edit shifts positions for subsequent edits

    // These updates are designed to create complex dependencies
    const updates = [
        // Insert at position 1
        title.replace(1, 1, "A", {clientIdForTest: 2}),
        // Delete at position 3-5 (which will be shifted by the previous insert)
        title.replace(3, 5, "", {clientIdForTest: 3}),
        // Replace at position 7-8 (shifted by both previous edits)
        title.replace(7, 8, "B", {clientIdForTest: 4}),
        // Insert at position 2 (which will affect all later positions)
        title.replace(2, 2, "C", {clientIdForTest: 5}),
        // Delete across positions that have been modified by previous edits
        title.replace(4, 7, "", {clientIdForTest: 6}),
    ];

    // Apply in sequential order
    let sequentialTitle = title;
    for (const update of updates) {
        sequentialTitle = sequentialTitle.apply(update);
    }

    // Apply in random orders to check convergence
    const reverseTitle = title
        .apply(updates[4]!)
        .apply(updates[3]!)
        .apply(updates[2]!)
        .apply(updates[1]!)
        .apply(updates[0]!);

    const mixedTitle = title
        .apply(updates[2]!)
        .apply(updates[0]!)
        .apply(updates[4]!)
        .apply(updates[3]!)
        .apply(updates[1]!);

    // All should converge
    expect(sequentialTitle.getText()).toEqual(reverseTitle.getText());
    expect(sequentialTitle.getText()).toEqual(mixedTitle.getText());
});

test("handles rapid insert/delete pairs at the same position", () => {
    const title = TaskTitleModel.fromText("ABCDEFG", {clientIdForTest: 1});

    // Create a series of rapid insert/delete pairs at the same position
    // by different users

    // User 2 inserts X at position 3
    const insert1 = title.replace(3, 3, "X", {clientIdForTest: 2});

    // User 3 deletes the character at position 3 (which may or may not be X depending on order)
    const delete1 = title.replace(3, 4, "", {clientIdForTest: 3});

    // User 4 inserts Y at position 3
    const insert2 = title.replace(3, 3, "Y", {clientIdForTest: 4});

    // User 5 deletes the character at position 3 again
    const delete2 = title.replace(3, 4, "", {clientIdForTest: 5});

    // Apply in different orders
    const titleInsertDelete = title.apply(insert1).apply(delete1).apply(insert2).apply(delete2);

    const titleDeleteInsert = title.apply(delete1).apply(insert1).apply(delete2).apply(insert2);

    const titleInterleavedA = title.apply(insert1).apply(insert2).apply(delete1).apply(delete2);

    const titleInterleavedB = title.apply(delete1).apply(delete2).apply(insert1).apply(insert2);

    // All sequences should converge
    expect(titleInsertDelete.getText()).toEqual(titleDeleteInsert.getText());
    expect(titleInsertDelete.getText()).toEqual(titleInterleavedA.getText());
    expect(titleInsertDelete.getText()).toEqual(titleInterleavedB.getText());
});

test("ensures inverted operation history remains consistent with concurrent updates", () => {
    let title1 = TaskTitleModel.fromText("Original", {clientIdForTest: 1});
    let title2 = title1;

    // User 1 makes an edit
    const update1 = title1.replace(0, 8, "Modified", {clientIdForTest: 1});
    title1 = update1.newTitle;

    // User 2 receives the update
    title2 = title2.apply(update1);

    // User 2 makes an unrelated edit
    const update2 = title2.replace(8, 8, " Content", {clientIdForTest: 2});
    title2 = update2.newTitle;

    // User 1 undoes their edit
    const undo1 = assertExists(update1.invert(title1, {clientIdForTest: 1}));
    title1 = undo1.newTitle;

    // User 1 receives User 2's update
    title1 = title1.apply(update2);

    // User 2 receives User 1's undo
    title2 = title2.apply(undo1);

    // Check both documents converged
    expect(title1.getText()).toEqual(title2.getText());
    expect(title1.getText()).toEqual("Original Content");

    // User 1 redoes their edit
    const redo1 = assertExists(undo1.invert(title1, {clientIdForTest: 1}));
    title1 = redo1.newTitle;

    // User 2 receives the redo
    title2 = title2.apply(redo1);

    // Check both documents converged again
    expect(title1.getText()).toEqual(title2.getText());
    expect(title1.getText()).toEqual("Modified Content");
});

test("handles concurrent editing with Unicode surrogate pairs and emojis", () => {
    // Include characters that require surrogate pairs to ensure UTF-16 handling
    const text = "😀🚀👨‍👩‍👧‍👦";
    const title = TaskTitleModel.fromText(text, {clientIdForTest: 1});

    // User 2 inserts between the emoji face and rocket
    const update1 = title.replace(2, 2, "👍", {clientIdForTest: 2});

    // User 3 deletes the family emoji
    const update2 = title.replace(4, text.length, "", {clientIdForTest: 3});

    // Apply in different orders
    const title12 = title.apply(update1).apply(update2);
    const title21 = title.apply(update2).apply(update1);

    // Both should converge
    expect(title12.getText()).toEqual(title21.getText());
    expect(title12.getText()).toEqual("😀👍🚀");

    // Check that emoji operations with combining characters work properly
    const updated = title12.replace(4, 6, "🧙‍♀️", {clientIdForTest: 4}).newTitle;
    expect(updated.getText()).toEqual("😀👍🧙‍♀️");
});

test("maintains data integrity when same update is applied multiple times", () => {
    const title = TaskTitleModel.fromText("Testing", {clientIdForTest: 1});

    // Create an update
    const update = title.replace(0, 7, "Modified", {clientIdForTest: 2});

    // Apply the same update multiple times
    const multiTitle = title.apply(update).apply(update).apply(update);

    // Should be the same as applying once
    const singleTitle = title.apply(update);

    expect(multiTitle.getText()).toEqual(singleTitle.getText());
    expect(multiTitle.getText()).toEqual("Modified");

    // Apply some other updates between duplicate applications
    let complexTitle = title;
    complexTitle = complexTitle.apply(update);
    complexTitle = complexTitle.replace(8, 8, " Text", {clientIdForTest: 3}).newTitle;
    complexTitle = complexTitle.apply(update);
    complexTitle = complexTitle.replace(13, 13, "!", {clientIdForTest: 4}).newTitle;
    complexTitle = complexTitle.apply(update);

    // Content should remain consistent
    expect(complexTitle.getText()).toEqual("Modified Text!");
});

test("gracefully handles empty operations in sequence", () => {
    const title = TaskTitleModel.fromText("Sample text", {clientIdForTest: 1});

    // Create a sequence of operations where some operations are no-ops
    // (they don't actually change anything)

    // First replace "Sample" with itself - this should be a no-op internally
    const update1 = title.replace(0, 6, "Sample", {clientIdForTest: 2});

    // Add something at the end
    const update2 = title.replace(11, 11, "!", {clientIdForTest: 3});

    // Apply in order
    const resultTitle = title.apply(update1).apply(update2);

    // Should be the same as just applying the second update
    const expectedTitle = title.apply(update2);

    expect(resultTitle.getText()).toEqual(expectedTitle.getText());
    expect(resultTitle.getText()).toEqual("Sample text!");
});

test("correctly handles updates with empty document states", () => {
    // Start with empty doc
    const empty = emptyTaskTitleModel.get();

    // Multiple users add text independently to the empty document
    const update1 = empty.replace(0, 0, "First text", {clientIdForTest: 1});
    const update2 = empty.replace(0, 0, "Second text", {clientIdForTest: 2});

    // Apply in different orders
    const doc12 = empty.apply(update1).apply(update2);
    const doc21 = empty.apply(update2).apply(update1);

    // Should converge to the same document with both texts
    expect(doc12.getText()).toEqual(doc21.getText());

    // Now delete all content and converge to empty again
    const clearDoc = doc12.replace(0, doc12.getText().length, "", {clientIdForTest: 3});

    // From the clear state, add new content
    const update3 = clearDoc.newTitle.replace(0, 0, "New content", {clientIdForTest: 4});

    // Result should be just the new content
    expect(update3.newTitle.getText()).toEqual("New content");
});

// Helper function to create a title with multiple nodes
function createMultiNodeTitle(): TaskTitleModel {
    // Create a title with multiple independent nodes by using separate client IDs
    const empty = emptyTaskTitleModel.get();

    // First segment - creates first node
    const update1 = empty.replace(0, 0, "First segment ", {clientIdForTest: 1});

    // Second segment - creates a second node
    const update2 = empty.replace(0, 0, "Second segment ", {clientIdForTest: 2});

    // Third segment - creates a third node
    const update3 = empty.replace(0, 0, "Third segment", {clientIdForTest: 3});

    return empty.apply(update1).apply(update2).apply(update3);
}

// Helper to check XML text node structure in a title
function getXmlTextNodeCount(title: TaskTitleModel): number {
    const doc = title.getDocForTest();
    const fragment = doc.getXmlFragment("doc");

    let count = 0;
    let node = fragment.firstChild;
    while (node !== null) {
        count++;
        node = node.nextSibling;
    }

    return count;
}

// Helper to get the lengths of all XML text nodes
function getXmlTextNodeLengths(title: TaskTitleModel): Array<number> {
    const doc = title.getDocForTest();
    const fragment = doc.getXmlFragment("doc");

    const lengths = [];
    let node = fragment.firstChild;
    while (node !== null) {
        if (node instanceof Y.XmlText) {
            lengths.push(node.length);
        }
        node = node.nextSibling;
    }

    return lengths;
}

test("creates a document with multiple nodes", () => {
    const title = createMultiNodeTitle();

    // Verify text content
    expect(title.getText()).toEqual("First segment Second segment Third segment");

    // Verify node structure - should have 3 nodes
    expect(getXmlTextNodeCount(title)).toEqual(3);

    // Verify the node lengths add up to the total length
    const lengths = getXmlTextNodeLengths(title);
    expect(lengths).toEqual([14, 15, 13]);
});

test("deletes content spanning across multiple nodes", () => {
    const title = createMultiNodeTitle();
    const initialNodeCount = getXmlTextNodeCount(title);

    // Delete content that spans across the first and second nodes
    // "First segment Second segment Third segment"
    //        |____________|
    // Deleting from position 6 to 20 ("segment Second")
    const updatedTitle = title.replace(6, 20, "", {clientIdForTest: 4}).newTitle;

    // Verify the text content is correct after deletion
    expect(updatedTitle.getText()).toEqual("First  segment Third segment");

    // Node count should remain the same but content should be removed
    expect(getXmlTextNodeCount(updatedTitle)).toEqual(initialNodeCount);
});

test("deletes content spanning all nodes", () => {
    const title = createMultiNodeTitle();

    // Delete the entire content across all nodes
    const updatedTitle = title.replace(0, title.getText().length, "", {
        clientIdForTest: 4,
    }).newTitle;

    // Verify text is empty
    expect(updatedTitle.getText()).toEqual("");

    // The structure should still exist with empty nodes
    expect(getXmlTextNodeCount(updatedTitle)).toBeGreaterThan(0);

    // All nodes should have zero length
    const lengths = getXmlTextNodeLengths(updatedTitle);
    expect(lengths.every(length => length === 0)).toBe(true);
});

test("deletes partial content from each node", () => {
    const title = createMultiNodeTitle();
    // "First segment Second segment Third segment"

    // Delete every "segment" substring from the title
    // This requires deleting from parts of each node
    let updatedTitle = title;

    // Delete "segment" from first node
    updatedTitle = updatedTitle.replace(6, 13, "", {clientIdForTest: 4}).newTitle;

    // Delete "segment" from second node
    updatedTitle = updatedTitle.replace(14, 21, "", {clientIdForTest: 5}).newTitle;

    // Delete "segment" from third node
    updatedTitle = updatedTitle.replace(21, 28, "", {clientIdForTest: 6}).newTitle;

    // Verify the text content
    expect(updatedTitle.getText()).toEqual("First  Second  Third ");

    // Node count should remain the same
    expect(getXmlTextNodeCount(updatedTitle)).toEqual(getXmlTextNodeCount(title));
});

test("inserts content at boundary between nodes", () => {
    const title = createMultiNodeTitle();
    const initialNodeCount = getXmlTextNodeCount(title);
    const initialNodeLengths = getXmlTextNodeLengths(title);

    // Insert at the boundary between first and second nodes (after index 13)
    const updatedTitle = title.replace(14, 14, "INSERTED ", {clientIdForTest: 4}).newTitle;

    // Verify text content
    expect(updatedTitle.getText()).toEqual("First segment INSERTED Second segment Third segment");

    // Node count should still be the same
    expect(getXmlTextNodeCount(updatedTitle)).toEqual(initialNodeCount);

    // The lengths should be updated accordingly
    const newLengths = getXmlTextNodeLengths(updatedTitle);
    // One of the nodes should have increased in length by 9 ("INSERTED ")
    expect(newLengths.reduce((sum, len) => sum + len, 0)).toEqual(
        initialNodeLengths.reduce((sum, len) => sum + len, 0) + 9,
    );
});

test("inserts content spanning positions in multiple nodes", () => {
    const title = createMultiNodeTitle();

    // Replace content that spans across nodes with new text
    // "First segment Second segment Third segment"
    //        |____________________|
    // Replace "segment Second segment" with "REPLACEMENT"
    const updatedTitle = title.replace(6, 28, "REPLACEMENT", {clientIdForTest: 4}).newTitle;

    // Verify the text content
    expect(updatedTitle.getText()).toEqual("First REPLACEMENT Third segment");

    // Node structure may change, but the text content should be correct
    expect(getXmlTextNodeCount(updatedTitle)).toBeGreaterThan(0);
});

test("deletes from start of one node to middle of another node", () => {
    const title = createMultiNodeTitle();

    // Delete from start of second node to middle of third node
    // "First segment Second segment Third segment"
    //                |__________________|
    const updatedTitle = title.replace(14, 35, "", {clientIdForTest: 4}).newTitle;

    // Verify the text content
    expect(updatedTitle.getText()).toEqual("First segment segment");

    // The structure should still have multiple nodes
    expect(getXmlTextNodeCount(updatedTitle)).toBeGreaterThan(1);
});

test("simultaneously inserts at multiple node boundaries", () => {
    const title = createMultiNodeTitle();

    // Create two concurrent inserts at different node boundaries
    const update1 = title.replace(14, 14, "[A]", {clientIdForTest: 4});
    const update2 = title.replace(29, 29, "[B]", {clientIdForTest: 5});

    // Apply both updates
    const updatedTitle = title.apply(update1.raw).apply(update2.raw);

    // Verify the text content
    expect(updatedTitle.getText()).toEqual("First segment [A]Second segment [B]Third segment");

    // Node count may increase but should still function correctly
    expect(getXmlTextNodeCount(updatedTitle)).toBeGreaterThan(0);
});

test("replaces content spanning into each node with different text", () => {
    const title = createMultiNodeTitle();

    // Replace parts of each node with new content
    let updatedTitle = title;

    // Replace part of first node
    updatedTitle = updatedTitle.replace(0, 5, "1st", {clientIdForTest: 4}).newTitle;

    // Replace part of second node
    updatedTitle = updatedTitle.replace(12, 18, "2nd", {clientIdForTest: 5}).newTitle;

    // Replace part of third node
    updatedTitle = updatedTitle.replace(24, 29, "3rd", {clientIdForTest: 6}).newTitle;

    // Verify the text content
    expect(updatedTitle.getText()).toEqual("1st segment 2nd segment 3rd segment");

    // Node count should remain the same
    expect(getXmlTextNodeCount(updatedTitle)).toEqual(getXmlTextNodeCount(title));
});

test("inserts large content between nodes then deletes it", () => {
    const title = createMultiNodeTitle();

    // Insert large text between first and second nodes
    const largeText = "X".repeat(1000);
    const withLargeText = title.replace(14, 14, largeText, {clientIdForTest: 4}).newTitle;

    // Verify large text was inserted correctly
    expect(withLargeText.getText()).toContain(largeText);
    expect(withLargeText.getText().length).toEqual(title.getText().length + 1000);

    // Now delete that large text
    const deleteLargeText = withLargeText.replace(14, 1014, "", {clientIdForTest: 5}).newTitle;

    // Should be back to original text
    expect(deleteLargeText.getText()).toEqual(title.getText());
});

test("performs multiple operations on overlapping node boundaries", () => {
    const title = createMultiNodeTitle();

    // Sequence of operations that cross node boundaries
    let updatedTitle = title;

    // 1. Insert at the start
    updatedTitle = updatedTitle.replace(0, 0, "START: ", {clientIdForTest: 4}).newTitle;

    // 2. Delete across first node boundary
    updatedTitle = updatedTitle.replace(10, 20, "", {clientIdForTest: 5}).newTitle;

    // 3. Insert in the middle spanning a node boundary
    updatedTitle = updatedTitle.replace(15, 15, "[MIDDLE]", {clientIdForTest: 6}).newTitle;

    // 4. Replace the end spanning the last node boundary
    updatedTitle = updatedTitle.replace(
        updatedTitle.getText().length - 10,
        updatedTitle.getText().length,
        "END",
        {clientIdForTest: 7},
    ).newTitle;

    // Verify the text is modified but structure is maintained
    expect(updatedTitle.getText()).not.toEqual(title.getText());
    expect(getXmlTextNodeCount(updatedTitle)).toBeGreaterThan(0);

    // Final text integrity check
    const finalText = updatedTitle.getText();
    expect(finalText.startsWith("START: ")).toBe(true);
    expect(finalText.includes("[MIDDLE]")).toBe(true);
    expect(finalText.endsWith("END")).toBe(true);
});

test("inserts at every position across multiple nodes", () => {
    const title = createMultiNodeTitle();
    const initialText = title.getText();
    let updatedTitle = title;

    // Insert characters at various positions throughout the text
    for (let i = 0; i <= initialText.length; i += 5) {
        updatedTitle = updatedTitle.replace(i, i, "*", {clientIdForTest: i + 10}).newTitle;
    }

    // Verify the text now contains stars
    const finalText = updatedTitle.getText();
    expect(finalText.length).toEqual(initialText.length + Math.floor(initialText.length / 5) + 1);

    // Count the stars
    const starCount = (finalText.match(/\*/g) || []).length;
    expect(starCount).toEqual(Math.floor(initialText.length / 5) + 1);
});

test("deletes across node boundaries with position updates", () => {
    // Create a title with more nodes for complex deletion patterns
    let title = emptyTaskTitleModel.get();

    const updates: Array<TaskTitleUpdateModel> = [];

    // Create 5 separate nodes
    for (let i = 1; i <= 5; i++) {
        updates.push(
            title.replace(0, 0, `Node${i}-`, {
                clientIdForTest: i,
            }),
        );
    }

    title = updates.reduce((title, update) => title.apply(update), title);

    // Text should be "Node1-Node2-Node3-Node4-Node5-"
    expect(title.getText()).toEqual("Node1-Node2-Node3-Node4-Node5-");

    // Verify we have 5 nodes
    expect(getXmlTextNodeCount(title)).toEqual(5);

    // Now perform a series of deletions that affect position references

    // Delete Node2 completely
    title = title.replace(6, 12, "", {clientIdForTest: 10}).newTitle;
    expect(title.getText()).toEqual("Node1-Node3-Node4-Node5-");

    // Delete first half of Node3 and second half of Node4
    title = title.replace(6, 15, "", {clientIdForTest: 11}).newTitle;
    expect(title.getText()).toEqual("Node1-e4-Node5-");

    // Delete across Node1 and Node5 (the first and last remaining nodes)
    title = title.replace(2, 14, "", {clientIdForTest: 12}).newTitle;

    // Verify final text
    expect(title.getText()).toEqual("No-");

    // Structure should still exist with content removed
    expect(getXmlTextNodeCount(title)).toBeGreaterThan(0);
});

test("handles complex insert/delete sequence on multiple nodes", () => {
    const title = createMultiNodeTitle();

    // A sequence of edits that repeatedly insert and delete content across node boundaries
    let updatedTitle = title;

    // Insert at start
    updatedTitle = updatedTitle.replace(0, 0, "PREFIX-", {clientIdForTest: 1}).newTitle;

    // Delete across first boundary
    updatedTitle = updatedTitle.replace(13, 20, "", {clientIdForTest: 2}).newTitle;

    // Insert at a position that was just affected by the delete
    updatedTitle = updatedTitle.replace(13, 13, "NEW-", {clientIdForTest: 3}).newTitle;

    // Delete content that includes the just-inserted text
    updatedTitle = updatedTitle.replace(10, 17, "", {clientIdForTest: 4}).newTitle;

    // Insert at end
    updatedTitle = updatedTitle.replace(
        updatedTitle.getText().length,
        updatedTitle.getText().length,
        "-SUFFIX",
        {clientIdForTest: 5},
    ).newTitle;

    // Verify text integrity after complex operations
    const finalText = updatedTitle.getText();
    expect(finalText.startsWith("PREFIX")).toBe(true);
    expect(finalText.endsWith("SUFFIX")).toBe(true);
});

test("deletes empty nodes and ensures correct insertion points", () => {
    // Create a title with empty nodes by deleting content but preserving structure
    const title = createMultiNodeTitle();

    // Delete all content but preserve node structure
    const emptyNodesTitle = title.replace(0, title.getText().length, "", {
        clientIdForTest: 10,
    }).newTitle;

    // Verify text is empty
    expect(emptyNodesTitle.getText()).toEqual("");

    // Structure should still exist
    const nodeCount = getXmlTextNodeCount(emptyNodesTitle);
    expect(nodeCount).toBeGreaterThan(0);

    // Now insert new content at position 0
    const newContent = "Brand new content";
    const updatedTitle = emptyNodesTitle.replace(0, 0, newContent, {clientIdForTest: 11}).newTitle;

    // Text should be correct
    expect(updatedTitle.getText()).toEqual(newContent);

    // Structure should still maintain node boundaries
    expect(getXmlTextNodeCount(updatedTitle)).toEqual(nodeCount);
});

test("interleaves delete and insert operations across node boundaries", () => {
    const title = createMultiNodeTitle();

    // Create operations that alternate between delete and insert across node boundaries
    let updatedTitle = title;

    // Delete first segment's "segment"
    updatedTitle = updatedTitle.replace(5, 13, "", {clientIdForTest: 1}).newTitle;

    // Insert at boundary of first and second segments
    updatedTitle = updatedTitle.replace(6, 6, "-INSERT1-", {clientIdForTest: 2}).newTitle;

    // Delete second segment's "segment"
    updatedTitle = updatedTitle.replace(22, 30, "", {clientIdForTest: 3}).newTitle;

    // Insert at boundary of second and third segments
    updatedTitle = updatedTitle.replace(22, 22, "-INSERT2-", {clientIdForTest: 4}).newTitle;

    // Delete third segment's "segment"
    updatedTitle = updatedTitle.replace(37, 44, "", {clientIdForTest: 5}).newTitle;

    // Verify the final text
    const finalText = updatedTitle.getText();
    expect(finalText).toEqual("First -INSERT1-Second -INSERT2-Third ");
});

test("works with multiple concurrent edits spanning same node boundaries", () => {
    const title = createMultiNodeTitle();

    // Two users both try to modify content spanning the same nodes

    // User 1 replaces content across first and second node
    const update1 = title.replace(10, 20, "USER1", {clientIdForTest: 1});

    // User 2 replaces overlapping content
    const update2 = title.replace(5, 25, "USER2", {clientIdForTest: 2});

    // Apply in different orders
    const title12 = title.apply(update1.raw).apply(update2.raw);
    const title21 = title.apply(update2.raw).apply(update1.raw);

    // Both should converge to the same content
    expect(title12.getText()).toEqual(title21.getText());

    // And node structure should be preserved
    expect(getXmlTextNodeCount(title12)).toBeGreaterThan(0);
    expect(getXmlTextNodeCount(title12)).toEqual(getXmlTextNodeCount(title21));
});

test("handles last-character special case in multi-node documents", () => {
    const title = createMultiNodeTitle();
    const lastPos = title.getText().length;

    // Test operations on the last character

    // Delete the last character
    const withLastDeleted = title.replace(lastPos - 1, lastPos, "", {clientIdForTest: 1}).newTitle;
    expect(withLastDeleted.getText()).toEqual(title.getText().substring(0, lastPos - 1));

    // Add character at the very end
    const withAddedEnd = title.replace(lastPos, lastPos, "!", {clientIdForTest: 2}).newTitle;
    expect(withAddedEnd.getText()).toEqual(title.getText() + "!");

    // Replace the last character
    const withReplacedLast = title.replace(lastPos - 1, lastPos, "?", {
        clientIdForTest: 3,
    }).newTitle;
    expect(withReplacedLast.getText()).toEqual(title.getText().substring(0, lastPos - 1) + "?");
});

test("deletes alternating characters across node boundaries", () => {
    const title = createMultiNodeTitle();
    const text = title.getText();

    let updatedTitle = title;

    // Delete every other character across the entire string
    // This will cross node boundaries in a complex pattern
    for (let i = text.length; i - 1 >= 0; i -= 2) {
        updatedTitle = updatedTitle.replace(i - 1, i, "", {clientIdForTest: i}).newTitle;
    }

    // Verify we've deleted roughly half the content
    expect(updatedTitle.getText().length).toBeCloseTo(text.length / 2, 0);

    // Node structure should be preserved
    expect(getXmlTextNodeCount(updatedTitle)).toEqual(getXmlTextNodeCount(title));
});

// #endregion 2025-03-05 AI tests
