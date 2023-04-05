// We do this weird side-effect import/export to prevent issues with a cyclic
// dependency. The `Store` class depends on `MappedStore` and `MappedStore`
// depends on `Store`. The `MappedStore` file needs to be imported first since
// it needs `Store` during its initialization. So we have this level of
// indirection to ensure `MappedStore` is imported first.

import "~/client/helpers/store/mapped_store";

export {Store} from "~/client/helpers/store/internal/store";
