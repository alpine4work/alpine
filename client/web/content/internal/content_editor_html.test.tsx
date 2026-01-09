// To update generated snapshots run:
//
// ```
// bazel run //client/web/content:internal/content_editor_html_test -- --updateSnapshot
// ```

import {fireEvent, render, screen} from "@testing-library/react";
import {Mark, Node} from "prosemirror-model";
import {TextSelection} from "prosemirror-state";
import {ReactNode, useState} from "react";
import {act} from "react-dom/test-utils";
import {ContentEditor, getEditorViewForTest} from "~/client/web/content/content_editor.js";
import {
    ContentFileEntityRenderers,
    ContentFileEntityRenderersContext,
} from "~/client/web/content/content_file_entity_renderers_context.js";
import {disableStartMaintainingFileForTest} from "~/client/web/content/file_registry.js";
import {
    ContentEditorState,
    getContentEditorReferences,
} from "~/client/web/content/state/content_editor_state.js";
import {AppContext, AppContextProvider} from "~/client/web/context/app_context.js";
import {ReactContextModule} from "~/client/web/context/react_context_module.js";
import {markMemoIfNotRendering} from "~/client/web/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {TestSpaceContextProvider} from "~/client/web/spaces/space_context_provider.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences, emptyContentReferences} from "~/shared/content/content_references.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import * as contentClassNameByName from "~/shared/design/core/constant_class_names.js";
import {
    DocumentWithoutTitleContentProsemirrorSchema,
    emptyDocumentWithoutTitleContent,
} from "~/shared/documents/document_content_schema.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId, getFileEntityTypes} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, ChannelId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {getContentReferencesWithoutFiles} from "~/shared/rpc/content_rpc_definitions.js";
import {attachFileFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";
import {TestRpcContextModule} from "~/shared/rpc/test_rpc_context_module.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {createTestSpaceModel} from "~/shared/spaces/test_helpers/space_model_test_helpers.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

// We use constant, expired, signed URLs so our test snapshots don't change
// every test run. Disable URL refreshing in this test file.
disableStartMaintainingFileForTest();

const schema = DocumentWithoutTitleContentProsemirrorSchema;

const blockTestCases: Array<{
    only?: CommitBlocker;
    name: string;
    disableInlineTests?: boolean | ((inlineTestCase: (typeof inlineTestCases)[number]) => boolean);
    references?: ContentReferences;
    build: (content: Array<Node>) => Node;
    buildPasted?: (content: Array<Node>) => Node;
}> = [
    {
        name: "paragraph",
        build: content => schema.node("paragraph", {}, content),
    },
    {
        name: "heading 1",
        build: content => schema.node("heading", {level: 1}, content),
    },
    {
        name: "heading 2",
        build: content => schema.node("heading", {level: 2}, content),
    },
    {
        name: "heading 3",
        build: content => schema.node("heading", {level: 3}, content),
    },
    {
        name: "quote",
        build: content => schema.node("quoteBlock", {}, schema.node("paragraph", {}, content)),
    },
    {
        name: "code",
        disableInlineTests: inlineTestCase => inlineTestCase.name === "code",
        build: content => schema.node("codeBlock", {}, schema.node("codeBlockLine", {}, content)),

        // When pasting a single line of code, we don't maintain the code block.
        // Instead we unwrap the code block into plain text with the `code` mark. That
        // way you can copy a single word from a code block and paste it into a
        // paragraph without creating a new code block in the middle of the paragraph.
        buildPasted: content =>
            schema.node(
                "paragraph",
                {},
                content.map(node => node.mark(schema.mark("code").addToSet(node.marks))),
            ),
    },
    {
        name: "code (multiline)",
        disableInlineTests: inlineTestCase => inlineTestCase.name === "code",
        build: content =>
            schema.node("codeBlock", {}, [
                schema.node("codeBlockLine", {}, content),
                schema.node("codeBlockLine", {}, []),
                schema.node("codeBlockLine", {}, [schema.text("  "), ...content]),
                schema.node("codeBlockLine", {}, content),
            ]),
    },
    {
        name: "bullet list",
        build: content =>
            schema.node("unorderedListItem", {}, [schema.node("paragraph", {}, content)]),
    },
    {
        name: "ordered list",
        build: content =>
            schema.node("orderedListItem", {}, [schema.node("paragraph", {}, content)]),
    },
    {
        name: "ordered list (explicit start)",
        build: content =>
            schema.node("orderedListItem", {orderStart: 4}, [
                schema.node("paragraph", {}, content),
            ]),
    },
    {
        name: "check list (unchecked)",
        build: content =>
            schema.node("checkListItem", {checked: false}, schema.node("paragraph", {}, content)),
    },
    {
        name: "check list (checked)",
        build: content =>
            schema.node("checkListItem", {checked: true}, schema.node("paragraph", {}, content)),
    },
    {
        name: "2x2 table (1st row has content) ",
        build: content =>
            schema.node("table", {columnWidths: [1, 1], tableWidth: 1}, [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, content)]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
            ]),
    },
    {
        name: "2x2 table (1st row has content) ",
        build: content =>
            schema.node("table", {columnWidths: [1, 1], tableWidth: 1}, [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, content)]),
                ]),
            ]),
    },
    {
        name: "3x3 table (1st row has content) ",
        build: content =>
            schema.node("table", {columnWidths: [1, 1, 1], tableWidth: 1}, [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, content)]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
            ]),
    },
    {
        name: "3x3 table (2nd row has content) ",
        build: content =>
            schema.node("table", {columnWidths: [1, 1, 1], tableWidth: 1}, [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, content)]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
            ]),
    },
    {
        name: "3x3 table (3rd row has content) ",
        build: content =>
            schema.node("table", {columnWidths: [1, 1, 1], tableWidth: 1}, [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    schema.node("tableCell", {}, [schema.node("paragraph", {}, content)]),
                ]),
            ]),
    },
    {
        name: "table with multiple blocks in cells (1st cell with content, 2nd cell empty)",
        build: content =>
            schema.node("table", {columnWidths: [1, 1], tableWidth: 1}, [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, content),
                        schema.node("paragraph", {}, content),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, []),
                        schema.node("paragraph", {}, []),
                    ]),
                ]),
            ]),
    },
    {
        name: "table with multiple blocks in cells (1st cell empty, 2nd cell with content)",
        build: content =>
            schema.node("table", {columnWidths: [1, 1], tableWidth: 1}, [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, []),
                        schema.node("paragraph", {}, []),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, content),
                        schema.node("paragraph", {}, content),
                    ]),
                ]),
            ]),
    },
];

const inlineTestCases: Array<{
    name: string;
    disableClipboardTests?: boolean;
    build: () => Mark;
}> = [
    {
        name: "bold",
        build: () => schema.mark("bold"),
    },
    {
        name: "italic",
        build: () => schema.mark("italic"),
    },
    {
        name: "strike",
        build: () => schema.mark("strike"),
    },
    {
        name: "code",
        build: () => schema.mark("code"),
    },
    {
        name: "highlight",
        build: () => schema.mark("highlight", {color: "green"}),
    },
    {
        name: "link",
        build: () => schema.mark("link", {url: "https://example.com/"}),
    },
    {
        name: "link (XSS vulnerability)",
        disableClipboardTests: true,
        build: () => schema.mark("link", {url: "javascript:alert('XSS')"}), // eslint-disable-line no-script-url, string-quotes
    },
];

const contentClassNameAndVars = new Set<string>(
    concatIterables(
        Object.values(omitObject(contentClassNameByName, ["highlightClassNameByColor"])),
        Object.values(contentClassNameByName.highlightClassNameByColor),
    ),
);

// CSS classes and variable names may change after minor modifications to our
// vanilla extract CSS. So remove them from the HTML so we assert against so
// our test doesn't keep breaking. We keep any class names declared in
// `content_styles.ts` since those stay constant.
function stripHtml(originalElement: HTMLElement): HTMLElement {
    const element = originalElement.cloneNode(true) as HTMLElement;

    for (const className of [...element.classList]) {
        if (!contentClassNameAndVars.has(className)) {
            element.classList.remove(className);
        }
    }

    if (element.classList.length === 0) {
        element.removeAttribute("class");
    }

    // Remove code block toolbars from the DOM since they contribute the text of
    // their language picker button label.
    for (const childElement of element.getElementsByClassName(
        contentStyles.codeBlockToolbarClassName,
    )) {
        childElement.remove();
    }

    for (const childElement of element.querySelectorAll("[class]")) {
        for (const className of [...childElement.classList]) {
            if (!contentClassNameAndVars.has(className)) {
                childElement.classList.remove(className);
            }
        }

        if (childElement.classList.length === 0) {
            childElement.removeAttribute("class");
        }
    }

    for (const childElement of element.querySelectorAll("[style]")) {
        assert(childElement instanceof HTMLElement || childElement instanceof SVGElement);

        const removeProperties: Array<string> = [];

        for (let i = 0; i < childElement.style.length; i++) {
            const property = childElement.style[i]!;

            if (property.startsWith("--") && !contentClassNameAndVars.has(`var(${property})`)) {
                removeProperties.push(property);
            }
        }

        for (const property of removeProperties) {
            childElement.style.removeProperty(property);
        }
    }

    // Clear SVG image element contents.
    for (const svgElement of element.querySelectorAll("svg")) {
        svgElement.innerHTML = "";
    }

    // Clear `<img>` element contents.
    for (const imgElement of element.querySelectorAll("img")) {
        imgElement.removeAttribute("src");
    }

    return element;
}

const createdTime = new Date("2024-10-02T14:15:13.833Z");

const space = createTestSpaceModel({
    id: assertId<SpaceId>("pv9hmw9x4nkzpnn404ntddmbp0"),
});

// For any code that needs to parse the `SpaceId` from the URL.
window.history.replaceState(null, "", `/s/${space.id}/test`);

const currentAccount = createTestAccountModel({
    id: assertId<AccountId>("y6j4bejce5hf26d8kmatrf9dec"),
    name: "Budd Deey",
});

const otherAccount = createTestAccountModel({
    id: assertId<AccountId>("nyghmwnpt2pwy22qrn9b6j9254"),
    name: "Sara Smith",
});

const context: AppContext = Context.new({
    tracer: new TracerContextModule(testTracer),
    rpc: new TestRpcContextModule(),
    react: ReactContextModule.newForClient(),
    constants: new ConstantsContextModule({
        edgeServiceUrl: "https://test.cyberworlds.dev",
        resourceServiceUrl: "http://localhost",
    }),
});

const testContentFileEntityRenderers: ContentFileEntityRenderers = {
    renderPreviewByType: createObjectFromKeys(getFileEntityTypes(), () => noop),
    addPreviewBehaviorByType: {},
};

function TestContextProvider({children}: {children: ReactNode}) {
    return (
        <AppContextProvider value={context}>
            <TestSpaceContextProvider initialSpace={space} currentAccount={currentAccount}>
                <ContentFileEntityRenderersContext.Provider value={testContentFileEntityRenderers}>
                    {children}
                </ContentFileEntityRenderersContext.Provider>
            </TestSpaceContextProvider>
        </AppContextProvider>
    );
}

// eslint-disable-next-line testing-library/render-result-naming-convention
const fileAttachmentTarget = markMemoIfNotRendering({
    type: "Document",
    documentId: assertId("ccnhhk3ndrf5n254dwwm9asvx0"),
} as const satisfies FileAttachmentTarget);

// eslint-disable-next-line testing-library/render-result-naming-convention
const commentFileAttachmentTarget = markMemoIfNotRendering({
    type: "DocumentComments",
    documentId: fileAttachmentTarget.documentId,
} as const satisfies FileAttachmentTarget);

// eslint-disable-next-line testing-library/render-result-naming-convention
const otherFileAttachmentTarget = markMemoIfNotRendering({
    type: "Document",
    documentId: assertId("6p2w6asgyqpnetx2k4gnw6rmjw"),
} as const satisfies FileAttachmentTarget);

// eslint-disable-next-line testing-library/render-result-naming-convention
const otherCommentFileAttachmentTarget = markMemoIfNotRendering({
    type: "DocumentComments",
    documentId: otherFileAttachmentTarget.documentId,
} as const satisfies FileAttachmentTarget);

const fileImagePreviewPlaceholder = new FileImagePreviewPlaceholder([
    [
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
    ],
    [
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
    ],
    [
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
    ],
]);

for (const blockTestCase of blockTestCases) {
    const test = blockTestCase.only ? globalThis.test.only : globalThis.test;

    test(`${blockTestCase.name} empty`, async () => {
        const content = schema.node("doc", {}, [blockTestCase.build([])]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: blockTestCase.references ?? emptyContentReferences,
                })}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />,
        );

        const strippedElement = stripHtml(screen.getByRole("textbox"));

        expect(strippedElement).toHaveTextContent("");

        await expectClipboardRoundtripToWork(
            blockTestCase.buildPasted
                ? schema.node("doc", {}, [blockTestCase.buildPasted([])])
                : undefined,
        );
    });

    test(`${blockTestCase.name} plain`, async () => {
        const content = schema.node("doc", {}, [
            blockTestCase.build([schema.text("Hello world!")]),
        ]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: blockTestCase.references ?? emptyContentReferences,
                })}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");
        expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

        await expectClipboardRoundtripToWork(
            blockTestCase.buildPasted
                ? schema.node("doc", {}, [blockTestCase.buildPasted([schema.text("Hello world!")])])
                : undefined,
        );
    });

    for (const inlineTestCase of inlineTestCases) {
        if (
            blockTestCase.disableInlineTests &&
            (typeof blockTestCase.disableInlineTests === "boolean" ||
                blockTestCase.disableInlineTests(inlineTestCase))
        ) {
            continue;
        }

        test(`${blockTestCase.name} ${inlineTestCase.name}`, async () => {
            const content = schema.node("doc", {}, [
                blockTestCase.build([
                    schema.text("Hello "),
                    schema.text("world", [inlineTestCase.build()]),
                    schema.text("!"),
                ]),
            ]);
            render(
                <ContentEditor
                    aria-label="Test"
                    state={ContentEditorState.create({
                        doc: content,
                        references: blockTestCase.references ?? emptyContentReferences,
                    })}
                    onChange={() => {}}
                    fileAttachmentTarget={fileAttachmentTarget}
                    commentFileAttachmentTarget={commentFileAttachmentTarget}
                />,
            );

            expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");

            if (!inlineTestCase.disableClipboardTests) {
                await expectClipboardRoundtripToWork(
                    blockTestCase.buildPasted
                        ? schema.node("doc", {}, [
                              blockTestCase.buildPasted([
                                  schema.text("Hello "),
                                  schema.text("world", [inlineTestCase.build()]),
                                  schema.text("!"),
                              ]),
                          ])
                        : undefined,
                );
            }
        });
    }
}

for (const inlineTestCase of inlineTestCases) {
    test(`${inlineTestCase.name}`, async () => {
        const content = schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Hello "),
                schema.text("world", [inlineTestCase.build()]),
                schema.text("!"),
            ]),
        ]);
        render(
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveTextContent("Hello world!");
        expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

        if (!inlineTestCase.disableClipboardTests) {
            await expectClipboardRoundtripToWork();
        }
    });
}

async function expectClipboardRoundtripToWork(expectedPastedDoc?: Node) {
    assert(getEditorViewForTest);
    // eslint-disable-next-line testing-library/no-node-access
    const editor = getEditorViewForTest(screen.getByRole("textbox").parentNode);
    const sourceContentReferences = getContentEditorReferences(editor.state).references;

    const copiedDoc = editor.state.doc;
    const copiedFragment = editor.props.clipboardSerializer!.serializeFragment(copiedDoc.content);
    const copiedFragmentText = editor.props.clipboardTextSerializer!(copiedDoc.slice(0), editor);
    const copiedElement = document.createElement("div");
    copiedElement.appendChild(copiedFragment);
    const copiedHtml = copiedElement.innerHTML;

    expect(copiedElement).toMatchSnapshot("clipboard");
    expect(copiedFragmentText).toMatchSnapshot("clipboard text");

    function TestContentEditor() {
        const [state, setState] = useState(() =>
            ContentEditorState.create({
                doc: emptyDocumentWithoutTitleContent,
                references: emptyContentReferences,
            }),
        );

        return (
            <TestContextProvider>
                <ContentEditor
                    aria-label="Test"
                    state={state}
                    onChange={state => {
                        act(() => {
                            setState(state);
                        });
                    }}
                    // Use a different file attachment target to exercise `<ContentEditor>`s ability
                    // to create a new attachment.
                    fileAttachmentTarget={otherFileAttachmentTarget}
                    commentFileAttachmentTarget={otherCommentFileAttachmentTarget}
                />
            </TestContextProvider>
        );
    }

    const {container, unmount} = render(<TestContentEditor />);

    // eslint-disable-next-line testing-library/no-node-access
    const pasteEditor = getEditorViewForTest((container as any).firstElementChild);

    expect(pasteEditor.state.doc.toString()).toEqual("doc(paragraph)");
    expect(pasteEditor.state.selection.anchor).toEqual(1);
    expect(pasteEditor.state.selection.head).toEqual(1);

    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.paste((container as any).firstElementChild.firstElementChild, {
        clipboardData: {
            types: ["text/html"],
            getData: (type: string) => {
                return type === "text/html" ? copiedHtml : null;
            },
        },
    });

    // Wait for the promise microtask queue to empty so we can observe
    // `<ContentEditor>`'s RPC executions.
    await waitMacrotask();

    const isAsync =
        TestRpcContextModule.getExecutions(getContentReferencesWithoutFiles).length > 0 ||
        TestRpcContextModule.getExecutions(attachFileFromAttachment).length > 0;

    if (isAsync) {
        // For asynchronous pastes we want to exercise that the selection is properly
        // remembered. So insert some content and move the selection into that content.
        // We'll delete the extra content once the paste is done.
        //
        // The paste should happen in the empty paragraph which is where the selection
        // was when we fired the paste event.
        act(() => {
            const transaction = pasteEditor.state.tr.insert(
                0,
                schema.node("paragraph", {}, [schema.text("test")]),
            );

            pasteEditor.dispatch(
                transaction.setSelection(new TextSelection(transaction.doc.resolve(3))),
            );
        });

        // eslint-disable-next-line string-quotes
        expect(pasteEditor.state.doc.toString()).toEqual('doc(paragraph("test"), paragraph)');
        expect(pasteEditor.state.selection.anchor).toEqual(3);
        expect(pasteEditor.state.selection.head).toEqual(3);

        await act(async () => {
            for (const execution of TestRpcContextModule.getExecutions(
                getContentReferencesWithoutFiles,
            )) {
                if (execution.outputPromiseResolver.isSettled()) continue;

                execution.outputPromiseResolver.resolve({
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map(
                            filterMapIterable(
                                execution.input.referencedIds.accountIds,
                                accountId => {
                                    const account =
                                        sourceContentReferences.accountById.get(accountId);
                                    if (!account) return;
                                    return [accountId, account];
                                },
                            ),
                        ),
                        fileEntityById: new Map(
                            filterMapIterable(
                                execution.input.referencedIds.fileEntityIds,
                                fileEntityId => {
                                    const fileEntity =
                                        sourceContentReferences.fileEntityById?.get(fileEntityId);
                                    if (!fileEntity) return;
                                    return [fileEntityId, fileEntity];
                                },
                            ),
                        ),
                    },
                });
            }

            for (const execution of TestRpcContextModule.getExecutions(attachFileFromAttachment)) {
                if (execution.outputPromiseResolver.isSettled()) continue;

                const {file} = assertExists(
                    sourceContentReferences.fileById?.get(execution.input.fileId),
                );

                execution.outputPromiseResolver.resolve({
                    signedUrlSearch: "?exp=1727963390&sig=test-clipboard",
                    file,
                });
            }

            // Wait for the promise microtask queue to empty so we can observe
            // `<ContentEditor>`'s update to the DOM after resolving
            // `attachFileFromAttachment()`.
            await waitMacrotask();
        });

        // eslint-disable-next-line string-quotes
        expect(pasteEditor.state.doc.toString()).not.toEqual('doc(paragraph("test"), paragraph)');
        expect(pasteEditor.state.doc.toString()).toMatch(/^doc\(paragraph\("test"\),/);

        act(() => {
            pasteEditor.dispatch(pasteEditor.state.tr.delete(0, 5));
        });
    }

    const pastedDoc = pasteEditor.state.doc;

    expect(pastedDoc.toString()).toEqual((expectedPastedDoc ?? copiedDoc).toString());

    // The string representation of a doc doesn't include all attributes. So do a
    // full JSON equality test as well.
    expect(pastedDoc.toJSON()).toEqual((expectedPastedDoc ?? copiedDoc).toJSON());

    unmount();
}

test("divider", async () => {
    const content = schema.node("doc", {}, [schema.node("divider")]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("heading cannot have a level lower than 1", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: 0}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: -42}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");
});

test("heading cannot have a level greater than 3", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: 4}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h4");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: 42}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h4");
});

test("heading cannot be the wrong type", () => {
    const {rerender} = render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: ""}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: "secondary"}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");

    rerender(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: true}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h2");
});

test("heading is converted into an integer", () => {
    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({
                doc: schema.node("doc", {}, [
                    schema.node("heading", {level: 2.5}, [schema.text("Test")]),
                ]),
                references: emptyContentReferences,
            })}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(screen.getByRole("heading").tagName.toLowerCase()).toEqual("h3");
});

describe("links", () => {
    const validLinks = ["http://example.com", "https://example.com", "mailto:test@example.com"];

    const formattedLinks = ["example.com", "calendar.example.com"];

    const invalidLinks = [
        // eslint-disable-next-line no-script-url, string-quotes
        "javascript:alert('XSS')",
        "file:///Users/calebmer/cyberworlds/package.json",
        "tel:+123456789",
    ];

    for (const link of validLinks) {
        test(`link with a valid scheme is accepted: ${link}`, () => {
            render(
                <ContentEditor
                    aria-label="Test"
                    state={ContentEditorState.create({
                        doc: schema.node("doc", {}, [
                            schema.node("paragraph", {}, [
                                schema.text("Test", [
                                    schema.mark("link", {
                                        url: link,
                                    }),
                                ]),
                            ]),
                        ]),
                        references: emptyContentReferences,
                    })}
                    onChange={() => {}}
                    fileAttachmentTarget={fileAttachmentTarget}
                    commentFileAttachmentTarget={commentFileAttachmentTarget}
                />,
            );

            expect(screen.getByRole<HTMLAnchorElement>("link").href).toEqual(
                `${link}${link.startsWith("http") ? "/" : ""}`,
            );
        });
    }

    for (const link of formattedLinks) {
        test(`link with a valid format but no scheme is accepted: ${link}`, () => {
            render(
                <ContentEditor
                    aria-label="Test"
                    state={ContentEditorState.create({
                        doc: schema.node("doc", {}, [
                            schema.node("paragraph", {}, [
                                schema.text("Test", [
                                    schema.mark("link", {
                                        url: link,
                                    }),
                                ]),
                            ]),
                        ]),
                        references: emptyContentReferences,
                    })}
                    onChange={() => {}}
                    fileAttachmentTarget={fileAttachmentTarget}
                    commentFileAttachmentTarget={commentFileAttachmentTarget}
                />,
            );

            expect(screen.getByRole<HTMLAnchorElement>("link").href).toEqual(`https://${link}/`);
        });
    }

    for (const link of invalidLinks) {
        test(`link with an invalid format is blocked: ${link}`, () => {
            render(
                <ContentEditor
                    aria-label="Test"
                    state={ContentEditorState.create({
                        doc: schema.node("doc", {}, [
                            schema.node("paragraph", {}, [
                                schema.text("Test", [
                                    schema.mark("link", {
                                        url: link,
                                    }),
                                ]),
                            ]),
                        ]),
                        references: emptyContentReferences,
                    })}
                    onChange={() => {}}
                    fileAttachmentTarget={fileAttachmentTarget}
                    commentFileAttachmentTarget={commentFileAttachmentTarget}
                />,
            );

            expect(screen.getByRole<HTMLAnchorElement>("link").href).toEqual("about:blank#blocked");
        });
    }
});

test("bullet list with multiple items", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("ordered list with multiple items", async () => {
    const content = schema.node("doc", {}, [
        schema.node("orderedListItem", {}, schema.node("paragraph", {}, schema.text("Item 1"))),
        schema.node("orderedListItem", {}, schema.node("paragraph", {}, schema.text("Item 2"))),
        schema.node("orderedListItem", {}, schema.node("paragraph", {}, schema.text("Item 3"))),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("check list with multiple items", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "checkListItem",
            {checked: true},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "checkListItem",
            {checked: false},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "checkListItem",
            {checked: true},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("bullet list with sub-list", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "unorderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("ordered list with sub-list", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "orderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("check list with sub-list", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "checkListItem",
            {indent: 0, checked: true},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: true},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: false},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: true},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("bullet list with sub-list of another type", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "unorderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("ordered list with sub-list of another type", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "orderedListItem",
            {indent: 0},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: true},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: false},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "checkListItem",
            {indent: 1, checked: true},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("check list with sub-list of another type", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "checkListItem",
            {indent: 0, checked: true},
            schema.node("paragraph", {}, schema.text("Test")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 1")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 2")),
        ),
        schema.node(
            "orderedListItem",
            {indent: 1},
            schema.node("paragraph", {}, schema.text("Item 3")),
        ),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("breaks inside paragraphs", async () => {
    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("Hello…"),
            schema.node("break"),
            schema.text("…world!"),
        ]),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("breaks inside list items", async () => {
    const content = schema.node("doc", {}, [
        schema.node("unorderedListItem", {}, [
            schema.node("paragraph", {}, [
                schema.text("Hello…"),
                schema.node("break"),
                schema.text("…world!"),
            ]),
        ]),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("multiple paragraphs inside list items", async () => {
    const content = schema.node("doc", {}, [
        schema.node("unorderedListItem", {}, [
            schema.node("paragraph", {}, [schema.text("Hello…")]),
            schema.node("paragraph", {}, [schema.text("…world!")]),
        ]),
    ]);

    render(
        <ContentEditor
            aria-label="Test"
            state={ContentEditorState.create({doc: content, references: emptyContentReferences})}
            onChange={() => {}}
            fileAttachmentTarget={fileAttachmentTarget}
            commentFileAttachmentTarget={commentFileAttachmentTarget}
        />,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("account long mention", async () => {
    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.node("mention", {
                mention: cast<ContentMention>({
                    type: "Account",
                    accountId: otherAccount.id,
                    isShort: false,
                }),
            }),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        accountById: new Map([[assertId(otherAccount.id), otherAccount]]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("account short mention", async () => {
    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.node("mention", {
                mention: cast<ContentMention>({
                    type: "Account",
                    accountId: otherAccount.id,
                    isShort: true,
                }),
            }),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        accountById: new Map([[assertId(otherAccount.id), otherAccount]]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("unknown account mention", async () => {
    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.node("mention", {
                mention: cast<ContentMention>({
                    type: "Account",
                    accountId: otherAccount.id,
                    isShort: true,
                }),
            }),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("search entity mention", async () => {
    const documentId = assertId<DocumentId>("qkanxhj066jh311428tsr0psp4");

    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.node("mention", {
                mention: {type: "SearchEntity", entityId: `Document:${documentId}`},
            }),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        searchEntityById: new Map([
            [
                cast<SearchMentionEntityId>(`Document:${documentId}`),
                {
                    isPrivate: false,
                    entity: new SearchEntityModel({
                        id: `Document:${documentId}`,
                        title: "foobar",
                        titleVersion: null,
                        media: null,
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("unknown search entity mention", async () => {
    const documentId = assertId<DocumentId>("qkanxhj066jh311428tsr0psp4");

    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.node("mention", {
                mention: {type: "SearchEntity", entityId: `Document:${documentId}`},
            }),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("private search entity mention", async () => {
    const documentId = assertId<DocumentId>("qkanxhj066jh311428tsr0psp4");

    const content = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.node("mention", {
                mention: {type: "SearchEntity", entityId: `Document:${documentId}`},
            }),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        searchEntityById: new Map([
            [cast<SearchMentionEntityId>(`Document:${documentId}`), {isPrivate: true}],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file row (one file)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [schema.node("file", {fileId: "0694v4cbx7m1126vx03wpkpg8g"})]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694v4cbx7m1126vx03wpkpg8g"),
                {
                    signedUrlSearch: "?exp=1727963596&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4cbx7m1126vx03wpkpg8g"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file row (one file, null reference)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [schema.node("file", {fileId: null})]),
    ]);

    const contentReferences: ContentReferences = emptyContentReferences;

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file row (one file, image type)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [schema.node("file", {fileId: "0694vd0kf4fdbwb7f1jqtzgt7g"})]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694vd0kf4fdbwb7f1jqtzgt7g"),
                {
                    signedUrlSearch: "?exp=1727880757&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694vd0kf4fdbwb7f1jqtzgt7g"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file row (one file, video type)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [schema.node("file", {fileId: "0694vdm01x4ngm31kmm41wsg3m"})]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694vdm01x4ngm31kmm41wsg3m"),
                {
                    signedUrlSearch: "?exp=1727880767&sig=test-video",
                    file: new FileModel({
                        id: assertId("0694vdm01x4ngm31kmm41wsg3m"),
                        contentType: "video/mp4",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                            videoDuration: 5000,
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file row (one file, audio type)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [schema.node("file", {fileId: "0694vdt0nc1d3zr0vh2j2jrtvg"})]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694vdt0nc1d3zr0vh2j2jrtvg"),
                {
                    signedUrlSearch: "?exp=1727880774&sig=test-audio",
                    file: new FileModel({
                        id: assertId("0694vdt0nc1d3zr0vh2j2jrtvg"),
                        contentType: "audio/mp4",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Audio",
                            isProcessing: false,
                            ok: true,
                            duration: 5000,
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file row (one file, channel entity)", async () => {
    const channelId = assertId<ChannelId>("xh0gwk1xajfh6s7fat4c1f0hyr");

    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [schema.node("file", {fileId: `Channel:${channelId}`})]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileEntityById: new Map([
            [
                cast<FileEntityId>(`Channel:${channelId}`),
                {
                    ok: true,
                    value: new FileEntityModel(FileChannelEntityModelSchema, {
                        type: "Channel",
                        versions: [32],
                        id: channelId,
                        createdTime,
                        isSubscribed: false,
                        name: "Test Channel",
                        description: {
                            doc: assertMessageContent(
                                MessageContentProsemirrorSchema.node("doc", null, [
                                    MessageContentProsemirrorSchema.node("paragraph", null, [
                                        MessageContentProsemirrorSchema.text(
                                            "This is a channel where we talk about some stuff. Here’s a description that wraps onto multiple lines.",
                                        ),
                                    ]),
                                ]),
                            ),
                            references: emptyContentReferences,
                        },
                        contributorCount: 2,
                        topContributors: [currentAccount, otherAccount],
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file row (two files)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [
            schema.node("file", {fileId: "0694v4mxds3kj518c0dygx272c"}),
            schema.node("file", {fileId: "0694v4myryc3289pwhcnwt7f7r"}),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694v4mxds3kj518c0dygx272c"),
                {
                    signedUrlSearch: "?exp=1727963615&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4mxds3kj518c0dygx272c"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
            [
                assertId("0694v4myryc3289pwhcnwt7f7r"),
                {
                    signedUrlSearch: "?exp=1727963629&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4myryc3289pwhcnwt7f7r"),
                        contentType: "image/heif",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: {
                            isProcessing: false,
                            ok: true,
                            contentType: "image/avif",
                            contentLength: 1200 ** 2,
                            isImagePreviewContent: true,
                        },
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                            content: {
                                contentType: "image/avif",
                                contentLength: 1200 ** 2,
                            },
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file row (three files)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [
            schema.node("file", {fileId: "0694v4nwky4vgc8ep46mzz5th8"}),
            schema.node("file", {fileId: "0694v4phegz57116pce7eg5j30"}),
            schema.node("file", {fileId: "0694v4q3yh9765742w7305p0fg"}),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694v4nwky4vgc8ep46mzz5th8"),
                {
                    signedUrlSearch: "?exp=1727963706&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4nwky4vgc8ep46mzz5th8"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
            [
                assertId("0694v4phegz57116pce7eg5j30"),
                {
                    signedUrlSearch: "?exp=1727963711&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4phegz57116pce7eg5j30"),
                        contentType: "image/heif",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: {
                            isProcessing: false,
                            ok: true,
                            contentType: "image/avif",
                            contentLength: 1200 ** 2,
                            isImagePreviewContent: true,
                        },
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                            content: {
                                contentType: "image/avif",
                                contentLength: 1200 ** 2,
                            },
                        },
                    }),
                },
            ],
            [
                assertId("0694v4q3yh9765742w7305p0fg"),
                {
                    signedUrlSearch: "?exp=1727963716&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4q3yh9765742w7305p0fg"),
                        contentType: "image/png",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file float (left direction)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileFloat", {direction: "left"}, [
            schema.node("file", {fileId: "0694v4sk2v7sxcrpdd9qdxxx78"}),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694v4sk2v7sxcrpdd9qdxxx78"),
                {
                    signedUrlSearch: "?exp=1727963748&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4sk2v7sxcrpdd9qdxxx78"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("file float (right direction)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("fileFloat", {direction: "right"}, [
            schema.node("file", {fileId: "0694v4v4se8v5pxdk7j5adnecm"}),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694v4v4se8v5pxdk7j5adnecm"),
                {
                    signedUrlSearch: "?exp=1727963751&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4v4se8v5pxdk7j5adnecm"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("table with fileRowTable (one file)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("table", {columnWidths: [1, 1, 1], tableWidth: 1}, [
            schema.node("tableRow", {}, [
                schema.node("tableCell", {}, [
                    schema.node("fileRowTable", {}, [
                        schema.node("file", {fileId: "0694v4cbx7m1126vx03wpkpg8g"}),
                    ]),
                ]),
                schema.node("tableCell", {}, [
                    schema.node("paragraph", {}, [schema.text("col2-test")]),
                ]),
                schema.node("tableCell", {}, [
                    schema.node("paragraph", {}, [schema.text("col3-test")]),
                ]),
            ]),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694v4cbx7m1126vx03wpkpg8g"),
                {
                    signedUrlSearch: "?exp=1727963596&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4cbx7m1126vx03wpkpg8g"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();
    await expectClipboardRoundtripToWork();
});

test("table with fileRowTable (mixed content)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("table", {columnWidths: [1, 1], tableWidth: 1}, [
            schema.node("tableRow", {}, [
                schema.node("tableCell", {}, [
                    schema.node("paragraph", {}, [schema.text("Before")]),
                    schema.node("fileRowTable", {}, [
                        schema.node("file", {fileId: "0694v4cbx7m1126vx03wpkpg8g"}),
                    ]),
                    schema.node("paragraph", {}, [schema.text("After")]),
                ]),
                schema.node("tableCell", {}, [
                    schema.node("paragraph", {}, [schema.text("Test")]),
                    schema.node("fileRowTable", {}, [
                        schema.node("file", {fileId: "0694v4mxds3kj518c0dygx272c"}),
                    ]),
                ]),
            ]),
            schema.node("tableRow", {}, [
                schema.node("tableCell", {}, [
                    schema.node("fileRowTable", {}, [
                        schema.node("file", {fileId: "0694v4phegz57116pce7eg5j30"}),
                    ]),
                ]),
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("End")])]),
            ]),
        ]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                assertId("0694v4cbx7m1126vx03wpkpg8g"),
                {
                    signedUrlSearch: "?exp=1727963596&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4cbx7m1126vx03wpkpg8g"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
            [
                assertId("0694v4mxds3kj518c0dygx272c"),
                {
                    signedUrlSearch: "?exp=1727963615&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4mxds3kj518c0dygx272c"),
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
            [
                assertId("0694v4phegz57116pce7eg5j30"),
                {
                    signedUrlSearch: "?exp=1727963711&sig=test-image",
                    file: new FileModel({
                        id: assertId("0694v4phegz57116pce7eg5j30"),
                        contentType: "image/heif",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: {
                            isProcessing: false,
                            ok: true,
                            contentType: "image/avif",
                            contentLength: 1200 ** 2,
                            isImagePreviewContent: true,
                        },
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                            content: {
                                contentType: "image/avif",
                                contentLength: 1200 ** 2,
                            },
                        },
                    }),
                },
            ],
        ]),
    };

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({doc: content, references: contentReferences})}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

test("table(2x2) with fileRowTable (null reference)", async () => {
    const content = schema.node("doc", {}, [
        schema.node("table", {columnWidths: [1, 1], tableWidth: 1}, [
            schema.node("tableRow", {}, [
                schema.node("tableCell", {}, [
                    schema.node("fileRowTable", {}, [schema.node("file", {fileId: null})]),
                ]),
                schema.node("tableCell", {}, [schema.node("paragraph", {}, [schema.text("Test")])]),
            ]),
        ]),
    ]);

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

/**
 *  +------------------+------------------------+------------------+
 *  | Header 1 (0,0)   | Header 2 (0,1)         | Header 3 (0,2)   |
 *  +------------------+------------------------+------------------+
 *  | Cell 1 (1,0)     | Cell 2 (1,1)           | Cell 3 (1,2)     |
 *  +------------------+------------------------+------------------+
 *  | Cell 4 (2,0)     | Cell 5 (2,1)           | Cell 6 (2,2)     |
 *  +------------------+------------------------+------------------+
 */
test("table(3x3) with header row only", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "table",
            {columnWidths: [1, 2, 1], tableWidth: 1.2, hasHeaderRow: true, hasHeaderColumn: false},
            [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 1 (0,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 2 (0,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 3 (0,2)")]),
                    ]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 1 (1,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 2 (1,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 3 (1,2)")]),
                    ]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 4 (2,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 5 (2,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 6 (2,2)")]),
                    ]),
                ]),
            ],
        ),
    ]);

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

/**
 *  +------------------+------------------------+------------------+
 *  | Header 1 (0,0)   | Cell 1 (0,1)           | Cell 2 (0,2)     |
 *  +------------------+------------------------+------------------+
 *  | Header 2 (1,0)   | Cell 3 (1,1)           | Cell 4 (1,2)     |
 *  +------------------+------------------------+------------------+
 *  | Header 3 (2,0)   | Cell 5 (2,1)           | Cell 6 (2,2)     |
 *  +------------------+------------------------+------------------+
 */
test("table(3x3) with header column only", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "table",
            {columnWidths: [1, 2, 1], tableWidth: 1.2, hasHeaderRow: false, hasHeaderColumn: true},
            [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 1 (0,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 1 (0,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 2 (0,2)")]),
                    ]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 2 (1,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 3 (1,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 4 (1,2)")]),
                    ]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 3 (2,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 5 (2,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 6 (2,2)")]),
                    ]),
                ]),
            ],
        ),
    ]);

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

/**
 *  +------------------+------------------------+------------------+
 *  | Header 1 (0,0)   | Header 2 (0,1)         | Header 3 (0,2)   |
 *  +------------------+------------------------+------------------+
 *  | Header 4 (1,0)   | Cell 1 (1,1)           | Cell 2 (1,2)     |
 *  +------------------+------------------------+------------------+
 *  | Header 5 (2,0)   | Cell 3 (2,1)           | Cell 4 (2,2)     |
 *  +------------------+------------------------+------------------+
 */
test("table(3x3) with both header row and column", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "table",
            {columnWidths: [1, 2, 1], tableWidth: 1.2, hasHeaderRow: true, hasHeaderColumn: true},
            [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 1 (0,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 2 (0,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 3 (0,2)")]),
                    ]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 4 (1,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 1 (1,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 2 (1,2)")]),
                    ]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Header 5 (2,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 3 (2,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 4 (2,2)")]),
                    ]),
                ]),
            ],
        ),
    ]);

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});

/**
 *  +------------------+------------------------+------------------+
 *  | Header 1 (0,0)   | Header 2 (0,1)         | Header 3 (0,2)   |
 *  +------------------+------------------------+------------------+
 *  | Header 4 (1,0)   | Cell 1 (1,1)           | Cell 2 (1,2)     |
 *  +------------------+------------------------+------------------+
 *  | Header 5 (2,0)   | Cell 3 (2,1)           | Cell 4 (2,2)     |
 *  +------------------+------------------------+------------------+
 */
test("will serialize table(3x3) with no headers", async () => {
    const content = schema.node("doc", {}, [
        schema.node(
            "table",
            {columnWidths: [1, 2, 1], tableWidth: 1.2, hasHeaderRow: false, hasHeaderColumn: false},
            [
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 1 (0,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 2 (0,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 3 (0,2)")]),
                    ]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 4 (1,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 5 (1,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 6 (1,2)")]),
                    ]),
                ]),
                schema.node("tableRow", {}, [
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 7 (2,0)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 8 (2,1)")]),
                    ]),
                    schema.node("tableCell", {}, [
                        schema.node("paragraph", {}, [schema.text("Cell 9 (2,2)")]),
                    ]),
                ]),
            ],
        ),
    ]);

    render(
        <TestContextProvider>
            <ContentEditor
                aria-label="Test"
                state={ContentEditorState.create({
                    doc: content,
                    references: emptyContentReferences,
                })}
                onChange={() => {}}
                fileAttachmentTarget={fileAttachmentTarget}
                commentFileAttachmentTarget={commentFileAttachmentTarget}
            />
        </TestContextProvider>,
    );

    expect(stripHtml(screen.getByRole("textbox"))).toMatchSnapshot();

    await expectClipboardRoundtripToWork();
});
