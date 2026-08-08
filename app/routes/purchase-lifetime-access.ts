import {useEffect, useRef} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {createLifetimeAccessCheckoutSessionUrl} from "~/shared/rpc/accounts_rpc_definitions.js";

export default function PurchaseLifetimeAccessRoute() {
    const context = useAppContext();
    const navigate = useNavigate();
    const calledCreateLifetimeAccessCheckoutUrl = useRef(false);
    const setErrorState = useErrorState();

    useEffect(() => {
        if (calledCreateLifetimeAccessCheckoutUrl.current) return;
        calledCreateLifetimeAccessCheckoutUrl.current = true;

        createLifetimeAccessCheckoutSessionUrl(context, {
            currentPathname: "/",
        })
            .then(({result}) => {
                if (result.ok) {
                    window.location.href = result.url;
                } else {
                    switch (result.reason) {
                        case "AlreadyPurchased":
                            navigate(`/?purchased=lifetime-access`);
                            break;
                        default:
                            throw exhaustive(result.reason);
                    }
                }
            })
            .catch(error => {
                setErrorState(error);
            });
    }, [context, navigate, setErrorState]);

    return null;
}
