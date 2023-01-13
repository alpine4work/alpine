import classNames from "classnames";
import {Node} from "prosemirror-model";
import {useMemo} from "react";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {docClassName} = contentSchemaStyles;

/**
 * A read-only view of content. Used as a complement to `<ContentEditor>` when
 * you want to disable editing of content and only allow reading the content.
 */
export function ContentView({content, className}: {content: Node; className?: string}) {
    const html = useMemo(() => serializeProsemirrorFragmentToHtml(content.content), [content]);

    return (
        <div
            className={classNames(docClassName, className)}
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
}
