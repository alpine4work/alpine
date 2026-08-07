/* eslint-disable react-refresh/only-export-components */
import {ReactNode, createContext, useContext} from "react";
import {DocumentationApiModel} from "~/shared/docs/documentation_api_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

const DocumentationApiModelContext = createContext<DocumentationApiModel | null>(null);

/**
 * Provides the parsed API docs model to the reference UI. Type links, doc blocks,
 * and popovers resolve schema `$ref`s through this context so the cyclic schema
 * graph can be walked lazily from anywhere in the tree.
 */
export function DocumentationApiModelProvider({
    model,
    children,
}: {
    model: DocumentationApiModel;
    children: ReactNode;
}) {
    return (
        <DocumentationApiModelContext.Provider value={model}>
            {children}
        </DocumentationApiModelContext.Provider>
    );
}

export function useDocumentationApiModel(): DocumentationApiModel {
    return assertExists(
        useContext(DocumentationApiModelContext),
        "Expected an `<DocumentationApiModelProvider>` above this component",
    );
}

/**
 * The API docs model if one is provided. Guide pages render `<TypeLink>`s without
 * loading the model — those links degrade to plain navigation without the hover
 * popover.
 */
export function useDocumentationApiModelIfExists(): DocumentationApiModel | null {
    return useContext(DocumentationApiModelContext);
}
