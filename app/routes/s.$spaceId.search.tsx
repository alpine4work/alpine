import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SearchMobileView} from "~/client/search/search_mobile_view.js";

// NOCOMMIT:
//
// - Server load affinity list
// - Clear search button?

export function meta() {
    return [{title: `Search${metaTitlePostfix}`}];
}

export default function SearchRoute() {
    return <SearchMobileView />;
}
