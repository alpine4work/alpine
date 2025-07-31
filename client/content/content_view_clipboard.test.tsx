/* eslint-disable testing-library/no-node-access, string-quotes */

import {render} from "@testing-library/react";
import {ContentView} from "~/client/content/content_view.js";
import {disableStartMaintainingFileForTest} from "~/client/content/file_registry.js";
import {
    getSelectionClipboardData,
    handleCopyEventIfNotTextInputElement,
} from "~/client/content/handle_copy_event_if_not_text_input_element.js";
import {markMemoIfNotRendering} from "~/client/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {TestSpaceContextProvider} from "~/client/spaces/space_context_provider.js";
import {contentStyles} from "~/client/styles/styles.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    codeBlockLineContentClassName,
    fileClassName,
    paragraphClassName,
} from "~/shared/content/content_styles.js";
import {
    DocumentContentWithReferences,
    emptyDocumentContentReferences,
} from "~/shared/documents/document_content_references.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

disableStartMaintainingFileForTest();

const space = new SpaceModel({
    id: generateId(),
    version: 0,
    name: "Test Space",
});

const account = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Sarah Smith",
    nameVersion: 0,
    space: {
        version: 0,
        addedTime: new Date(),
        state: {type: "Active"},
        role: "Owner",
    },
});

const file1Id = generateChronologicalId<FileId>();
const file2Id = generateChronologicalId<FileId>();

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

// eslint-disable-next-line testing-library/render-result-naming-convention
const testDocumentFileAttachmentTarget = markMemoIfNotRendering<FileAttachmentTarget>({
    type: "Document",
    documentId: generateId(),
});

const testDocumentFileAttachmentTargetString = serializeFileAttachmentTargetString(
    testDocumentFileAttachmentTarget,
);

const testDocument: DocumentContentWithReferences = {
    references: {
        ...emptyDocumentContentReferences,
        accountById: new Map([[account.id, account]]),
        fileById: new Map([
            [
                file1Id,
                {
                    signedUrlSearch: "?exp=1728432335&iss=app&aud=edg&sig=test-img1",
                    file: new FileModel({
                        id: file1Id,
                        contentType: "image/jpeg",
                        contentLength: 2274056,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 3992, height: 2992, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
            [
                file2Id,
                {
                    signedUrlSearch: "?exp=1728432338&iss=app&aud=edg&sig=test-img2",
                    file: new FileModel({
                        id: file2Id,
                        contentType: "image/jpeg",
                        contentLength: 15353789,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 6048, height: 8064, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
        ]),
    },
    doc: assertDocumentContent(
        DocumentContentProsemirrorSchema.nodeFromJSON({
            type: "doc",
            content: [
                {
                    type: "title",
                    content: [{type: "text", text: "Test Document"}],
                },
                {
                    type: "paragraph",
                    content: [
                        {type: "text", text: "This is a test paragraph with a "},
                        {
                            type: "mention",
                            attrs: {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: account.id,
                                    isShort: true,
                                }),
                            },
                        },
                        {type: "text", text: " mention. After that there’s some "},
                        {type: "text", marks: [{type: "bold"}], text: "bold"},
                        {type: "text", text: " text and then some "},
                        {type: "text", marks: [{type: "italic"}], text: "italic text with "},
                        {type: "text", marks: [{type: "bold"}, {type: "italic"}], text: "bold"},
                        {type: "text", marks: [{type: "italic"}], text: " text in it"},
                        {type: "text", text: ". This paragraph is used to test selection logic."},
                    ],
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "Next is a code block to test:"}],
                },
                {
                    type: "codeBlock",
                    attrs: {language: "typescript"},
                    content: [
                        {type: "codeBlockLine", content: [{type: "text", text: "let a = 1;"}]},
                        {type: "codeBlockLine", content: [{type: "text", text: "let b = 2;"}]},
                        {
                            type: "codeBlockLine",
                            content: [{type: "text", text: "console.log(a + b);"}],
                        },
                    ],
                },
                {
                    type: "paragraph",
                    content: [
                        {type: "text", text: "…and we also want to test selecting between files:"},
                    ],
                },
                {
                    type: "fileRow",
                    content: [
                        {type: "file", attrs: {fileId: file1Id}},
                        {type: "file", attrs: {fileId: file2Id}},
                    ],
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "Some text afterwards for anchoring."}],
                },
            ],
        }),
    ),
};

document.documentElement.addEventListener("copy", handleCopyEventIfNotTextInputElement);

function massageResult(
    result: {text: string; html: Element} | null,
): {text: string; html: string} | null {
    if (!result) return null;
    return {text: result.text, html: result.html.innerHTML};
}

function testSelectionClipboardData(selection: {
    anchorNode: Node;
    anchorOffset: number;
    focusNode: Node;
    focusOffset: number;
}) {
    const result1 = massageResult(
        getSelectionClipboardData({
            anchorNode: selection.anchorNode,
            anchorOffset: selection.anchorOffset,
            focusNode: selection.focusNode,
            focusOffset: selection.focusOffset,
        }),
    );

    const result2 = massageResult(
        getSelectionClipboardData({
            anchorNode: selection.focusNode,
            anchorOffset: selection.focusOffset,
            focusNode: selection.anchorNode,
            focusOffset: selection.anchorOffset,
        }),
    );

    expect(result1).toEqual(result2);

    return result1;
}

beforeAll(async () => {
    await contentCodeBlockLanguageById.typescript.getParser()?.promise;
});

test("can copy when selection is entirely in content view", () => {
    const {container} = render(
        <TestSpaceContextProvider initialSpace={space} currentAccount={account}>
            <ContentView
                content={testDocument}
                fileAttachmentTarget={testDocumentFileAttachmentTarget}
            />
        </TestSpaceContextProvider>,
    );

    const element = assertExists(container.firstElementChild);
    assert(element.classList.contains(contentStyles.docClassName));

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild,
            ),
            anchorOffset: 5,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild,
            ),
            focusOffset: 36,
        }),
    ).toEqual({
        text: "s paragraph is used to test sel",
        html: '<p data-pm-slice="1 1 []">s paragraph is used to test sel</p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.lastChild,
            ),
            anchorOffset: 3,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild,
            ),
            focusOffset: 40,
        }),
    ).toEqual({
        text: "xt in it. This paragraph is used to test selecti",
        html: '<p data-pm-slice="1 1 []"><em>xt in it</em>. This paragraph is used to test selecti</p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.previousSibling?.lastChild?.lastChild,
            ),
            anchorOffset: 2,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild,
            ),
            focusOffset: 11,
        }),
    ).toEqual({
        text: "ld text in it. This para",
        html: '<p data-pm-slice="1 1 []"><strong><em>ld</em></strong><em> text in it</em>. This para</p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.previousSibling?.previousSibling?.lastChild,
            ),
            anchorOffset: 3,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild,
            ),
            focusOffset: 12,
        }),
    ).toEqual({
        text: "lic text with bold text in it. This parag",
        html: '<p data-pm-slice="1 1 []"><em>lic text with </em><strong><em>bold</em></strong><em> text in it</em>. This parag</p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.previousSibling?.previousSibling?.previousSibling,
            ),
            anchorOffset: 16,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild,
            ),
            focusOffset: 21,
        }),
    ).toEqual({
        text: "ome italic text with bold text in it. This paragraph is u",
        html: '<p data-pm-slice="1 1 []">ome <em>italic text with </em><strong><em>bold</em></strong><em> text in it</em>. This paragraph is u</p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.previousSibling?.previousSibling?.previousSibling,
            ),
            anchorOffset: 13,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.lastChild,
            ),
            focusOffset: 3,
        }),
    ).toEqual({
        text: "n some italic text with bold te",
        html: '<p data-pm-slice="1 1 []">n some <em>italic text with </em><strong><em>bold</em></strong><em> te</em></p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.previousSibling?.previousSibling?.previousSibling,
            ),
            anchorOffset: 12,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.previousSibling?.lastChild?.lastChild,
            ),
            focusOffset: 2,
        }),
    ).toEqual({
        text: "en some italic text with bo",
        html: '<p data-pm-slice="1 1 []">en some <em>italic text with </em><strong><em>bo</em></strong></p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.previousSibling?.previousSibling?.lastChild,
            ),
            anchorOffset: 2,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.lastChild,
            ),
            focusOffset: 8,
        }),
    ).toEqual({
        text: "alic text with bold text in",
        html: '<p data-pm-slice="1 1 []"><em>alic text with </em><strong><em>bold</em></strong><em> text in</em></p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild,
            ),
            anchorOffset: 6,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild,
            ),
            focusOffset: 20,
        }),
    ).toEqual({
        text: "s a test parag",
        html: '<p data-pm-slice="1 1 []">s a test parag</p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild,
            ),
            anchorOffset: 11,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild?.nextSibling
                    ?.nextSibling,
            ),
            focusOffset: 5,
        }),
    ).toEqual({
        text: "est paragraph with a Sarah ment",
        html: `<p data-pm-slice="1 1 []">est paragraph with a <span data-cy-mention="${account.id}" data-cy-mention-short="">Sarah</span> ment</p>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild,
            ),
            anchorOffset: 17,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild?.nextSibling
                    ?.firstChild?.firstChild?.nextSibling?.firstChild,
            ),
            focusOffset: 3,
        }),
    ).toEqual({
        text: "ragraph with a Sarah",
        html: `<p data-pm-slice="1 1 []">ragraph with a <span data-cy-mention="${account.id}" data-cy-mention-short="">Sarah</span></p>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild?.nextSibling
                    ?.firstChild?.firstChild?.nextSibling?.firstChild,
            ),
            anchorOffset: 2,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild?.nextSibling
                    ?.nextSibling,
            ),
            focusOffset: 25,
        }),
    ).toEqual({
        text: "Sarah mention. After that ther",
        html: `<p data-pm-slice="1 1 []"><span data-cy-mention="${account.id}" data-cy-mention-short="">Sarah</span> mention. After that ther</p>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(element.firstChild?.firstChild),
            anchorOffset: 2,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[0]?.lastChild?.previousSibling
                    ?.previousSibling?.previousSibling?.previousSibling,
            ),
            focusOffset: 18,
        }),
    ).toEqual({
        text: "st Document\n\nThis is a test paragraph with a Sarah mention. After that there’s some bold text and then som",
        html: `<h1 data-pm-slice="1 1 []">st Document</h1><p>This is a test paragraph with a <span data-cy-mention="${account.id}" data-cy-mention-short="">Sarah</span> mention. After that there’s some <strong>bold</strong> text and then som</p>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${codeBlockLineContentClassName}`)[2]?.childNodes[4]
                    ?.firstChild,
            ),
            anchorOffset: 0,
            focusNode: assertExists(
                element.querySelectorAll(`.${codeBlockLineContentClassName}`)[2]?.childNodes[8]
                    ?.firstChild,
            ),
            focusOffset: 1,
        }),
    ).toEqual({
        text: "a + b",
        html: `<code data-pm-slice="1 1 [&quot;codeBlock&quot;,{&quot;language&quot;:&quot;typescript&quot;}]">a + b</code>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[1]?.firstChild,
            ),
            anchorOffset: 12,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[2]?.firstChild,
            ),
            focusOffset: 15,
        }),
    ).toEqual({
        text: "de block to test:\n\nlet a = 1;\nlet b = 2;\nconsole.log(a + b);\n\n…and we also wa",
        html: `<p data-pm-slice="1 1 []">de block to test:</p><pre><code data-cy-language="typescript">let a = 1;\nlet b = 2;\nconsole.log(a + b);</code></pre><p>…and we also wa</p>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[1]?.firstChild,
            ),
            anchorOffset: 12,
            focusNode: assertExists(
                element.querySelectorAll(`.${codeBlockLineContentClassName}`)[1]?.childNodes[2]
                    ?.firstChild,
            ),
            focusOffset: 1,
        }),
    ).toEqual({
        text: "de block to test:\n\nlet a = 1;\nlet b",
        html: `<p data-pm-slice="1 2 []">de block to test:</p><pre><code data-cy-language="typescript">let a = 1;\nlet b</code></pre>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${codeBlockLineContentClassName}`)[1]?.childNodes[2]
                    ?.firstChild,
            ),
            anchorOffset: 1,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[2]?.firstChild,
            ),
            focusOffset: 15,
        }),
    ).toEqual({
        text: " = 2;\nconsole.log(a + b);\n\n…and we also wa",
        html: `<pre data-pm-slice="2 1 []"><code data-cy-language="typescript"> = 2;\nconsole.log(a + b);</code></pre><p>…and we also wa</p>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[2]?.firstChild,
            ),
            anchorOffset: 6,
            focusNode: assertExists(element.querySelectorAll(`.${fileClassName}`)[0]),
            focusOffset: 1,
        }),
    ).toEqual({
        text: "e also want to test selecting between files:",
        html: `<p data-pm-slice="1 1 []">e also want to test selecting between files:</p><div style="display: flex; gap: 8px; margin-top: 8px; margin-bottom: 8px;"><img src="http://localhost/files/${space.id}/${file1Id}?exp=1728432335&amp;iss=app&amp;aud=edg&amp;sig=test-img1" data-cy-attached="${testDocumentFileAttachmentTargetString}" style="display: block;" width="600" height="450"></div>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(element.querySelectorAll(`.${fileClassName}`)[1]),
            anchorOffset: 0,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[3]?.firstChild,
            ),
            focusOffset: 29,
        }),
    ).toEqual({
        text: "Some text afterwards for anch",
        html: `<div style="display: flex; gap: 8px; margin-top: 8px; margin-bottom: 8px;" data-pm-slice="1 1 []"><img src="http://localhost/files/${space.id}/${file2Id}?exp=1728432338&amp;iss=app&amp;aud=edg&amp;sig=test-img2" data-cy-attached="${testDocumentFileAttachmentTargetString}" style="display: block;" width="384" height="512"></div><p>Some text afterwards for anch</p>`,
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[2]?.firstChild,
            ),
            anchorOffset: 15,
            focusNode: assertExists(
                element.querySelectorAll(`.${paragraphClassName}`)[3]?.firstChild,
            ),
            focusOffset: 12,
        }),
    ).toEqual({
        text: "nt to test selecting between files:\n\nSome text af",
        html: `<p data-pm-slice="1 1 []">nt to test selecting between files:</p><div style="display: flex; gap: 8px; margin-top: 8px; margin-bottom: 8px;"><img src="http://localhost/files/${space.id}/${file1Id}?exp=1728432335&amp;iss=app&amp;aud=edg&amp;sig=test-img1" data-cy-attached="${testDocumentFileAttachmentTargetString}" style="display: block;" width="379" height="284"><img src="http://localhost/files/${space.id}/${file2Id}?exp=1728432338&amp;iss=app&amp;aud=edg&amp;sig=test-img2" data-cy-attached="${testDocumentFileAttachmentTargetString}" style="display: block;" width="213" height="284"></div><p>Some text af</p>`,
    });
});
