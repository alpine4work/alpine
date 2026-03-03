import {FlattenedMappedStore} from "~/shared/store/internal/flattened_mapped_store.js";
import {MappedManyStore} from "~/shared/store/internal/mapped_many_store.js";
import {MappedStore} from "~/shared/store/internal/mapped_store.js";
import {ReducedStore} from "~/shared/store/internal/reduced_store.js";
import {
    Store,
    setFlattenedMappedStore,
    setMappedManyStore,
    setMappedStore,
    setReducedStore,
} from "~/shared/store/internal/store.js";

// Our `internal/store.ts` module doesn't import dependencies that would create a
// cycle. Instead we import those dependencies here and tell our
// `internal/store.ts` module about them.
setFlattenedMappedStore(FlattenedMappedStore);
setMappedStore(MappedStore);
setMappedManyStore(MappedManyStore);
setReducedStore(ReducedStore);

export {Store};
