import classNames from "classnames";
import {Node} from "prosemirror-model";
import {useEffect, useMemo, useRef} from "react";
import {To} from "react-router-dom";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty";
import {renderContentFragmentToHtml} from "~/shared/content/render_content_to_html";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {docClassName, linkClassName, emptyTitleClassName, emptyBodyClassName} = contentSchemaStyles;

/**
 * A read-only view of content. Used as a complement to `<ContentEditor>` when
 * you want to disable editing of content and only allow reading the content.
 */
export function ContentView({
    content,
    onNavigate,
    placeholder,
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
}: {
    content: Node;
    onNavigate: (to: To) => void;
    /** Placeholder text to render when there is no other content. */
    placeholder?: string;
    /** An extra CSS class to add to the content view. */
    className?: string;
    /** An optional label to expose to assistive technology. */
    "aria-label"?: string;
    /** An optional label to expose to assistive technology. */
    "aria-labelledby"?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const {html, isTitleEmpty, isBodyEmpty} = useMemo(
        () => ({
            html: renderContentFragmentToHtml(content, {placeholder}),
            isTitleEmpty: isContentTitleEmpty(content),
            isBodyEmpty: isContentBodyEmpty(content),
        }),
        [content, placeholder],
    );

    const onNavigateEvent = useEvent(onNavigate);

    useEffect(() => {
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
    }, [onNavigateEvent]);

    return (
        <div
            ref={ref}
            className={classNames(
                docClassName,
                className,
                isTitleEmpty && emptyTitleClassName,
                isBodyEmpty && emptyBodyClassName,
            )}
            dangerouslySetInnerHTML={{__html: html}}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
        />
    );
}
