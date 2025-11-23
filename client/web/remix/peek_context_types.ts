import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {PeekId} from "~/shared/id/types/id_types.js";

export type PeekContext = {
    readonly id: PeekId;
    readonly layout: RouteLayout;
    readonly withinStack: boolean;
    readonly withoutSearchAffinityViewEntityInteraction: boolean;
};
