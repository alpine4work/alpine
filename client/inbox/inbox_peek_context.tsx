import {Memo, ReactNode, createContext, useContext, useMemo} from "react";

export type InboxPeekContext = {
    readonly onCreateMessageOptimistically: (promise: Promise<unknown>) => void;
};

const InboxPeekContext = createContext<InboxPeekContext | null>(null);

export function useInboxPeekContext() {
    return useContext(InboxPeekContext);
}

export function InboxPeekContextProvider({
    onCreateMessageOptimistically,
    children,
}: {
    onCreateMessageOptimistically: Memo<(promise: Promise<unknown>) => void>;
    children?: ReactNode;
}) {
    return (
        <InboxPeekContext.Provider
            value={useMemo(
                () => ({onCreateMessageOptimistically}),
                [onCreateMessageOptimistically],
            )}
        >
            {children}
        </InboxPeekContext.Provider>
    );
}
