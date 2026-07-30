import SwitchSpaceRoute from "~/app/routes/switch-space.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";

export {meta, loader} from "~/app/routes/switch-space.js";

export default function MoreSwitchSpaceRoute() {
    const {space} = useSpaceContext();

    return <SwitchSpaceRoute selectedSpace={space} />;
}
