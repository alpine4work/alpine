/* eslint-disable testing-library/no-node-access, testing-library/no-container, string-quotes */

import {render} from "@testing-library/react";
import {ContentView} from "~/client/content/content_view.js";
import {disableStartMaintainingFileForTest} from "~/client/content/file_registry.js";
import {
    getSelectionClipboardData,
    handleCopyEventIfNotTextInputElement,
} from "~/client/content/handle_copy_event_if_not_text_input_element.js";
import {markMemoIfNotRendering} from "~/client/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {TestSpaceContextProvider} from "~/client/spaces/space_context_provider.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {paragraphClassName} from "~/shared/design/core/constant_class_names.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {createTestSpaceModel} from "~/shared/spaces/test_helpers/space_model_test_helpers.js";

disableStartMaintainingFileForTest();

const space = createTestSpaceModel();

const account = createTestAccountModel({
    id: generateId<AccountId>(),
    version: 0,
    name: "Sarah Smith",
    nameVersion: 0,
    space: {
        version: 0,
        addedTime: new Date(),
        state: {type: "Active"},
        role: "Member",
    },
});

// eslint-disable-next-line testing-library/render-result-naming-convention
const testPostFileAttachmentTarget = markMemoIfNotRendering<FileAttachmentTarget>({
    type: "Post",
    postId: generateId(),
});

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

test("can copy when selection contains hidden content", () => {
    const {container} = render(
        <p className="test-p">
            Lorem ipsum dolor sit amet,{" "}
            <em className="test-em">
                consect<span style={{visibility: "hidden"}}>invisible</span>etur
            </em>{" "}
            adipiscing elit.
        </p>,
    );

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            focusOffset: 14,
        }),
    ).toEqual({
        text: "psum do",
        html: "psum do",
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(container.querySelectorAll(".test-em")[0]?.firstChild),
            focusOffset: 4,
        }),
    ).toEqual({
        text: "psum dolor sit amet, cons",
        html: "psum dolor sit amet, cons",
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(
                container.querySelectorAll(".test-em")[0]?.childNodes[1]?.firstChild,
            ),
            focusOffset: 3,
        }),
    ).toEqual({
        text: "psum dolor sit amet, consect",
        html: "psum dolor sit amet, consect",
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(container.querySelectorAll(".test-em")[0]?.childNodes[2]),
            focusOffset: 3,
        }),
    ).toEqual({
        text: "psum dolor sit amet, consectetu",
        html: "psum dolor sit amet, consectetu",
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(container.querySelectorAll(".test-p")[0]?.lastChild),
            focusOffset: 5,
        }),
    ).toEqual({
        text: "psum dolor sit amet, consectetur adipi",
        html: "psum dolor sit amet, consectetur adipi",
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-em")[0]?.firstChild),
            anchorOffset: 4,
            focusNode: assertExists(container.querySelectorAll(".test-p")[0]?.lastChild),
            focusOffset: 5,
        }),
    ).toEqual({
        text: "ectetur adipi",
        html: "ectetur adipi",
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                container.querySelectorAll(".test-em")[0]?.childNodes[1]?.firstChild,
            ),
            anchorOffset: 3,
            focusNode: assertExists(container.querySelectorAll(".test-p")[0]?.lastChild),
            focusOffset: 5,
        }),
    ).toEqual({
        text: "etur adipi",
        html: "etur adipi",
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-em")[0]?.childNodes[2]),
            anchorOffset: 3,
            focusNode: assertExists(container.querySelectorAll(".test-p")[0]?.lastChild),
            focusOffset: 5,
        }),
    ).toEqual({
        text: "r adipi",
        html: "r adipi",
    });
});

test("can copy when selection is partially within content view and partially outside content view", () => {
    const {container} = render(
        <TestSpaceContextProvider initialSpace={space} currentAccount={account}>
            <p className="test-p">
                Lorem ipsum dolor sit amet, <em className="test-em">consectetur</em> adipiscing
                elit.
            </p>
            <ContentView
                content={{
                    doc: createSimplePostContent(
                        "Vivamus sed orci sed mauris fringilla pharetra nec sed ex.",
                    ),
                    references: emptyContentReferences,
                }}
                fileAttachmentTarget={testPostFileAttachmentTarget}
            />
            <div>
                <p className="test-p">Sed vestibulum turpis sed elementum consectetur.</p>
                <p className="test-p">
                    Nulla sit amet elit <em className="test-em">placerat</em>, dapibus leo vel,
                    pellentesque velit.
                </p>
            </div>
            <ContentView
                content={{
                    doc: createSimplePostContent(
                        "Pellentesque vitae erat eget ex faucibus consectetur aliquam eget ligula.",
                    ),
                    references: emptyContentReferences,
                }}
                fileAttachmentTarget={testPostFileAttachmentTarget}
            />
            <p className="test-p">
                Duis rutrum nisi a risus hendrerit, vitae rutrum enim consequat.
            </p>
        </TestSpaceContextProvider>,
    );

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(
                container.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild,
            ),
            focusOffset: 40,
        }),
    ).toEqual({
        text: "psum dolor sit amet, consectetur adipiscing elit.\n\nVivamus sed orci sed mauris fringilla ph",
        html: 'psum dolor sit amet, consectetur adipiscing elit.<p data-pm-slice="0 1 []">Vivamus sed orci sed mauris fringilla ph</p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(container.querySelectorAll(".test-em")[1]?.firstChild),
            focusOffset: 4,
        }),
    ).toEqual({
        text: "psum dolor sit amet, consectetur adipiscing elit.\n\nVivamus sed orci sed mauris fringilla pharetra nec sed ex.\n\nSed vestibulum turpis sed elementum consectetur.\n\nNulla sit amet elit plac",
        html: 'psum dolor sit amet, consectetur adipiscing elit.<p data-pm-slice="0 0 []">Vivamus sed orci sed mauris fringilla pharetra nec sed ex.</p>Sed vestibulum turpis sed elementum consectetur.<br><br>Nulla sit amet elit plac',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(
                container.querySelectorAll(`.${paragraphClassName}`)[1]?.firstChild,
            ),
            focusOffset: 20,
        }),
    ).toEqual({
        text: "psum dolor sit amet, consectetur adipiscing elit.\n\nVivamus sed orci sed mauris fringilla pharetra nec sed ex.\n\nSed vestibulum turpis sed elementum consectetur.\n\nNulla sit amet elit placerat, dapibus leo vel, pellentesque velit.\n\nPellentesque vitae e",
        html: 'psum dolor sit amet, consectetur adipiscing elit.<p data-pm-slice="0 0 []">Vivamus sed orci sed mauris fringilla pharetra nec sed ex.</p>Sed vestibulum turpis sed elementum consectetur.<br><br>Nulla sit amet elit placerat, dapibus leo vel, pellentesque velit.<p data-pm-slice="0 1 []">Pellentesque vitae e</p>',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-p")[0]?.firstChild),
            anchorOffset: 7,
            focusNode: assertExists(container.querySelectorAll(".test-p")[3]?.firstChild),
            focusOffset: 8,
        }),
    ).toEqual({
        text: "psum dolor sit amet, consectetur adipiscing elit.\n\nVivamus sed orci sed mauris fringilla pharetra nec sed ex.\n\nSed vestibulum turpis sed elementum consectetur.\n\nNulla sit amet elit placerat, dapibus leo vel, pellentesque velit.\n\nPellentesque vitae erat eget ex faucibus consectetur aliquam eget ligula.\n\nDuis rut",
        html: 'psum dolor sit amet, consectetur adipiscing elit.<p data-pm-slice="0 0 []">Vivamus sed orci sed mauris fringilla pharetra nec sed ex.</p>Sed vestibulum turpis sed elementum consectetur.<br><br>Nulla sit amet elit placerat, dapibus leo vel, pellentesque velit.<p data-pm-slice="0 0 []">Pellentesque vitae erat eget ex faucibus consectetur aliquam eget ligula.</p>Duis rut',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                container.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild,
            ),
            anchorOffset: 40,
            focusNode: assertExists(container.querySelectorAll(".test-p")[3]?.firstChild),
            focusOffset: 8,
        }),
    ).toEqual({
        text: "aretra nec sed ex.\n\nSed vestibulum turpis sed elementum consectetur.\n\nNulla sit amet elit placerat, dapibus leo vel, pellentesque velit.\n\nPellentesque vitae erat eget ex faucibus consectetur aliquam eget ligula.\n\nDuis rut",
        html: '<p data-pm-slice="1 0 []">aretra nec sed ex.</p>Sed vestibulum turpis sed elementum consectetur.<br><br>Nulla sit amet elit placerat, dapibus leo vel, pellentesque velit.<p data-pm-slice="0 0 []">Pellentesque vitae erat eget ex faucibus consectetur aliquam eget ligula.</p>Duis rut',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(container.querySelectorAll(".test-em")[1]?.firstChild),
            anchorOffset: 4,
            focusNode: assertExists(container.querySelectorAll(".test-p")[3]?.firstChild),
            focusOffset: 8,
        }),
    ).toEqual({
        text: "erat, dapibus leo vel, pellentesque velit.\n\nPellentesque vitae erat eget ex faucibus consectetur aliquam eget ligula.\n\nDuis rut",
        html: 'erat, dapibus leo vel, pellentesque velit.<p data-pm-slice="0 0 []">Pellentesque vitae erat eget ex faucibus consectetur aliquam eget ligula.</p>Duis rut',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                container.querySelectorAll(`.${paragraphClassName}`)[1]?.firstChild,
            ),
            anchorOffset: 20,
            focusNode: assertExists(container.querySelectorAll(".test-p")[3]?.firstChild),
            focusOffset: 8,
        }),
    ).toEqual({
        text: "rat eget ex faucibus consectetur aliquam eget ligula.\n\nDuis rut",
        html: '<p data-pm-slice="1 0 []">rat eget ex faucibus consectetur aliquam eget ligula.</p>Duis rut',
    });

    expect(
        testSelectionClipboardData({
            anchorNode: assertExists(
                container.querySelectorAll(`.${paragraphClassName}`)[0]?.firstChild,
            ),
            anchorOffset: 40,
            focusNode: assertExists(
                container.querySelectorAll(`.${paragraphClassName}`)[1]?.firstChild,
            ),
            focusOffset: 20,
        }),
    ).toEqual({
        text: "aretra nec sed ex.\n\nSed vestibulum turpis sed elementum consectetur.\n\nNulla sit amet elit placerat, dapibus leo vel, pellentesque velit.\n\nPellentesque vitae e",
        html: '<p data-pm-slice="1 0 []">aretra nec sed ex.</p>Sed vestibulum turpis sed elementum consectetur.<br><br>Nulla sit amet elit placerat, dapibus leo vel, pellentesque velit.<p data-pm-slice="0 1 []">Pellentesque vitae e</p>',
    });
});
