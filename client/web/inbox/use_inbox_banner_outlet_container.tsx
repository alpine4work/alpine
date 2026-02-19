import {ReactElement, ReactNode} from "react";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {InboxBannerOutletContainer} from "~/client/web/inbox/internal/inbox_banner_outlet_container.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

export function useInboxBannerOutletContainer<Children extends ReactNode>(
    {
        initialEntry,
        ...props
    }: {
        initialEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
        maxWidth: Spacing | "full";
        withoutArchiveButton?: boolean;
    },
    children: Children,
): ReactElement | Children {
    const inboxContext = useInboxContext();

    const entry = inboxContext?.entry ?? initialEntry;

    if (!entry) {
        return children;
    }

    return (
        <InboxBannerOutletContainer
            {...props}
            initialEntry={entry}
            parentEntry={inboxContext?.entry ?? null}
            navigation={inboxContext?.navigation ?? null}
        >
            {children}
        </InboxBannerOutletContainer>
    );
}
