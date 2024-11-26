import {useMemo} from "react";
import {ContentView} from "~/client/content/content_view.js";
import {documentContentStyles} from "~/client/styles/styles.js";
import {DocumentModel} from "~/shared/documents/document_model.js";

// TODO(calebmer): Get side decorations for comments working here.

const {documentContentClassName} = documentContentStyles;

export function DocumentContentView({document}: {document: DocumentModel}) {
    return (
        <ContentView
            content={document.content}
            className={documentContentClassName}
            // en dash (https://graphemica.com/2013)
            // Represents no content
            placeholder={"\u2013"}
            fileAttachmentTarget={useMemo(
                () => ({type: "Document", documentId: document.id}),
                [document],
            )}
        />
    );
}
