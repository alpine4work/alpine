import {Memo, ReactNode, createContext, useContext} from "react";
import {InternalError} from "~/shared/error/error.js";

/**
 * Default string we use for the title of browser tabs.
 */
export const metaDefaultTitle = "Alpine";

/**
 * Character we use for separating different parts of a title.
 */
export const metaTitleSeparator = "|";

/**
 * String we put at the end of titles to identify our product in the user's browser
 * tab. If we use a title for a peek then we will strip this postfix since it's
 * clear what product we're in.
 */
export const metaTitlePostfix = ` ${metaTitleSeparator} ${metaDefaultTitle}`;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noopUpdateMetaTitle = (title => {}) as Memo<(title: string) => void>;

const UpdateMetaTitleContext = createContext<Memo<(title: string) => void> | null>(null);

/**
 * Update the title of the page from what we returned from the Remix `meta()`
 * function. This is a hook which consumes context because Remix embeds update a
 * different title.
 *
 * Lives in `app/internal` so you can only use it directly in route modules. Try to
 * avoid leaking knowledge of the meta title to sub-components.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useUpdateMetaTitle(): Memo<(title: string) => void> {
    const updateMetaTitle = useContext(UpdateMetaTitleContext);

    if (!updateMetaTitle) {
        // In Jest, to avoid requiring a context provider noop when trying to update the
        // title.
        if (import.meta.jest) return noopUpdateMetaTitle;

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
