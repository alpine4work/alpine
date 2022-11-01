"use client";

import {DocumentContentEditor} from "~/client/documents/document-content-editor";
import {DocumentModel} from "~/shared/documents/document-model";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema";

export const propsSchema = Schema.object({
    document: DocumentModel.schema(),
});

export function DocumentContentEditorBridge(serializedProps: SchemaSerializedObjectValue) {
    const {document} = propsSchema.deserialize(serializedProps);
    return <DocumentContentEditor document={document} />;
}
