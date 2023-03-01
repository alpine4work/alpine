import {fireEvent, render, screen} from "@testing-library/react";
import {EditorView} from "prosemirror-view";
import React, {useState} from "react";
import {ContentEditor, getEditorViewForTest} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {emptyContentReferences} from "~/shared/content/content_references";
import {emptyDocumentWithoutTitleContent} from "~/shared/content/document_content_schema";
import {UnimplementedError} from "~/shared/error/error";

function TestContentEditor() {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            doc: emptyDocumentWithoutTitleContent,
            references: emptyContentReferences,
        }),
    );
    return (
        <ContentEditor
            aria-label="Test"
            state={state}
            onChange={setState}
            onNavigate={() => {
                throw new UnimplementedError("Can not navigate in test");
            }}
        />
    );
}

// Get the textbox `HTMLElement`.
function getTextbox(): HTMLElement {
    return screen.getByRole("textbox");
}

// Get the ProseMirror `EditorView`.
function getEditor(): EditorView {
    return getEditorViewForTest(getTextbox().parentNode);
}

// Get the ProseMirror document `Node`.
function getDoc() {
    return getEditor().state.doc;
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
