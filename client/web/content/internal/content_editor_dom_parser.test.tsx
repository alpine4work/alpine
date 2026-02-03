/* eslint-disable cyberworlds/string-quotes */

import {fireEvent, render, screen} from "@testing-library/react";
import {closeHistory} from "prosemirror-history";
import {Node} from "prosemirror-model";
import {EditorState, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {useState} from "react";
import {act} from "react-dom/test-utils";
import {ContentEditor, getEditorViewForTest} from "~/client/web/content/content_editor.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {markMemoIfNotRendering} from "~/client/web/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    DocumentContentProsemirrorSchema,
    DocumentWithoutTitleContent,
    DocumentWithoutTitleContentProsemirrorSchema,
    emptyDocumentWithoutTitleContent,
} from "~/shared/documents/document_content_schema.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

// eslint-disable-next-line testing-library/render-result-naming-convention
const fileAttachmentTarget = markMemoIfNotRendering({
    type: "Document",
    documentId: generateId(),
} as const satisfies FileAttachmentTarget);

// eslint-disable-next-line testing-library/render-result-naming-convention
const commentFileAttachmentTarget = markMemoIfNotRendering({
    type: "DocumentComments",
    documentId: fileAttachmentTarget.documentId,
} as const satisfies FileAttachmentTarget);

function TestContentEditor({
    initialContent = emptyDocumentWithoutTitleContent,
}: {
    initialContent?: Node;
}) {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            doc: initialContent as DocumentWithoutTitleContent,
            references: emptyContentReferences,
        }),
    );
    return (
        <ContentEditor
            aria-label="Test"
            state={state}
            onChange={state => act(() => setState(state))}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />
    );
}

// Get the textbox `HTMLElement`.
function getTextbox(): HTMLElement {
    return screen.getByRole("textbox");
}

// Get the ProseMirror `EditorView`.
function getEditor(): EditorView {
    assert(getEditorViewForTest);
    return getEditorViewForTest(getTextbox().parentNode);
}

// Get the ProseMirror document `Node`.
function getDoc() {
    return getEditor().state.doc;
}

// Get the ProseMirror selection.
function getSelection() {
    return getEditor().state.selection.toJSON();
}

// Dispatch a ProseMirror transaction. Use this to simulate a code powered
// transformation of the document.
function dispatch(buildTransaction: (state: EditorState) => Transaction) {
    const editor = getEditor();
    const transaction = buildTransaction(editor.state);

    // Each of these test transactions should be a single history stack item.
    closeHistory(transaction);

    act(() => {
        editor.dispatch(transaction);
    });
}

function pasteHtmlTextClipboardEvent(pasteText: string) {
    return {
        clipboardData: {
            getData: (type: string) => {
                return type === "text/html" ? pasteText : null;
            },
        },
    };
}

test("will paste Google Docs nested list HTML", async () => {
    render(<TestContentEditor />);

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            '<meta charset=\'utf-8\'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-779afe9c-7fff-9617-cedd-687f82739d7e"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:12pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Item 1</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Item 1.1</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:square;font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="3"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Item 1.1.1</span></p></li><ol style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:decimal;font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="4"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Item 1.1.1</span></p></li></ol></ul></ul></ul><ol style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:decimal;font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Item 2</span></p></li><ol style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:lower-alpha;font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Item 2.1</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:square;font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="3"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Item 2.1.1</span></p></li><li dir="ltr" style="list-style-type:square;font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="3"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:12pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Item 2.1.2</span></p></li></ul></ol></ol></b>',
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("Item 1")), unorderedListItem(indent: 1, paragraph("Item 1.1")), unorderedListItem(indent: 2, paragraph("Item 1.1.1")), orderedListItem(indent: 3, paragraph("Item 1.1.1")), orderedListItem(paragraph("Item 2")), orderedListItem(indent: 1, paragraph("Item 2.1")), unorderedListItem(indent: 2, paragraph("Item 2.1.1")), unorderedListItem(indent: 2, paragraph("Item 2.1.2")))',
    );
});

test("will paste Dropbox Paper nested list HTML", async () => {
    render(<TestContentEditor />);

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            '<meta charset=\'utf-8\'><ul class="listtype-bullet listindent1 list-bullet1"><li><span class=" author-d-iz88z86z86za0dz67zz78zz78zz74zz68zjz80zz71z9iz90za3z66zumgz76zz84zz88zgz89zuz82zz82zeg2z71z8ez90zz77zz87z157oz122zz73z6u">Item 1</span></li><ul class="listtype-bullet listindent2 list-bullet2"><li><span class=" author-d-iz88z86z86za0dz67zz78zz78zz74zz68zjz80zz71z9iz90za3z66zumgz76zz84zz88zgz89zuz82zz82zeg2z71z8ez90zz77zz87z157oz122zz73z6u">Item 1.1</span></li><ul class="listtype-bullet listindent3 list-bullet3"><li><span class=" author-d-iz88z86z86za0dz67zz78zz78zz74zz68zjz80zz71z9iz90za3z66zumgz76zz84zz88zgz89zuz82zz82zeg2z71z8ez90zz77zz87z157oz122zz73z6u">Item 1.1.1</span></li><ol  start="1" class="listtype-number listindent4 list-number4" style="list-style-type: decimal;"><li><span class=" author-d-iz88z86z86za0dz67zz78zz78zz74zz68zjz80zz71z9iz90za3z66zumgz76zz84zz88zgz89zuz82zz82zeg2z71z8ez90zz77zz87z157oz122zz73z6u">Item 1.1.1</span></li></ol></ul></ul></ul><ol  start="1" class="listtype-number listindent1 list-number1" style="list-style-type: decimal;"><li><span class=" author-d-iz88z86z86za0dz67zz78zz78zz74zz68zjz80zz71z9iz90za3z66zumgz76zz84zz88zgz89zuz82zz82zeg2z71z8ez90zz77zz87z157oz122zz73z6u">Item 2</span></li><ol  start="1" class="listtype-number listindent2 list-number2" style="list-style-type: lower-latin;"><li><span class=" author-d-iz88z86z86za0dz67zz78zz78zz74zz68zjz80zz71z9iz90za3z66zumgz76zz84zz88zgz89zuz82zz82zeg2z71z8ez90zz77zz87z157oz122zz73z6u">Item 2.1</span></li><ul class="listtype-bullet listindent3 list-bullet3"><li><span class=" author-d-iz88z86z86za0dz67zz78zz78zz74zz68zjz80zz71z9iz90za3z66zumgz76zz84zz88zgz89zuz82zz82zeg2z71z8ez90zz77zz87z157oz122zz73z6u">Item 2.1.1</span></li><li><span class=" author-d-iz88z86z86za0dz67zz78zz78zz74zz68zjz80zz71z9iz90za3z66zumgz76zz84zz88zgz89zuz82zz82zeg2z71z8ez90zz77zz87z157oz122zz73z6u">Item 2.1.2</span></li></ul></ol></ol>',
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("Item 1")), unorderedListItem(indent: 1, paragraph("Item 1.1")), unorderedListItem(indent: 2, paragraph("Item 1.1.1")), orderedListItem(indent: 3, paragraph("Item 1.1.1")), orderedListItem(paragraph("Item 2")), orderedListItem(indent: 1, paragraph("Item 2.1")), unorderedListItem(indent: 2, paragraph("Item 2.1.1")), unorderedListItem(indent: 2, paragraph("Item 2.1.2")))',
    );
});

test("will paste Notion nested list HTML", async () => {
    render(<TestContentEditor />);

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            "<meta charset='utf-8'><ul>\n<li>Item 1\n<ul>\n<li>Item 1.1\n<ul>\n<li>Item 1.1.1\n<ol>\n<li>Item 1.1.1</li>\n</ol>\n</li>\n</ul>\n</li>\n</ul>\n</li>\n</ul>\n<ol>\n<li>Item 2\n<ol>\n<li>Item 2.1\n<ul>\n<li>Item 2.1.1</li>\n<li>Item 2.1.2</li>\n</ul>\n</li>\n</ol>\n</li>\n</ol>\n",
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("Item 1")), unorderedListItem(indent: 1, paragraph("Item 1.1")), unorderedListItem(indent: 2, paragraph("Item 1.1.1")), orderedListItem(indent: 3, paragraph("Item 1.1.1")), orderedListItem(paragraph("Item 2")), orderedListItem(indent: 1, paragraph("Item 2.1")), unorderedListItem(indent: 2, paragraph("Item 2.1.1")), unorderedListItem(indent: 2, paragraph("Item 2.1.2")))',
    );
});

test("will copy/paste nested list HTML", async () => {
    render(<TestContentEditor />);

    const html =
        "<ul><li><p>Item 1</p></li><ul><li><p>Item 1.1</p></li><ul><li><p>Item 1.1.1</p></li><ol><li><p>Item 1.1.1</p></li></ol></ul></ul></ul><ol><li><p>Item 2</p></li><ol><li><p>Item 2.1</p></li><ul><li><p>Item 2.1.1</p></li><li><p>Item 2.1.2</p></li></ul><ol><li><p>Item 2.1.3</p></li></ol></ol></ol>";

    fireEvent.paste(getTextbox(), pasteHtmlTextClipboardEvent(html));

    expect(getDoc().toString()).toEqual(
        'doc(unorderedListItem(paragraph("Item 1")), unorderedListItem(indent: 1, paragraph("Item 1.1")), unorderedListItem(indent: 2, paragraph("Item 1.1.1")), orderedListItem(indent: 3, paragraph("Item 1.1.1")), orderedListItem(paragraph("Item 2")), orderedListItem(indent: 1, paragraph("Item 2.1")), unorderedListItem(indent: 2, paragraph("Item 2.1.1")), unorderedListItem(indent: 2, paragraph("Item 2.1.2")), orderedListItem(indent: 2, paragraph("Item 2.1.3")))',
    );

    const fragment = getEditor().props.clipboardSerializer!.serializeFragment(getDoc().content);
    const element = document.createElement("div");
    element.appendChild(fragment);
    expect(element.innerHTML).toEqual(html);
});

test("will paste plain text code as code block lines", async () => {
    render(
        <TestContentEditor
            initialContent={
                schema.node("doc", null, [
                    schema.node("codeBlock", null, [schema.node("codeBlockLine", null, [])]),
                ]) as DocumentWithoutTitleContent
            }
        />,
    );

    fireEvent.paste(getTextbox(), {
        clipboardData: {
            getData: (type: string) => {
                return type === "text/plain"
                    ? `\
function main() {
  let a = 1;
  let b = 2;
  return a + b;
}`
                    : null;
            },
        },
    });

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("function main() {"), codeBlockLine("  let a = 1;"), codeBlockLine("  let b = 2;"), codeBlockLine("  return a + b;"), codeBlockLine("}")))',
    );
});

test("will copy/paste from vscode as code block lines", async () => {
    render(
        <TestContentEditor
            initialContent={
                schema.node("doc", null, [
                    schema.node("codeBlock", null, [schema.node("codeBlockLine", null, [])]),
                ]) as DocumentWithoutTitleContent
            }
        />,
    );

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<div style="color: #cccccc;background-color: #1f1f1f;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;"><div><span style="color: #569cd6;">function</span><span style="color: #cccccc;"> </span><span style="color: #dcdcaa;">addNumbers</span><span style="color: #cccccc;">() {</span></div><div><span style="color: #cccccc;">    </span><span style="color: #569cd6;">const</span><span style="color: #cccccc;"> </span><span style="color: #4fc1ff;">a</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">=</span><span style="color: #cccccc;"> </span><span style="color: #b5cea8;">1</span><span style="color: #cccccc;">;</span></div><div><span style="color: #cccccc;">    </span><span style="color: #569cd6;">const</span><span style="color: #cccccc;"> </span><span style="color: #4fc1ff;">b</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">=</span><span style="color: #cccccc;"> </span><span style="color: #b5cea8;">2</span><span style="color: #cccccc;">;</span></div><div><span style="color: #cccccc;">    </span><span style="color: #c586c0;">return</span><span style="color: #cccccc;"> </span><span style="color: #4fc1ff;">a</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">+</span><span style="color: #cccccc;"> </span><span style="color: #4fc1ff;">b</span><span style="color: #cccccc;">;</span></div><div><span style="color: #cccccc;">}</span></div></div>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("function addNumbers() {"), codeBlockLine("    const a = 1;"), codeBlockLine("    const b = 2;"), codeBlockLine("    return a + b;"), codeBlockLine("}")))',
    );
});

test("will copy/paste from gist as code block lines", async () => {
    render(
        <TestContentEditor
            initialContent={
                schema.node("doc", null, [
                    schema.node("codeBlock", null, [schema.node("codeBlockLine", null, [])]),
                ]) as DocumentWithoutTitleContent
            }
        />,
    );

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<table data-hpc="" style="tab-size="8"" class="highlight tab-size js-file-line-container js-code-nav-container js-tagsearch-file" data-tab-size="8" data-paste-markdown-skip="" data-tagsearch-lang="JavaScript" data-tagsearch-path="gistfile1.js"><tbody><tr><td id="file-gistfile1-js-L1" class="blob-num js-line-number js-code-nav-line-number js-blob-rnum" data-line-number="1"></td><td id="file-gistfile1-js-LC1" class="blob-code blob-code-inner js-file-line"><span class="pl-k">const</span> <span class="pl-en">addNumbers</span> <span class="pl-c1">=</span> <span class="pl-kos">(</span><span class="pl-kos">)</span> <span class="pl-c1">=&gt;</span> <span class="pl-kos">{</span></td></tr><tr><td id="file-gistfile1-js-L2" class="blob-num js-line-number js-code-nav-line-number js-blob-rnum" data-line-number="2"></td><td id="file-gistfile1-js-LC2" class="blob-code blob-code-inner js-file-line">  <span class="pl-k">const</span> <span class="pl-s1">a</span> <span class="pl-c1">=</span> <span class="pl-c1">1</span><span class="pl-kos">;</span></td></tr><tr><td id="file-gistfile1-js-L3" class="blob-num js-line-number js-code-nav-line-number js-blob-rnum" data-line-number="3"></td><td id="file-gistfile1-js-LC3" class="blob-code blob-code-inner js-file-line">  <span class="pl-k">const</span> <span class="pl-s1">b</span> <span class="pl-c1">=</span> <span class="pl-c1">2</span><span class="pl-kos">;</span></td></tr><tr><td id="file-gistfile1-js-L4" class="blob-num js-line-number js-code-nav-line-number js-blob-rnum" data-line-number="4"></td><td id="file-gistfile1-js-LC4" class="blob-code blob-code-inner js-file-line">  <span class="pl-k">return</span> <span class="pl-s1">a</span> <span class="pl-c1">+</span> <span class="pl-s1">b</span><span class="pl-kos">;</span></td></tr><tr><td id="file-gistfile1-js-L5" class="blob-num js-line-number js-code-nav-line-number js-blob-rnum" data-line-number="5"></td><td id="file-gistfile1-js-LC5" class="blob-code blob-code-inner js-file-line"><span class="pl-kos">}</span></td></tr></tbody></table>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("const addNumbers = () => {"), codeBlockLine("  const a = 1;"), codeBlockLine("  const b = 2;"), codeBlockLine("  return a + b;"), codeBlockLine("}")))',
    );
});

test("will copy/paste from alpine as span code block lines", async () => {
    render(
        <TestContentEditor
            initialContent={
                schema.node("doc", null, [
                    schema.node("codeBlock", null, [schema.node("codeBlockLine", null, [])]),
                ]) as DocumentWithoutTitleContent
            }
        />,
    );

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<pre><code><span>const addNumbers = () => {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}</span></code></pre>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("const addNumbers = () => {"), codeBlockLine("  const a = 1;"), codeBlockLine("  const b = 2;"), codeBlockLine("  return a + b;"), codeBlockLine("}")))',
    );
});

test("will copy/paste from alpine as div code block lines", async () => {
    render(
        <TestContentEditor
            initialContent={
                schema.node("doc", null, [
                    schema.node("codeBlock", null, [schema.node("codeBlockLine", null, [])]),
                ]) as DocumentWithoutTitleContent
            }
        />,
    );

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<pre><code><div>const addNumbers = () => {</div><div>  const a = 1;</div><div>  const b = 2;</div><div>  return a + b;</div><div>}</div></code></pre>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(codeBlock(codeBlockLine("const addNumbers = () => {"), codeBlockLine("  const a = 1;"), codeBlockLine("  const b = 2;"), codeBlockLine("  return a + b;"), codeBlockLine("}")))',
    );
});

test("pasting paragraph content with selection in title will paste below title", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, []),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<p>While dinosaurs were ancestrally bipedal...</p><p>The first dinosaur fossils were recognized in the early 19th century...</p>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, paragraph("While dinosaurs were ancestrally bipedal..."), paragraph("The first dinosaur fossils were recognized in the early 19th century..."))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 119, head: 119});
});

test("pasting titled content with selection in title will paste into title", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, []),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<h1>Dinosaur</h1><p>While dinosaurs were ancestrally bipedal...</p><p>The first dinosaur fossils were recognized in the early 19th century...</p>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title("Dinosaur"), paragraph("While dinosaurs were ancestrally bipedal..."), paragraph("The first dinosaur fossils were recognized in the early 19th century..."))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 127, head: 127});
});

test("pasting titled content with selection in title will paste into title (with slice open start of 0)", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, []),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<h1 data-pm-slice="0 0 []">Dinosaur</h1><p>While dinosaurs were ancestrally bipedal...</p><p>The first dinosaur fossils were recognized in the early 19th century...</p>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title("Dinosaur"), paragraph("While dinosaurs were ancestrally bipedal..."), paragraph("The first dinosaur fossils were recognized in the early 19th century..."))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 127, head: 127});
});

test("pasting title only with selection in title will paste into title", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, []),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.paste(getTextbox(), pasteHtmlTextClipboardEvent(`<h1>Dinosaur</h1>`));

    expect(getDoc().toString()).toEqual('doc(title("Dinosaur"), paragraph)');
    expect(getSelection()).toEqual({type: "text", anchor: 9, head: 9});
});

test("pasting titled content with selection in title and paragraph after will paste into title", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("foo"),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(title, paragraph("foo"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<h1>Dinosaur</h1><p>While dinosaurs were ancestrally bipedal...</p><p>The first dinosaur fossils were recognized in the early 19th century...</p>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title("Dinosaur"), paragraph("While dinosaurs were ancestrally bipedal..."), paragraph("The first dinosaur fossils were recognized in the early 19th century..."), paragraph("foo"))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 127, head: 127});
});

test("pasting titled content with selection at end of paragraph with text will paste as heading", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("foo"),
                ]),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(title, paragraph("foo"))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(6))));

    expect(getDoc().toString()).toEqual('doc(title, paragraph("foo"))');
    expect(getSelection()).toEqual({type: "text", anchor: 6, head: 6});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<h1>Dinosaur</h1><p>While dinosaurs were ancestrally bipedal...</p><p>The first dinosaur fossils were recognized in the early 19th century...</p>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, paragraph("foo"), heading("Dinosaur"), paragraph("While dinosaurs were ancestrally bipedal..."), paragraph("The first dinosaur fossils were recognized in the early 19th century..."))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 134, head: 134});
});

test("pasting titled content with selection right below title (in empty paragraph) will paste a heading", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, []),
            ])}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(3))));

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<h1>Dinosaur</h1><p>While dinosaurs were ancestrally bipedal...</p><p>The first dinosaur fossils were recognized in the early 19th century...</p>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, heading("Dinosaur"), paragraph("While dinosaurs were ancestrally bipedal..."), paragraph("The first dinosaur fossils were recognized in the early 19th century..."))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 129, head: 129});
});

test("can paste Alpine code block content into code block", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "codeBlock",
                        attrs: {language: "javascript"},
                        content: [
                            {
                                type: "codeBlockLine",
                                content: [{type: "text", text: "function f1() {"}],
                            },
                            {type: "codeBlockLine", content: [{type: "text", text: "let a = 1;"}]},
                            {type: "codeBlockLine", content: [{type: "text", text: "let b = 2;"}]},
                            {type: "codeBlockLine"},
                            {
                                type: "codeBlockLine",
                                content: [{type: "text", text: "console.log(a + b);"}],
                            },
                            {type: "codeBlockLine", content: [{type: "text", text: "}"}]},
                            {type: "codeBlockLine"},
                            {
                                type: "codeBlockLine",
                                content: [{type: "text", text: "function f2() {"}],
                            },
                            {type: "codeBlockLine"},
                            {type: "codeBlockLine", content: [{type: "text", text: "}"}]},
                        ],
                    },
                ],
            })}
        />,
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, codeBlock(codeBlockLine("function f1() {"), codeBlockLine("let a = 1;"), codeBlockLine("let b = 2;"), codeBlockLine, codeBlockLine("console.log(a + b);"), codeBlockLine("}"), codeBlockLine, codeBlockLine("function f2() {"), codeBlockLine, codeBlockLine("}")))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(90))));

    expect(getDoc().toString()).toEqual(
        'doc(title, codeBlock(codeBlockLine("function f1() {"), codeBlockLine("let a = 1;"), codeBlockLine("let b = 2;"), codeBlockLine, codeBlockLine("console.log(a + b);"), codeBlockLine("}"), codeBlockLine, codeBlockLine("function f2() {"), codeBlockLine, codeBlockLine("}")))',
    );
    expect(getSelection()).toEqual({type: "text", anchor: 90, head: 90});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `\
<meta charset='utf-8'><pre data-pm-slice="2 2 []"><code data-cy-language="javascript">let c = 1;
let d = 2;

console.log(c + d);</code></pre>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, codeBlock(codeBlockLine("function f1() {"), codeBlockLine("let a = 1;"), codeBlockLine("let b = 2;"), codeBlockLine, codeBlockLine("console.log(a + b);"), codeBlockLine("}"), codeBlockLine, codeBlockLine("function f2() {"), codeBlockLine("let c = 1;"), codeBlockLine("let d = 2;"), codeBlockLine, codeBlockLine("console.log(c + d);"), codeBlockLine("}")))',
    );
});

test("can paste Alpine code block content into list item and it won't add first line of code block to list item", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        content: [{type: "paragraph", content: [{type: "text", text: "test"}]}],
                    },
                ],
            })}
        />,
    );

    expect(getDoc().toString()).toEqual('doc(title, unorderedListItem(paragraph("test")))');
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(8))));

    expect(getDoc().toString()).toEqual('doc(title, unorderedListItem(paragraph("test")))');
    expect(getSelection()).toEqual({type: "text", anchor: 8, head: 8});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `\
<meta charset='utf-8'><pre data-pm-slice="2 2 []"><code data-cy-language="javascript">let a = 1;
let b = 2;

console.log(a + b);</code></pre>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, unorderedListItem(paragraph("test")), codeBlock(codeBlockLine("let a = 1;"), codeBlockLine("let b = 2;"), codeBlockLine, codeBlockLine("console.log(a + b);")))',
    );
});

test("will paste word from VSCode", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [{type: "title"}, {type: "paragraph"}],
            })}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(3))));

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<div><div style="color: #cccccc;background-color: #1f1f1f;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;"><div><span style="color: #dcdcaa;">transformPastedDOM</span></div></div></div>`,
        ),
    );

    expect(getDoc().toString()).toEqual('doc(title, paragraph(code("transformPastedDOM")))');
});

test("will paste multiple lines of code from VSCode", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [{type: "title"}, {type: "paragraph"}],
            })}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(3))));

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<div><div style="color: #cccccc;background-color: #1f1f1f;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;"><div><span style="color: #569cd6;">const</span><span style="color: #cccccc;"> </span><span style="color: #dcdcaa;">generateFileIdWithSynchronizedClock</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">=</span><span style="color: #cccccc;"> () </span><span style="color: #569cd6;">=&gt;</span><span style="color: #cccccc;"> {</span></div><div><span style="color: #cccccc;">    </span><span style="color: #569cd6;">const</span><span style="color: #cccccc;"> </span><span style="color: #4fc1ff;">clock</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">=</span></div><div><span style="color: #cccccc;">        </span><span style="color: #dcdcaa;">getSynchronizedSystemClock</span><span style="color: #cccccc;">().</span><span style="color: #dcdcaa;">getStateWithoutListening</span><span style="color: #cccccc;">().</span><span style="color: #9cdcfe;">value</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">??</span></div><div><span style="color: #cccccc;">        </span><span style="color: #4fc1ff;">unsynchronizedSystemClock</span><span style="color: #cccccc;">;</span></div><br><div><span style="color: #cccccc;">    </span><span style="color: #c586c0;">return</span><span style="color: #cccccc;"> </span><span style="color: #dcdcaa;">generateChronologicalIdWithTime</span><span style="color: #cccccc;">&lt;</span><span style="color: #4ec9b0;">FileId</span><span style="color: #cccccc;">&gt;(</span><span style="color: #9cdcfe;">Math</span><span style="color: #cccccc;">.</span><span style="color: #dcdcaa;">round</span><span style="color: #cccccc;">(</span><span style="color: #4fc1ff;">clock</span><span style="color: #cccccc;">.</span><span style="color: #dcdcaa;">now</span><span style="color: #cccccc;">()));</span></div><div><span style="color: #cccccc;">};</span></div><br></div></div>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, codeBlock(codeBlockLine("const generateFileIdWithSynchronizedClock = () => {"), codeBlockLine("    const clock ="), codeBlockLine("        getSynchronizedSystemClock().getStateWithoutListening().value ??"), codeBlockLine("        unsynchronizedSystemClock;"), codeBlockLine("    return generateChronologicalIdWithTime<FileId>(Math.round(clock.now()));"), codeBlockLine("};")))',
    );
});

test("will paste multiple lines of code from VSCode which end with a newline", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [{type: "title"}, {type: "paragraph"}],
            })}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(3))));

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<div><div style="color: #cccccc;background-color: #1f1f1f;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;"><div><span style="color: #569cd6;">const</span><span style="color: #cccccc;"> </span><span style="color: #dcdcaa;">generateFileIdWithSynchronizedClock</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">=</span><span style="color: #cccccc;"> () </span><span style="color: #569cd6;">=&gt;</span><span style="color: #cccccc;"> {</span></div><div><span style="color: #cccccc;">    </span><span style="color: #569cd6;">const</span><span style="color: #cccccc;"> </span><span style="color: #4fc1ff;">clock</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">=</span></div><div><span style="color: #cccccc;">        </span><span style="color: #dcdcaa;">getSynchronizedSystemClock</span><span style="color: #cccccc;">().</span><span style="color: #dcdcaa;">getStateWithoutListening</span><span style="color: #cccccc;">().</span><span style="color: #9cdcfe;">value</span><span style="color: #cccccc;"> </span><span style="color: #d4d4d4;">??</span></div><div><span style="color: #cccccc;">        </span><span style="color: #4fc1ff;">unsynchronizedSystemClock</span><span style="color: #cccccc;">;</span></div><br><div><span style="color: #cccccc;">    </span><span style="color: #c586c0;">return</span><span style="color: #cccccc;"> </span><span style="color: #dcdcaa;">generateChronologicalIdWithTime</span><span style="color: #cccccc;">&lt;</span><span style="color: #4ec9b0;">FileId</span><span style="color: #cccccc;">&gt;(</span><span style="color: #9cdcfe;">Math</span><span style="color: #cccccc;">.</span><span style="color: #dcdcaa;">round</span><span style="color: #cccccc;">(</span><span style="color: #4fc1ff;">clock</span><span style="color: #cccccc;">.</span><span style="color: #dcdcaa;">now</span><span style="color: #cccccc;">()));</span></div><div><span style="color: #cccccc;">};</span></div><br><br></div></div>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, codeBlock(codeBlockLine("const generateFileIdWithSynchronizedClock = () => {"), codeBlockLine("    const clock ="), codeBlockLine("        getSynchronizedSystemClock().getStateWithoutListening().value ??"), codeBlockLine("        unsynchronizedSystemClock;"), codeBlockLine("    return generateChronologicalIdWithTime<FileId>(Math.round(clock.now()));"), codeBlockLine("};"), codeBlockLine))',
    );
});

test("don't infinitely recurse when pasting code block content with extra wrapping node", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [{type: "title"}, {type: "paragraph"}],
            })}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(3))));

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<div style="white-space: pre"><div>let a = 1;</div><span><div>let b = 2;</div></span><div>console.log(a + b);</div></div>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, codeBlock(codeBlockLine("let a = 1;"), codeBlockLine("let b = 2;"), codeBlockLine("console.log(a + b);")))',
    );
});

test("will paste markdown with content after code block from web browser", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [{type: "title"}, {type: "paragraph"}],
            })}
        />,
    );

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 1, head: 1});

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(3))));

    expect(getDoc().toString()).toEqual("doc(title, paragraph)");
    expect(getSelection()).toEqual({type: "text", anchor: 3, head: 3});

    // This simulates pasting markdown content from a web browser that includes:
    // 1. Some text before the code block
    // 2. A code block
    // 3. Some text after the code block
    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<div>
                <p>This is some text before the code block.</p>
                <pre><code>function example() {
    console.log("Hello World");
}</code></pre>
                <p>This text should appear after the code block but doesn't get pasted.</p>
                <p>Neither does this paragraph.</p>
            </div>`,
        ),
    );

    expect(getDoc().toString()).toEqual(
        'doc(title, paragraph("This is some text before the code block."), codeBlock(codeBlockLine("function example() {"), codeBlockLine("    console.log(\\"Hello World\\");"), codeBlockLine("}")), paragraph("This text should appear after the code block but doesn\'t get pasted."), paragraph("Neither does this paragraph."))',
    );
});

test("pasting list item in list item with different indentation uses the target list item\u2019s indentation", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><p data-pm-slice="1 1 [&quot;unorderedListItem&quot;,{&quot;indent&quot;:0}]">qux</p>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "qux"}]}],
            },
        ],
    });
});

test("pasting list item in list item with different indentation uses the new list item\u2019s indentation (with slice open start of 0)", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><p data-pm-slice="0 1 [&quot;unorderedListItem&quot;,{&quot;indent&quot;:0}]">qux</p>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "qux"}]}],
            },
        ],
    });
});

test("pasting list item in list item with different indentation and type (ordered list) uses the target list item\u2019s indentation and type", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><p data-pm-slice="1 1 [&quot;orderedListItem&quot;,{&quot;indent&quot;:0}]">qux</p>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "qux"}]}],
            },
        ],
    });
});

test("pasting list item in list item with different indentation and type (unordered list) uses the target list item\u2019s indentation and type", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><p data-pm-slice="1 1 [&quot;unorderedListItem&quot;,{&quot;indent&quot;:0}]">qux</p>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "orderedListItem",
                attrs: {indent: 1, orderStart: null},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "orderedListItem",
                attrs: {indent: 1, orderStart: null},
                content: [{type: "paragraph", content: [{type: "text", text: "qux"}]}],
            },
        ],
    });
});

test("pasting list item in list item with different indentation and type (check list) uses the target list item\u2019s indentation and type", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><p data-pm-slice="1 1 [&quot;checkListItem&quot;,{&quot;indent&quot;:0,&quot;checked&quot;:false}]">qux</p>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "qux"}]}],
            },
        ],
    });
});

test("pasting block quote in list item with different indentation uses the target list item\u2019s indentation", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><p data-pm-slice="1 1 [&quot;quoteBlock&quot;,null]">qux</p>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "qux"}]}],
            },
        ],
    });
});

test("pasting multiple list items in list item with different indentation uses the target list item\u2019s indentation", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><ul data-pm-slice="2 1 []"><li><p>item 1</p></li><ul><li><p>item 2</p></li><li><p>item 3</p></li></ul></ul>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "orderedListItem",
                attrs: {indent: 1, orderStart: null},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "orderedListItem",
                attrs: {indent: 1, orderStart: null},
                content: [{type: "paragraph", content: [{type: "text", text: "item 1"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 2},
                content: [{type: "paragraph", content: [{type: "text", text: "item 2"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 2},
                content: [{type: "paragraph", content: [{type: "text", text: "item 3"}]}],
            },
        ],
    });
});

test("pasting multiple paragraphs in list item puts both paragraphs in the list item", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><p data-pm-slice="1 1 []">paragraph 1</p><p>paragraph 2</p>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "paragraph 1"}],
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "paragraph 2"}],
                    },
                ],
            },
        ],
    });
});

test("pasting multiple paragraphs from a list item into another list item puts both paragraphs in the list item", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><ul data-pm-slice="2 2 []"><li><p>paragraph 1</p><p>paragraph 2</p></li></ul>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "paragraph 1"}],
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "paragraph 2"}],
                    },
                ],
            },
        ],
    });
});

test("pasting multiple paragraphs from a list item followed by more list items into another list item puts both paragraphs in the list item", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><ul data-pm-slice="2 2 []"><li><p>paragraph 1</p><p>paragraph 2</p></li><ul><li><p>item 2</p></li><li><p>item 3</p></li></ul></ul>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 1},
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "paragraph 1"}],
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "paragraph 2"}],
                    },
                ],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 2},
                content: [{type: "paragraph", content: [{type: "text", text: "item 2"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 2},
                content: [{type: "paragraph", content: [{type: "text", text: "item 3"}]}],
            },
        ],
    });
});

test("pasting multiple list items in list item with different indentation uses the target list item\u2019s indentation until a non-list item node", () => {
    render(
        <TestContentEditor
            initialContent={DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title"},
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 1},
                        content: [{type: "paragraph", content: []}],
                    },
                ],
            })}
        />,
    );

    dispatch(state => state.tr.setSelection(new TextSelection(state.doc.resolve(18))));

    fireEvent.paste(
        getTextbox(),
        pasteHtmlTextClipboardEvent(
            `<meta charset='utf-8'><ul data-pm-slice="2 2 []"><li><p>item 1</p></li><ul><li><p>item 2</p></li><li><p>item 3</p></li></ul></ul><p>paragraph</p><ul><li><p>item 4</p></li></ul>`,
        ),
    );

    expect(getDoc().toJSON()).toEqual({
        type: "doc",
        attrs: expect.any(Object),
        content: [
            {type: "title"},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "foo"}]}],
            },
            {
                type: "orderedListItem",
                attrs: {indent: 1, orderStart: null},
                content: [{type: "paragraph", content: [{type: "text", text: "bar"}]}],
            },
            {
                type: "orderedListItem",
                attrs: {indent: 1, orderStart: null},
                content: [{type: "paragraph", content: [{type: "text", text: "item 1"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 2},
                content: [{type: "paragraph", content: [{type: "text", text: "item 2"}]}],
            },
            {
                type: "unorderedListItem",
                attrs: {indent: 2},
                content: [{type: "paragraph", content: [{type: "text", text: "item 3"}]}],
            },
            {type: "paragraph", content: [{type: "text", text: "paragraph"}]},
            {
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [{type: "paragraph", content: [{type: "text", text: "item 4"}]}],
            },
        ],
    });
});
