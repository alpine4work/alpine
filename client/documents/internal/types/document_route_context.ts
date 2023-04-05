import type {MutableRefObject} from "react";
import type {DocumentContentEditorWebSocketClient} from "~/client/documents/internal/document_content_editor_web_socket_client";

/**
 * The context provided by `<DocumentRouteContextProvider>`. Lives in a `types`
 * folder so our linter enforces that only types can be used. So when the
 * compiler erases types any imports will not be included in a bundle that
 * imports this file.
 */
export type DocumentRouteContext = {
    readonly connectCountRef: MutableRefObject<number>;
    readonly client: DocumentContentEditorWebSocketClient;
};
