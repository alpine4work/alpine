import {useMemo, useState} from "react";
import {ContentView} from "~/client/content/content_view.js";
import {documentContentStyles} from "~/client/styles/styles.js";
import {mergeDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {DocumentModel} from "~/shared/documents/document_model.js";

// TODO(calebmer): Get side decorations for comments working here.

const {documentContentClassName} = documentContentStyles;

export function DocumentContentView({
    withMobileLayout,
    initialDocument,
}: {
    withMobileLayout: boolean;
    initialDocument: DocumentModel;
}) {
    const [document, setDocument] = useState(initialDocument);

    return (
        <ContentView
            withMobileLayout={withMobileLayout}
            content={document.content}
            onMergeContentReferences={references => {
                setDocument(document =>
                    document.clone({
                        content: {
                            ...document.content,
                            references: mergeDocumentContentReferences(
                                document.content.references,
                                references,
                            ),
                        },
                    }),
                );
            }}
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
