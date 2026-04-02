import {Memo} from "react";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {PeekId} from "~/shared/id/types/id_types.js";

export type PeekContext = {
    readonly id: PeekId;
    readonly layout: RouteLayout;
    readonly stack: Memo<{
        readonly showTaskAutoSaveHint: () => void;
    }> | null;
    readonly withoutSearchAffinityViewEntityInteraction: boolean;
};
