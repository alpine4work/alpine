/*!
 * All [Cloudflare bindings][1] we give a `CLOUDFLARE_BINDING_` prefix since
 * they will be global variables in our worker script.
 *
 * This module takes the global variables and exports them from a module for
 * more convenient usage.
 *
 * [1]: https://developers.cloudflare.com/workers/platform/environment-variables/
 */

import {InternalError} from "~/shared/error/error";
import {quote} from "~/shared/helpers/string/quote";

export const DocumentCollaborationDurableObjectNamespace: DurableObjectNamespace =
    getCloudflareBinding("DocumentCollaborationDurableObjectNamespace");

function getCloudflareBinding(name: string): any {
    const bindingName = `CLOUDFLARE_BINDING_${name}`;

    if (!(bindingName in globalThis))
        throw new InternalError(quote`Expected global ${bindingName} variable`);

    return (globalThis as any)[bindingName];
}
