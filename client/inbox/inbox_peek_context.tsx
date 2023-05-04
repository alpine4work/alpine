import {Memo, ReactNode, createContext, useContext, useMemo} from "react";

export type InboxPeekContext = {
    readonly deleteActiveEntryOptimistically: (promise: Promise<unknown>) => void;
};

const InboxPeekContext = createContext<InboxPeekContext | null>(null);

export function useInboxPeekContext() {
    return useContext(InboxPeekContext);
}

export function InboxPeekContextProvider({
    deleteActiveEntryOptimistically,
    children,
}: {
    deleteActiveEntryOptimistically: Memo<(promise: Promise<unknown>) => void>;
    children?: ReactNode;
}) {
    return (
        <InboxPeekContext.Provider
            value={useMemo(
                () => ({deleteActiveEntryOptimistically}),
                [deleteActiveEntryOptimistically],
            )}
        >
            {children}
        </InboxPeekContext.Provider>
    );
}
