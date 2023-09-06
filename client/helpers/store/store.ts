// Our `internal/store.ts` module doesn't import dependencies that would create
// a cycle. Instead we import those dependencies here and tell our
// `internal/store.ts` module about them.

import {FlattenedStore} from "~/client/helpers/store/internal/flattened_store.js";
import {MappedStore} from "~/client/helpers/store/internal/mapped_store.js";
import {Store, setFlattenedStore, setMappedStore} from "~/client/helpers/store/internal/store.js";

setFlattenedStore(FlattenedStore);
setMappedStore(MappedStore);

export {Store};
