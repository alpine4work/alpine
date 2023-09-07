// Our `internal/store.ts` module doesn't import dependencies that would create
// a cycle. Instead we import those dependencies here and tell our
// `internal/store.ts` module about them.

import {FlattenedMappedStore} from "~/client/helpers/store/internal/flattened_mapped_store.js";
import {MappedStore} from "~/client/helpers/store/internal/mapped_store.js";
import {
    Store,
    setFlattenedMappedStore,
    setMappedStore,
} from "~/client/helpers/store/internal/store.js";

setFlattenedMappedStore(FlattenedMappedStore);
setMappedStore(MappedStore);

export {Store};
