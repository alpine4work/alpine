import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitleWithoutFallback} from "~/shared/documents/document_model.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Builds ProseMirror `ReplaceStep`s to update a document from a public-API PUT
 * payload: optional title change, then a minimal body diff.
 *
 * `newBodyContent` must be a `DocumentContent` whose `doc` children are body
 * blocks only (no title), as produced by `fromApiContent()` for document API
 * payloads.
 *
 * Steps are ordered so the title step (if any) applies before the body step (if
 * any). Returns an empty array when nothing changed.
 */
// TODO (rmtobin, #document-update-api): This function will be replaced by a more
// specific diff function.
export function createDocumentPutContentReplaceSteps(
    oldContent: DocumentContent,
    {
        newTitleText,
        newBodyContent,
    }: {
        newTitleText: string;
        newBodyContent: DocumentContent;
    },
): ReadonlyArray<ReplaceStep> {
    const steps: Array<ReplaceStep> = [];

    const initialTitleNode = oldContent.firstChild;
    assert(initialTitleNode !== null, "Document must have a title node as its first child");
    assert(initialTitleNode.type.name === "title", "First child must be a title node");

    const normalizedNewTitle = newTitleText.trim();
    let docForBodyDiff = oldContent;

    if (normalizedNewTitle !== getDocumentContentTitleWithoutFallback(oldContent)) {
        const newTitleNode =
            normalizedNewTitle.length > 0
                ? DocumentContentProsemirrorSchema.node("title", {}, [
                      DocumentContentProsemirrorSchema.text(normalizedNewTitle),
                  ])
                : DocumentContentProsemirrorSchema.node("title", {}, []);

        // Document content positions run from `0` to `doc.content.size`; the body starts
        // at cumulative offset `titleNode.nodeSize`.
        const titleStep = new ReplaceStep(
            0,
            initialTitleNode.nodeSize,
            new Slice(Fragment.from(newTitleNode), 0, 0),
        );
        steps.push(titleStep);

        const titleApplied = titleStep.apply(oldContent);
        assert(
            titleApplied.failed === null && titleApplied.doc !== null,
            titleApplied.failed ?? "Untitled Document",
        );
        docForBodyDiff = assertDocumentContent(titleApplied.doc);
    }

    const titleNode = docForBodyDiff.firstChild;
    assert(titleNode !== null, "Document must have a title node as its first child");

    const oldBodyContent = docForBodyDiff.content.cut(titleNode.nodeSize);
    const diffStart = oldBodyContent.findDiffStart(newBodyContent.content);
    if (diffStart === null) {
        return steps;
    }

    const diffEnd = oldBodyContent.findDiffEnd(newBodyContent.content);
    assert(diffEnd !== null, "findDiffEnd must not be null when findDiffStart is not null");

    const $from = docForBodyDiff.resolve(titleNode.nodeSize + diffStart);
    const from = $from.depth > 0 ? $from.before(1) : titleNode.nodeSize + diffStart;

    const $to = docForBodyDiff.resolve(titleNode.nodeSize + diffEnd.a);
    const to = $to.depth > 0 ? $to.after(1) : titleNode.nodeSize + diffEnd.a;

    const $newTo = newBodyContent.resolve(diffEnd.b);
    const newTo = $newTo.depth > 0 ? $newTo.after(1) : diffEnd.b;

    const slice = new Slice(newBodyContent.content.cut(from - titleNode.nodeSize, newTo), 0, 0);
    steps.push(new ReplaceStep(from, to, slice));

    return steps;
}
