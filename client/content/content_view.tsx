import classNames from "classnames";
import {Memo, useEffect, useId, useMemo, useRef, useState} from "react";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click.js";
import {renderContentFragmentToHtmlStore} from "~/client/content/render_content_to_html.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {PrettyAbsoluteDateTooltipContent} from "~/client/design/pretty_absolute_date.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useCanPrimaryInputHover} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {isMessageContentSchema} from "~/shared/content/is_message_content_schema.js";
import {isTextEndedWithPunctuation} from "~/shared/content/print_content_single_line_text_snippet.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {ProsemirrorHtmlSerializationDecoration} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {contentSchemaStyles, contentViewStyles} from "~/shared/styles/styles.js";

const {
    docClassName,
    messageDocClassName,
    linkClassName,
    linkPressedClassName,
    emptyTitleClassName,
    emptyBodyClassName,
    paragraphClassName,
    emojiClassName,
} = contentSchemaStyles;

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
    withUserSelectNone,
    onSeeMoreContent,
    onSeeLessContent,
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

    /**
     * Set the CSS `user-select: none` to disable text selection of this element.
     */
    withUserSelectNone?: boolean;

    /**
     * Adds a "See more" button which when clicked should reveal the whole content.
     * Useful when you want to show snippet of truncated content that expands to
     * more.
     */
    onSeeMoreContent?: () => void;

    /**
     * Adds a "See less" button which when clicked should collapse content to a
     * truncated version which a "See more" button should be able to expand (see
     * `onSeeMoreContent`).
     */
    onSeeLessContent?: () => void;
}) {
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const accountStore = useAccountClientStore();

    // Don't get the current account when running in a unit test so we don't need
    // to render a space context when testing this component.
    const currentAccount =
        // eslint-disable-next-line react-hooks/rules-of-hooks
        !import.meta.jest ? useSpaceContext().currentAccount : null;

    const ref = useRef<HTMLDivElement>(null);

    const [focusedLinkElement, setFocusedLinkElement] = useState<HTMLElement | null>(null);

    const contentUpdatedNoteId = useId();
    const [contentUpdatedNoteElement, setContentUpdatedNoteElement] = useState<HTMLElement | null>(
        null,
    );

    const shouldShowSeeMoreContentButton = !!onSeeMoreContent;
    const shouldShowSeeLessContentButton = !!onSeeLessContent;

    const events = useEvents({
        onSeeMoreContent: onSeeMoreContent ?? noop,
        onSeeLessContent: onSeeLessContent ?? noop,
    });

    const {html, isTitleEmpty, isBodyEmpty} = useStore(
        useMemo(() => {
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
                    lastTextblockChild?.type.name === "paragraph"
                        ? depthToLastTextblockChild
                        : null;

                let html: HtmlElementGenerator;
                if (depthToLastParagraphChild !== null) {
                    const updatedNoteHtml = new HtmlElementGenerator("span");
                    updatedNoteHtml.setAttribute("id", contentUpdatedNoteId);
                    updatedNoteHtml.setAttribute("class", contentViewStyles.updatedNoteClassName);
                    updatedNoteHtml.appendChild(new HtmlTextGenerator(" (edited)"));

                    html = updatedNoteHtml;
                } else {
                    const updatedNoteContainerHtml = new HtmlElementGenerator("p");
                    updatedNoteContainerHtml.setAttribute("class", paragraphClassName);

                    const updatedNoteHtml = new HtmlElementGenerator("span");
                    updatedNoteContainerHtml.appendChild(updatedNoteHtml);
                    updatedNoteHtml.setAttribute("id", contentUpdatedNoteId);
                    updatedNoteHtml.setAttribute("class", contentViewStyles.updatedNoteClassName);
                    updatedNoteHtml.appendChild(new HtmlTextGenerator("(edited)"));

                    html = updatedNoteContainerHtml;
                }

                decorations.push({
                    type: "Widget",
                    pos: content.doc.nodeSize - ((depthToLastParagraphChild ?? 0) + 1),
                    html,
                });
            }

            if (shouldShowSeeMoreContentButton || shouldShowSeeLessContentButton) {
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
                    lastTextblockChild?.type.name === "paragraph"
                        ? depthToLastTextblockChild
                        : null;

                const buttonText = shouldShowSeeLessContentButton ? "See less" : "See more";

                let html: HtmlElementGenerator;
                if (depthToLastParagraphChild !== null) {
                    const shouldAddEllipsis =
                        !shouldShowSeeLessContentButton &&
                        lastTextblockChild &&
                        lastTextblockChild.childCount > 0 &&
                        !isTextEndedWithPunctuation(lastTextblockChild.lastChild!.text!);

                    const seeButtonContainerHtml = new HtmlElementGenerator("span");

                    seeButtonContainerHtml.appendChild(
                        new HtmlTextGenerator(shouldAddEllipsis ? "… " : " "),
                    );

                    const seeButtonHtml = new HtmlElementGenerator("span");
                    seeButtonContainerHtml.appendChild(seeButtonHtml);
                    seeButtonHtml.setAttribute("id", contentUpdatedNoteId);
                    seeButtonHtml.setAttribute("class", contentViewStyles.seeButtonClassName);
                    seeButtonHtml.appendChild(new HtmlTextGenerator(buttonText));

                    html = seeButtonContainerHtml;
                } else {
                    const seeButtonContainerHtml = new HtmlElementGenerator("p");
                    seeButtonContainerHtml.setAttribute("class", paragraphClassName);

                    const seeButtonHtml = new HtmlElementGenerator("span");
                    seeButtonContainerHtml.appendChild(seeButtonHtml);
                    seeButtonHtml.setAttribute("id", contentUpdatedNoteId);
                    seeButtonHtml.setAttribute("class", contentViewStyles.seeButtonClassName);
                    seeButtonHtml.appendChild(new HtmlTextGenerator(buttonText));

                    html = seeButtonContainerHtml;
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
                            class: emojiClassName,
                        },
                    });
                }
            });

            return renderContentFragmentToHtmlStore(content, {
                accountStore,
                currentAccount,
                placeholder,
                isInert,
                decorations,
                shouldHighlightComment,
            }).map(html => ({
                html,
                isTitleEmpty: isContentTitleEmpty(content.doc),
                isBodyEmpty: isContentBodyEmpty(content.doc),
            }));
        }, [
            accountStore,
            content,
            contentUpdatedNoteId,
            contentUpdatedTime,
            currentAccount,
            isInert,
            placeholder,
            shouldHighlightComment,
            shouldShowSeeLessContentButton,
            shouldShowSeeMoreContentButton,
        ]),
    );

    const navigate = useNavigate();

    useEffect(() => {
        if (isInert) return;

        // Re-run this effect whenever the HTML changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        html;

        const element = assertExists(ref.current);

        const cleanupFunctions: Array<() => void> = [];

        for (const linkElement of element.getElementsByClassName(linkClassName)) {
            if (!(linkElement instanceof HTMLAnchorElement)) continue;

            let isPointerDownAndOver = false;

            const maybeUpdateStyle = () => {
                if (isPointerDownAndOver) {
                    linkElement.classList.add(linkPressedClassName);
                } else {
                    linkElement.classList.remove(linkPressedClassName);
                }
            };

            const handleClick = (event: MouseEvent) => {
                const isOpenLinkInSeparateTabEvent = isOpenLinkInSeparateTabPointerEvent(
                    event,
                    getClientInfoWithoutListening(),
                );

                // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                // modifier. Unless the click was meant to open the link in a separate tab. We
                // need to implement that manually here given the text is editable.
                if (
                    (event.button !== 0 || isModifiedPointerEvent(event)) &&
                    !isOpenLinkInSeparateTabEvent
                ) {
                    return;
                }

                // Must call prevent default here in addition to `pointerdown` to stop mobile
                // WebKit from following a link after click.
                event.preventDefault();
            };

            const handlePointerDown = (event: MouseEvent) => {
                isPointerDownAndOver =
                    event.button === 0 &&
                    (!isModifiedPointerEvent(event) ||
                        isOpenLinkInSeparateTabPointerEvent(
                            event,
                            getClientInfoWithoutListening(),
                        ));

                maybeUpdateStyle();

                // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                // modifier. Unless the click was meant to open the link in a separate tab. We
                // need to implement that manually here given the text is editable.
                if (
                    (event.button !== 0 || isModifiedPointerEvent(event)) &&
                    !isOpenLinkInSeparateTabPointerEvent(event, getClientInfoWithoutListening())
                ) {
                    return;
                }

                // This will be a navigation click if the pointer stays over our element. Don't
                // select the editable text.
                event.preventDefault();
            };

            const handlePointerUp = (event: MouseEvent) => {
                const wasPointerDownAndOver = isPointerDownAndOver;
                isPointerDownAndOver = false;
                maybeUpdateStyle();

                // Only process pointer up events that started on our element.
                if (!wasPointerDownAndOver) {
                    return;
                }

                handleContentLinkClick(event, navigate);
            };

            const handlePointerLeave = (event: MouseEvent) => {
                isPointerDownAndOver = false;
                maybeUpdateStyle();
            };

            const handleDragStart = (event: DragEvent) => {
                isPointerDownAndOver = false;
                maybeUpdateStyle();
            };

            linkElement.addEventListener("click", handleClick);
            linkElement.addEventListener("pointerdown", handlePointerDown);
            linkElement.addEventListener("pointerup", handlePointerUp);
            linkElement.addEventListener("pointerleave", handlePointerLeave);
            linkElement.addEventListener("dragstart", handleDragStart);
            cleanupFunctions.push(() => {
                linkElement.removeEventListener("click", handleClick);
                linkElement.removeEventListener("pointerdown", handlePointerDown);
                linkElement.removeEventListener("pointerup", handlePointerUp);
                linkElement.removeEventListener("pointerleave", handlePointerLeave);
                linkElement.removeEventListener("dragstart", handleDragStart);
            });
        }

        for (const seeButtonElement of element.getElementsByClassName(
            contentViewStyles.seeButtonClassName,
        )) {
            if (!(seeButtonElement instanceof HTMLElement)) continue;

            let isPointerDownAndOver = false;

            const maybeUpdateStyle = () => {
                if (isPointerDownAndOver) {
                    seeButtonElement.classList.add(contentViewStyles.seeButtonPressedClassName);
                } else {
                    seeButtonElement.classList.remove(contentViewStyles.seeButtonPressedClassName);
                }
            };

            const handleClick = (event: MouseEvent) => {
                // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                // modifier. Unless the click was meant to open the link in a separate tab. We
                // need to implement that manually here given the text is editable.
                if (event.button !== 0 || isModifiedPointerEvent(event)) {
                    return;
                }

                // Must call prevent default here in addition to `pointerdown` to stop mobile
                // WebKit from following a link after click.
                event.preventDefault();
            };

            const handlePointerDown = (event: MouseEvent) => {
                isPointerDownAndOver = event.button === 0 && !isModifiedPointerEvent(event);

                maybeUpdateStyle();

                // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                // modifier. Unless the click was meant to open the link in a separate tab. We
                // need to implement that manually here given the text is editable.
                if (event.button !== 0 || isModifiedPointerEvent(event)) {
                    return;
                }

                // This will be a navigation click if the pointer stays over our element. Don't
                // select the editable text.
                event.preventDefault();
            };

            const handlePointerUp = (event: MouseEvent) => {
                const wasPointerDownAndOver = isPointerDownAndOver;
                isPointerDownAndOver = false;
                maybeUpdateStyle();

                // Only process pointer up events that started on our element.
                if (!wasPointerDownAndOver) {
                    return;
                }

                if (shouldShowSeeLessContentButton) {
                    events.onSeeLessContent();
                } else if (shouldShowSeeMoreContentButton) {
                    events.onSeeMoreContent();
                }
            };

            const handlePointerLeave = (event: MouseEvent) => {
                isPointerDownAndOver = false;
                maybeUpdateStyle();
            };

            const handleDragStart = (event: DragEvent) => {
                isPointerDownAndOver = false;
                maybeUpdateStyle();
            };

            seeButtonElement.addEventListener("click", handleClick);
            seeButtonElement.addEventListener("pointerdown", handlePointerDown);
            seeButtonElement.addEventListener("pointerup", handlePointerUp);
            seeButtonElement.addEventListener("pointerleave", handlePointerLeave);
            seeButtonElement.addEventListener("dragstart", handleDragStart);
            cleanupFunctions.push(() => {
                seeButtonElement.removeEventListener("click", handleClick);
                seeButtonElement.removeEventListener("pointerdown", handlePointerDown);
                seeButtonElement.removeEventListener("pointerup", handlePointerUp);
                seeButtonElement.removeEventListener("pointerleave", handlePointerLeave);
                seeButtonElement.removeEventListener("dragstart", handleDragStart);
            });
        }

        return () => {
            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        };
    }, [
        events,
        html,
        isInert,
        navigate,
        shouldShowSeeLessContentButton,
        shouldShowSeeMoreContentButton,
    ]);

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
        setContentUpdatedNoteElement(
            contentUpdatedTime ? document.getElementById(contentUpdatedNoteId) : null,
        );
    }, [contentUpdatedNoteId, contentUpdatedTime]);

    return (
        <>
            <div
                ref={ref}
                className={classNames(
                    docClassName,
                    isMessageContentSchema(content.doc.type.schema)
                        ? messageDocClassName
                        : undefined,
                    className,
                    isTitleEmpty && emptyTitleClassName,
                    isBodyEmpty && emptyBodyClassName,
                    isTruncated && contentViewStyles.truncatedClassName,
                )}
                style={
                    withUserSelectNone ? {userSelect: "none", WebkitUserSelect: "none"} : undefined
                }
                dangerouslySetInnerHTML={{__html: html}}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
            />
            {focusedLinkElement && <FocusRing targetElement={focusedLinkElement} />}
            {canPrimaryInputHover && contentUpdatedTime && contentUpdatedNoteElement && (
                <Tooltip
                    placement="bottom"
                    content={<PrettyAbsoluteDateTooltipContent date={contentUpdatedTime} />}
                    targetElement={contentUpdatedNoteElement}
                />
            )}
        </>
    );
}
