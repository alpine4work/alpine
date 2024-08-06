import {ReactNode, createContext, useContext, useMemo} from "react";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {archiveInboxEntryOptimistically} from "~/client/inbox/use_archive_inbox_entry.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

export type InboxContext = {
    readonly onCreateMessageOptimistically: (promise: Promise<unknown>) => void;
};

const InboxContext = createContext<InboxContext | null>(null);

export function useInboxContext() {
    return useContext(InboxContext);
}

export function InboxContextProvider({
    entry,
    children,
}: {
    entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    children?: ReactNode;
}) {
    const onCreateMessageOptimistically = useEvent((promise: Promise<unknown>) => {
        // We may not have an entry if the path in the URL is no longer in the inbox
        // entries query.
        if (!entry) return;

        // Only new entries implicitly dismiss on message creation.
        if (entry.model.isArchived) return;

        let shouldImplicitlyDismissAfterCreateMessage;
        switch (entry.model.type) {
            case "Chat":
            case "PostComments":
            case "Task":
            case "DocumentCommentThread":
                shouldImplicitlyDismissAfterCreateMessage = true;
                break;
            case "ChannelPosts":
            case "DocumentNewCommentThreads":
                shouldImplicitlyDismissAfterCreateMessage = false;
                break;
            default:
                throw exhaustive(entry.model);
        }

        // Only some entries implicitly dismiss after sending a message.
        if (!shouldImplicitlyDismissAfterCreateMessage) return;

        archiveInboxEntryOptimistically({
            promise,
            entry,
            withAnimation: true,
        });
    });

    return (
        <InboxContext.Provider
            value={useMemo(
                () => ({onCreateMessageOptimistically}),
                [onCreateMessageOptimistically],
            )}
        >
            {children}
        </InboxContext.Provider>
    );
}
