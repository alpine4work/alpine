/*!
 * Use this module to mark files that should only be executed and bundled on
 * the server.
 *
 * Uses the Remix `.server.ts` [naming convention][1].
 *
 * [1]: https://remix.run/docs/en/v1/api/conventions
 */

import {InternalError} from "~/shared/error/error";

if (typeof window !== "undefined")
    throw new InternalError("Expected this file to only run on the server");
