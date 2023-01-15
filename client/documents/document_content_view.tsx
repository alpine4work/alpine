import {useNavigate} from "react-router-dom";
import {ContentView} from "~/client/content/content_view";
import {DocumentModel} from "~/shared/documents/document_model";
import {sprinkles} from "~/shared/styles/styles";

export function DocumentContentView({document}: {document: DocumentModel}) {
    return (
        <ContentView
            content={document.content}
            onNavigate={useNavigate()}
            className={sprinkles({paddingBottom: "24", paddingX: "2"})}
            // en dash (https://graphemica.com/2013)
            // Represents no content
            placeholder={"\u2013"}
        />
    );
}
