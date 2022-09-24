// Jest doesn't currently apply module path mapping in the global setup script,
// so register `tsconfig-paths` so that imports work correctly.
//
// NOTE(calebmer): I don't think `tsconfig-paths` will kick in when running
// tests? Which is good. We'd prefer Jest's path transformation to kick in. The
// reason I have that expectations is the [`globalSetup` docs][1] say globals
// from `globalSetup` are not available in tests which makes me think
// `globalSetup` is run in a different process.
//
// [1]: https://jestjs.io/docs/configuration#globalsetup-string
import "tsconfig-paths/register";

import {prepareLocalstack} from "~/admin/aws/prepare-localstack";
import {Lazy} from "~/shared/helpers/control/lazy";

const setupPromise = new Lazy(async () => {
    // Log an empty line so we don't print on the same line as Jest logs.
    // eslint-disable-next-line no-console
    console.log();

    await prepareLocalstack();
});

// eslint-disable-next-line import/no-default-export
export default async function globalSetup() {
    // Global setup runs once for every test run in watch mode but we only want it
    // to run once when Jest starts up. So we have a global `Lazy` that only
    // runs once.
    await setupPromise.get();
}
