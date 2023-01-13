import {ContentView} from "~/client/content/content_view";
import {DocumentModel} from "~/shared/documents/document_model";
import {sprinkles} from "~/shared/styles/styles";

export function DocumentContentView({document}: {document: DocumentModel}) {
    return <ContentView content={document.content} className={sprinkles({paddingBottom: "24"})} />;
}
