import {Memo, ReactNode, createContext, useContext} from "react";
import {InternalError} from "~/shared/error/error";

/**
 * String we put at the end of titles to identify our product in the user's
 * browser tab. If we use a title for a peek then we will strip this postfix
 * since it's clear what product we're in.
 */
export const metaTitlePostfix = " | Cyberworlds";

const noopUpdateMetaTitle = (title => {}) as Memo<(title: string) => void>;

const UpdateMetaTitleContext = createContext<Memo<(title: string) => void> | null>(null);

/**
 * Update the title of the page from what we returned from the Remix `meta()`
 * function. This is a hook which consumes context because Remix embeds update
 * a different title.
 */
export function useUpdateMetaTitle(): Memo<(title: string) => void> {
    const updateMetaTitle = useContext(UpdateMetaTitleContext);

    if (!updateMetaTitle) {
        // In Jest, to avoid requiring a context provider noop when trying to
        // update the title.
        if (typeof jest !== "undefined") return noopUpdateMetaTitle;

        throw new InternalError(
            "Must render in a `<UpdateMetaTitleContextProvider>` to use this hook",
        );
    }

    return updateMetaTitle;
}

export function UpdateMetaTitleContextProvider({
    onUpdateMetaTitle,
    children,
}: {
    onUpdateMetaTitle: Memo<(title: string) => void>;
    children?: ReactNode;
}) {
    return (
        <UpdateMetaTitleContext.Provider value={onUpdateMetaTitle}>
            {children}
        </UpdateMetaTitleContext.Provider>
    );
}
