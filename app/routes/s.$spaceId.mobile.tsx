import {Outlet} from "react-router";
import {notFoundErrorDisplayMessage} from "~/app/helpers/not_found_error_display_message.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {FailedPreconditionError} from "~/shared/error/error.js";

export default function MobileLayout() {
    const isInitialAppRender = useIsInitialAppRender();
    const isMobile = useIsMobile();

    // We may get `isMobile` wrong on the initial app render. Optimistically always
    // render the layout on initial render
    if (!isInitialAppRender && !isMobile) {
        throw new FailedPreconditionError("Can't render mobile route on a non-mobile platform", {
            displayMessage: notFoundErrorDisplayMessage,
        });
    }

    return <Outlet />;
}
