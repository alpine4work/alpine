import {useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {createLifetimeAccessCheckoutUrl} from "~/shared/rpc/accounts_rpc_definitions.js";

export default function PurchaseLifetimeAccessRoute() {
    const context = useAppContext();
    const navigate = useNavigate();
    const calledCreateLifetimeAccessCheckoutUrl = useRef(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (calledCreateLifetimeAccessCheckoutUrl.current) return;
        calledCreateLifetimeAccessCheckoutUrl.current = true;

        createLifetimeAccessCheckoutUrl(context, {
            currentPathname: "/",
        })
            .then(({url}) => {
                window.location.href = url;
            })
            .catch(error => {
                // TODO: this check is bad, we'll update it when we do
                //   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/25fpk56f9ycc25kv388fqsn5a4
                if (error instanceof FailedPreconditionError) {
                    navigate(`/?purchased=lifetime-access`);
                } else {
                    setError(error);
                }
            });
    }, [context, navigate]);

    // If we had an error in our promise, throw it so the error boundary can handle it
    if (error) {
        throw error;
    }

    return null;
}
