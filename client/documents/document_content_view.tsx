import {ContentView} from "~/client/content/content_view.js";
import {Spacing} from "~/shared/design/spacing.js";
import {DocumentModel} from "~/shared/documents/document_model.js";
import {sprinkles} from "~/shared/styles/styles.js";

// TODO(calebmer): Get side decorations for comments working here.

export const documentPaddingX: Spacing = "3";

export const documentContentClassName = sprinkles({
    paddingBottom: "24",
    paddingX: documentPaddingX,
    backgroundColor: "grey-0",
});

export function DocumentContentView({document}: {document: DocumentModel}) {
    return (
        <ContentView
            content={document.content}
            className={documentContentClassName}
            // en dash (https://graphemica.com/2013)
            // Represents no content
            placeholder={"\u2013"}
        />
    );
}
