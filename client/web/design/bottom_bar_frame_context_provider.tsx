import {ReactNode, useState} from "react";
import {
    BottomBarFrameContext,
    getInitialBottomBarFrameContext,
} from "~/client/web/design/internal/bottom_bar_frame_context.js";

export function BottomBarFrameContextProvider({children}: {children?: ReactNode}) {
    const [context] = useState<BottomBarFrameContext>(getInitialBottomBarFrameContext);

    return (
        <BottomBarFrameContext.Provider value={context}>{children}</BottomBarFrameContext.Provider>
    );
}
