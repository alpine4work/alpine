import {Fragment, Slice} from "prosemirror-model";
import {EditorState} from "prosemirror-state";
import {ReplaceStep} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {prosemirrorToYXmlFragment, ySyncPlugin} from "y-prosemirror";
import * as Y from "yjs";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskTitle, TaskTitleProsemirrorSchema, TaskTitleUpdate} from "~/shared/tasks/task_title.js";
import {taskTitleTestScenario} from "~/shared/tasks/task_title_test_helpers.js";

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(TaskTitleProsemirrorSchema.text(text)), 0, 0);
}

test("`titleUpdateScenario` is correct", () => {
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

    expect(taskTitleTestScenario).toEqual({
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
