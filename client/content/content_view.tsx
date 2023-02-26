import classNames from "classnames";
import {Node} from "prosemirror-model";
import {useEffect, useId, useMemo, useRef, useState} from "react";
import {To} from "react-router-dom";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click";
import {PrettyAbsoluteDateTooltipContent} from "~/client/design/pretty_absolute_date";
import {Tooltip} from "~/client/design/tooltip";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty";
import {renderContentFragmentToHtml} from "~/shared/content/render_content_to_html";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {
    ElementHtmlGenerator,
    ProsemirrorHtmlSerializationDecoration,
    TextHtmlGenerator,
} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles, contentViewStyles} from "~/shared/styles/styles";

const {docClassName, linkClassName, emptyTitleClassName, emptyBodyClassName} = contentSchemaStyles;

// TODO(calebmer): Focus rings around links in `<ContentView>`.

/**
 * A read-only view of content. Used as a complement to `<ContentEditor>` when
 * you want to disable editing of content and only allow reading the content.
 */
export function ContentView({
    content,
    contentUpdatedTime,
    onNavigate,
    placeholder,
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    isInert,
    isTruncated,
}: {
    content: Node;
    onNavigate: (to: To) => void;

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
}) {
    const ref = useRef<HTMLDivElement>(null);

    const contentUpdatedNoteId = useId();
    const [contentUpdatedNoteElement, setContentUpdatedNoteElement] =
        useState<HTMLElement | null>();

    const {html, isTitleEmpty, isBodyEmpty} = useMemo(() => {
        const decorations: Array<ProsemirrorHtmlSerializationDecoration> = [];

        if (contentUpdatedTime) {
            let depthToLastTextblockChild = null;
            let lastTextblockChild = content.lastChild;
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

            const updatedNoteHtml = new ElementHtmlGenerator("span");
            updatedNoteHtml.setAttribute("id", contentUpdatedNoteId);
            updatedNoteHtml.setAttribute("class", contentViewStyles.updatedNoteClassName);
            updatedNoteHtml.appendChild(
                new TextHtmlGenerator((depthToLastParagraphChild !== null ? " " : "") + "(edited)"),
            );

            decorations.push({
                type: "Widget",
                pos: content.nodeSize - ((depthToLastParagraphChild ?? 0) + 1),
                html: updatedNoteHtml,
            });
        }

        return {
            html: renderContentFragmentToHtml(content, {placeholder, isInert, decorations}),
            isTitleEmpty: isContentTitleEmpty(content),
            isBodyEmpty: isContentBodyEmpty(content),
        };
    }, [content, contentUpdatedNoteId, contentUpdatedTime, isInert, placeholder]);

    const onNavigateEvent = useEvent(onNavigate);

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
                handleContentLinkClick(event, onNavigateEvent);
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
    }, [html, isInert, onNavigateEvent]);

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
            {contentUpdatedTime && contentUpdatedNoteElement && (
                <Tooltip
                    content={<PrettyAbsoluteDateTooltipContent date={contentUpdatedTime} />}
                    targetElement={contentUpdatedNoteElement}
                />
            )}
        </>
    );
}
