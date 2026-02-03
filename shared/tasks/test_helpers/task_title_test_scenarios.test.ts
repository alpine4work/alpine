import {Fragment, Slice} from "prosemirror-model";
import {EditorState} from "prosemirror-state";
import {ReplaceStep} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {prosemirrorToYXmlFragment, ySyncPlugin} from "y-prosemirror";
import * as Y from "yjs";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    sentenceTaskTitleTestScenario,
    wordTaskTitleTestScenario,
} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";
import {
    TaskTitle,
    TaskTitleProsemirrorSchema,
    TaskTitleUpdate,
} from "~/shared/tasks/title/task_title.js";

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(TaskTitleProsemirrorSchema.text(text)), 0, 0);
}

test("`wordTaskTitleTestScenario` is correct", () => {
    const node = TaskTitleProsemirrorSchema.node("doc", {}, []);

    const doc = new Y.Doc();
    // Don't generate a new `clientID` every time.
    doc.clientID = 2020888681;

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

    expect(wordTaskTitleTestScenario).toEqual({
        title0,
        update0: updates[0]!,
        title1,
        update1: updates[1]!,
        title2,
        update2: updates[2]!,
        title3,
        update3: updates[3]!,
        title4,
    });
});

test("`sentenceTaskTitleTestScenario` is correct", () => {
    const node = TaskTitleProsemirrorSchema.node("doc", {}, []);

    const doc = new Y.Doc();
    // Don't generate a new `clientID` every time.
    doc.clientID = 2020888681;

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
    view.dispatch(view.state.tr.step(new ReplaceStep(0, 0, textSlice("The "))));
    const title1 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(4, 4, textSlice("quick "))));
    const title2 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(10, 10, textSlice("(\u201Cbrown\u201D) "))));
    const title3 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(20, 20, textSlice("fox "))));
    const title4 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(24, 24, textSlice("can\u2019t "))));
    const title5 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(30, 30, textSlice("jump "))));
    const title6 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(35, 35, textSlice("32.3 "))));
    const title7 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(40, 40, textSlice("feet, "))));
    const title8 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;
    view.dispatch(view.state.tr.step(new ReplaceStep(46, 46, textSlice("right?"))));
    const title9 = Y.encodeStateAsUpdateV2(doc) as TaskTitle;

    expect(view.state.doc.toString()).toEqual(
        // eslint-disable-next-line cyberworlds/string-quotes
        'doc("The quick (\u201Cbrown\u201D) fox can\u2019t jump 32.3 feet, right?")',
    );

    assert(updates.length === 9);

    expect(sentenceTaskTitleTestScenario).toEqual({
        title0,
        update0: updates[0],
        title1,
        update1: updates[1],
        title2,
        update2: updates[2],
        title3,
        update3: updates[3],
        title4,
        update4: updates[4],
        title5,
        update5: updates[5],
        title6,
        update6: updates[6],
        title7,
        update7: updates[7],
        title8,
        update8: updates[8],
        title9,
        title: title9,
    });
});
