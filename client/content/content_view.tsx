import classNames from "classnames";
import {Node} from "prosemirror-model";
import {useEffect, useMemo, useRef} from "react";
import {To} from "react-router-dom";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {renderContentFragmentToHtml} from "~/shared/content/render_content_to_html";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {docClassName, linkClassName} = contentSchemaStyles;

/**
 * A read-only view of content. Used as a complement to `<ContentEditor>` when
 * you want to disable editing of content and only allow reading the content.
 */
export function ContentView({
    content,
    onNavigate,
    className,
}: {
    content: Node;
    onNavigate: (to: To) => void;
    className?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const html = useMemo(() => renderContentFragmentToHtml(content), [content]);

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
            className={classNames(docClassName, className)}
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
}
