import classNames from "classnames";
import {Memo, useEffect, useId, useMemo, useRef, useState} from "react";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click";
import {renderContentFragmentToHtml} from "~/client/content/render_content_to_html";
import {FocusRing} from "~/client/design/focus_ring";
import {PrettyAbsoluteDateTooltipContent} from "~/client/design/pretty_absolute_date";
import {Tooltip} from "~/client/design/tooltip";
import {useNavigate} from "~/client/remix/use_navigate";
import {useSpaceContext} from "~/client/spaces/space_context";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {ContentWithReferences} from "~/shared/models/content_references";
import {
    ElementHtmlGenerator,
    ProsemirrorHtmlSerializationDecoration,
    TextHtmlGenerator,
} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles, contentViewStyles, emojiFontFamily} from "~/shared/styles/styles";

const {docClassName, linkClassName, emptyTitleClassName, emptyBodyClassName, paragraphClassName} =
    contentSchemaStyles;

/**
 * A read-only view of content. Used as a complement to `<ContentEditor>` when
 * you want to disable editing of content and only allow reading the content.
 */
export function ContentView({
    content,
    contentUpdatedTime,
    placeholder,
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    isInert,
    isTruncated,
    shouldHighlightComment,
}: {
    content: ContentWithReferences;

    /**
     * This prop puts an `(updated)` message at the end of our content with a
     * tooltip with the time the content was updated at.
     */
    contentUpdatedTime?: Date | null;

    /** Placeholder text to render when there is no other content. */
    placeholder?: string;

    /** An extra CSS class to add to the content view. */
    className?: string;

    /** An optional label to expose to assistive technology. */
    "aria-label"?: string;

    /** An optional label to expose to assistive technology. */
    "aria-labelledby"?: string;

    /**
     * Should all interactive elements be made inert? So not clickable and not
     * focusable. Gets its name from the [`inert` attribute][1].
     *
     * Manually implemented instead of relying on the HTML `inert` attribute since
     * it doesn't have great browser support.
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inert
     */
    isInert?: boolean;

    /**
     * Should the content be truncated to a single line with an ellipsis when
     * text overflows?
     */
    isTruncated?: boolean;

    /**
     * Should we highlight the provided comment thread? By default the content view
     * renders no comment highlights.
     */
    shouldHighlightComment?: Memo<(commentThreadId: DocumentCommentThreadId) => boolean>;
}) {
    // Don't get the current account when running in a unit test so we don't need
    // to render a space context when testing this component.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const currentAccount = typeof jest === "undefined" ? useSpaceContext().currentAccount : null;

    const ref = useRef<HTMLDivElement>(null);

    const [focusedLinkElement, setFocusedLinkElement] = useState<HTMLElement | null>(null);

    const contentUpdatedNoteId = useId();
    const [contentUpdatedNoteElement, setContentUpdatedNoteElement] =
        useState<HTMLElement | null>();

    const {html, isTitleEmpty, isBodyEmpty} = useMemo(() => {
        const decorations: Array<ProsemirrorHtmlSerializationDecoration> = [];

        if (contentUpdatedTime) {
            let depthToLastTextblockChild = null;
            let lastTextblockChild = content.doc.lastChild;
            let depth = 1;

            while (lastTextblockChild !== null) {
                if (lastTextblockChild.isTextblock) {
                    depthToLastTextblockChild = depth;
                    break;
                }
                lastTextblockChild = lastTextblockChild.lastChild;
                depth++;
            }

            const depthToLastParagraphChild =
                lastTextblockChild?.type.name === "paragraph" ? depthToLastTextblockChild : null;

            let html: ElementHtmlGenerator;
            if (depthToLastParagraphChild !== null) {
                const updatedNoteHtml = new ElementHtmlGenerator("span");
                updatedNoteHtml.setAttribute("id", contentUpdatedNoteId);
                updatedNoteHtml.setAttribute("class", contentViewStyles.updatedNoteClassName);
                updatedNoteHtml.appendChild(new TextHtmlGenerator(" (edited)"));

                html = updatedNoteHtml;
            } else {
                const updatedNoteContainerHtml = new ElementHtmlGenerator("p");
                updatedNoteContainerHtml.setAttribute("class", paragraphClassName);

                const updatedNoteHtml = new ElementHtmlGenerator("span");
                updatedNoteContainerHtml.appendChild(updatedNoteHtml);
                updatedNoteHtml.setAttribute("id", contentUpdatedNoteId);
                updatedNoteHtml.setAttribute("class", contentViewStyles.updatedNoteClassName);
                updatedNoteHtml.appendChild(new TextHtmlGenerator("(edited)"));

                html = updatedNoteContainerHtml;
            }

            decorations.push({
                type: "Widget",
                pos: content.doc.nodeSize - ((depthToLastParagraphChild ?? 0) + 1),
                html,
            });
        }

        content.doc.descendants((node, pos) => {
            if (!node.isText) return;

            for (const {index, emoji} of iterateEmojis(node.text!)) {
                decorations.push({
                    type: "Inline",
                    from: pos + index,
                    to: pos + index + emoji.length,
                    attrs: {
                        nodeName: "span",
                        style: `font-family:${emojiFontFamily}`,
                    },
                });
            }
        });

        return {
            html: renderContentFragmentToHtml(content, {
                currentAccount,
                placeholder,
                isInert,
                decorations,
                shouldHighlightComment,
            }),
            isTitleEmpty: isContentTitleEmpty(content.doc),
            isBodyEmpty: isContentBodyEmpty(content.doc),
        };
    }, [
        content,
        contentUpdatedNoteId,
        contentUpdatedTime,
        currentAccount,
        isInert,
        placeholder,
        shouldHighlightComment,
    ]);

    const navigate = useNavigate();

    useEffect(() => {
        if (isInert) return;

        // Re-run this effect whenever the HTML changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        html;

        const element = assertExists(ref.current);

        const cleanupFunctions: Array<() => void> = [];

        for (const linkElement of element.getElementsByClassName(linkClassName)) {
            assert(linkElement instanceof HTMLAnchorElement);

            const handleClick = (event: MouseEvent) => {
                handleContentLinkClick(event, navigate);
            };

            linkElement.addEventListener("click", handleClick);
            cleanupFunctions.push(() => {
                linkElement.removeEventListener("click", handleClick);
            });
        }

        return () => {
            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        };
    }, [html, isInert, navigate]);

    useEffect(() => {
        const element = assertExists(ref.current);

        const handleFocusChange = () => {
            if (
                document.activeElement instanceof HTMLAnchorElement &&
                document.activeElement?.classList.contains(linkClassName)
            ) {
                setFocusedLinkElement(document.activeElement);
            } else {
                setFocusedLinkElement(null);
            }
        };

        // `focusin` and `focusout` bubble whereas `focus` and `blur` don't.
        element.addEventListener("focusin", handleFocusChange);
        element.addEventListener("focusout", handleFocusChange);
        return () => {
            element.removeEventListener("focusin", handleFocusChange);
            element.removeEventListener("focusout", handleFocusChange);
        };
    }, []);

    useEffect(() => {
        // Run-run whenever this prop changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        contentUpdatedTime;
        setContentUpdatedNoteElement(document.getElementById(contentUpdatedNoteId));
    }, [contentUpdatedNoteId, contentUpdatedTime]);

    return (
        <>
            <div
                ref={ref}
                className={classNames(
                    docClassName,
                    className,
                    isTitleEmpty && emptyTitleClassName,
                    isBodyEmpty && emptyBodyClassName,
                    isTruncated && contentViewStyles.truncatedClassName,
                )}
                dangerouslySetInnerHTML={{__html: html}}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
            />
            {focusedLinkElement && <FocusRing targetElement={focusedLinkElement} />}
            {contentUpdatedTime && contentUpdatedNoteElement && (
                <Tooltip
                    placement="bottom"
                    content={<PrettyAbsoluteDateTooltipContent date={contentUpdatedTime} />}
                    targetElement={contentUpdatedNoteElement}
                />
            )}
        </>
    );
}
