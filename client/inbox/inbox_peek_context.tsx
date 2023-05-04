import {Memo, ReactNode, createContext, useContext, useMemo} from "react";

export type InboxPeekContext = {
    readonly archiveActiveEntryOptimistically: (promise: Promise<unknown>) => void;
};

const InboxPeekContext = createContext<InboxPeekContext | null>(null);

export function useInboxPeekContext() {
    return useContext(InboxPeekContext);
}

export function InboxPeekContextProvider({
    archiveActiveEntryOptimistically,
    children,
}: {
    archiveActiveEntryOptimistically: Memo<(promise: Promise<unknown>) => void>;
    children?: ReactNode;
}) {
    return (
        <InboxPeekContext.Provider
            value={useMemo(
                () => ({archiveActiveEntryOptimistically}),
                [archiveActiveEntryOptimistically],
            )}
        >
            {children}
        </InboxPeekContext.Provider>
    );
}
