import {ContentView} from "~/client/content/content_view";
import {DocumentModel} from "~/shared/models/document_model";
import {sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Get side decorations for comments working here.

export const documentContentClassName = sprinkles({
    paddingBottom: "24",
    paddingX: "3",
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
