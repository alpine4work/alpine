import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";

export function meta() {
    return [{title: `Home${metaTitlePostfix}`}];
}

// NOCOMMIT: Implement
export default function HomeRoute() {
    return null;
}
