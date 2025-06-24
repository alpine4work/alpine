import {DOMSerializer} from "prosemirror-model";
import {
    NodeViewConstructor,
    __serializeForClipboard as serializeForClipboard,
} from "prosemirror-view";
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/state/add_unfocusable_button_behavior_to_element.js";
import {Reporter} from "~/client/design/reporter.js";
import {clipboardTextIconSvg} from "~/client/icons/clipboard_text_icon_svg.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {assert} from "~/shared/helpers/control/assert.js";

// This is the function that creates the node view for the code block in the
// content editor. Here we can control the DOM structure of the code block.
//
// For example, here we have added a toolbar with a language picker and copy
// button.
//
// It is like a hook that allows us to render the code block in the content
// editor in a way that we want.
//
// This functional will be called every time the code block is rendered in the
// content editor.
//
// IMPORTANT: Any change you make to this function also likely must be made to
// the `codeBlock` node renderer in `renderContentInHtml()`.
export function createContentEditorCodeBlockNodeViewConstructor({
    getReporter,
    getAccessLevel,
    onCodeBlockLanguagePickerOpen,
    onCodeBlockCopyButtonHoverStart,
    onCodeBlockCopyButtonHoverEnd,
    onCodeBlockCopyButtonPress,
}: {
    getReporter: () => Reporter;
    getAccessLevel: () => AccessLevel;
    onCodeBlockLanguagePickerOpen: (options: {
        targetElement: HTMLElement;
        languageId: ContentCodeBlockLanguageId;
        getPos: () => number;
    }) => void;
    onCodeBlockCopyButtonHoverStart: (targetElement: HTMLElement) => void;
    onCodeBlockCopyButtonHoverEnd: (targetElement: HTMLElement) => void;
    onCodeBlockCopyButtonPress: (targetElement: HTMLElement) => void;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
        const language = contentCodeBlockLanguageById[languageId];

        // This DOM structure is defined in content_schema.ts. See codeBlock's
        // toDOM function.
        const {dom: element, contentDOM: contentElement} = DOMSerializer.renderSpec(
            document,
            node.type.spec.toDOM!(node),
        );

        assert(element instanceof HTMLElement && element.tagName === "PRE");
        assert(contentElement instanceof HTMLElement && contentElement.tagName === "CODE");
        assert(element.childElementCount === 1);
        assert(element.firstElementChild === contentElement);

        const destroyCallbacks: Array<() => void> = [];

        // here we're creating the toolbar that contains the language picker and copy button
        // it's inserted right before the `contentDOM` element or `CODE` element
        const toolbarElement = document.createElement("div");
        element.insertBefore(toolbarElement, contentElement);
        toolbarElement.contentEditable = "false";
        toolbarElement.className = contentStyles.codeBlockToolbarClassName;

        const toolbarFlexElement = document.createElement("div");
        toolbarElement.appendChild(toolbarFlexElement);
        toolbarFlexElement.className = contentStyles.codeBlockToolbarFlexClassName;

        const toolbarOverflowGradientElement = document.createElement("div");
        toolbarFlexElement.appendChild(toolbarOverflowGradientElement);
        toolbarOverflowGradientElement.className =
            contentStyles.codeBlockToolbarOverflowGradientClassName;

        {
            // language picker combobox button:
            const languagePickerElement = document.createElement("div");
            toolbarFlexElement.appendChild(languagePickerElement);
            languagePickerElement.className = contentStyles.codeBlockLanguagePickerClassName;

            const languagePickerTextElement = document.createElement("div");
            languagePickerElement.appendChild(languagePickerTextElement);
            languagePickerTextElement.className =
                contentStyles.codeBlockLanguagePickerTextClassName;

            languagePickerTextElement.appendChild(document.createTextNode(language.name));

            // We don't need to cleanup event listeners on DOM nodes created for this
            // node view.
            addUnfocusableButtonBehaviorToElement(languagePickerElement, {
                isDisabled: () => !hasAccessLevel(getAccessLevel(), "Edit"),
                defaultClassName: sprinkles({
                    color: "grey-60",
                }),
                hoverClassName: sprinkles({
                    color: "grey-60",
                    backgroundColor: "grey-5",
                }),
                pressClassName: sprinkles({
                    color: "grey-100",
                    backgroundColor: "grey-10",
                }),
                onPress: () => {
                    onCodeBlockLanguagePickerOpen({
                        targetElement: languagePickerElement,
                        languageId,
                        getPos: () => getPos()!,
                    });
                },
            });
        }

        {
            // copy button:
            // we just add it to the toolbar and then we'll add unfocusable button
            // behavior to it.
            const copyButtonElement = document.createElement("div");
            toolbarFlexElement.appendChild(copyButtonElement);
            copyButtonElement.className = contentStyles.codeBlockCopyButtonClassName;
            copyButtonElement.innerHTML = clipboardTextIconSvg({
                className: contentStyles.codeBlockCopyButtonIconClassName,
            });

            let isCodeBlockCopyButtonHovered = false;

            // We don't need to cleanup event listeners on DOM nodes created for this
            // node view.
            addUnfocusableButtonBehaviorToElement(copyButtonElement, {
                defaultClassName: sprinkles({
                    color: "grey-60",
                }),
                hoverClassName: sprinkles({
                    color: "grey-60",
                    backgroundColor: "grey-5",
                }),
                pressClassName: sprinkles({
                    color: "grey-100",
                    backgroundColor: "grey-10",
                }),
                onHoverStart: () => {
                    const wasCodeBlockCopyButtonHovered = isCodeBlockCopyButtonHovered;
                    isCodeBlockCopyButtonHovered = true;

                    if (!wasCodeBlockCopyButtonHovered)
                        onCodeBlockCopyButtonHoverStart(copyButtonElement);
                },
                onHoverEnd: () => {
                    const wasCodeBlockCopyButtonHovered = isCodeBlockCopyButtonHovered;
                    isCodeBlockCopyButtonHovered = false;
                    if (wasCodeBlockCopyButtonHovered)
                        onCodeBlockCopyButtonHoverEnd(copyButtonElement);
                },
                onPress: () => {
                    const pos = getPos()!;

                    const {dom, text} = serializeForClipboard(
                        view,
                        view.state.doc.slice(pos, pos + node.nodeSize),
                    );

                    navigator.clipboard
                        .write([
                            new ClipboardItem({
                                "text/html": new Blob([dom.innerHTML], {type: "text/html"}),
                                "text/plain": new Blob([text], {type: "text/plain"}),
                            }),
                        ])
                        .catch(error => {
                            getReporter().displayError("Couldn’t copy code", error);
                        });

                    onCodeBlockCopyButtonPress(copyButtonElement);
                },
            });

            destroyCallbacks.push(() => {
                if (isCodeBlockCopyButtonHovered) {
                    isCodeBlockCopyButtonHovered = false;
                    onCodeBlockCopyButtonHoverEnd(copyButtonElement);
                }
            });
        }

        return {
            dom: element,
            contentDOM: contentElement,
            destroy: () => {
                for (const destroyCallback of destroyCallbacks) {
                    destroyCallback();
                }
            },
            ignoreMutation: mutation => {
                // Ignore any attribute mutation for elements in the toolbar. It's expected
                // that we'll modify `class` when hovered/pressed and it's expected that
                // `<Tooltip>` on `copyButtonElement` will change `aria-owns` and other
                // properties.
                return mutation.type === "attributes" && toolbarElement.contains(mutation.target);
            },
        };
    };
}
