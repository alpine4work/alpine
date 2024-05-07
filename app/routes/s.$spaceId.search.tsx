import {Box} from "~/client/design/box.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";

export function meta() {
    return [{title: `Search${metaTitlePostfix}`}];
}

// NOCOMMIT: Implement
export default function SearchRoute() {
    return <Box>Search!</Box>;
}
