import Cookies from "js-cookie";
import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {InternalError} from "~/shared/error/error";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {defaultTimeZone, getCurrentTimeZone} from "~/shared/helpers/date/time_zone";
import {ClientInfo} from "~/shared/remix/client_info";

/**
 * Default client info to use in tests or in server-side rendering before we
 * set the client info cookie.
 */
export const defaultClientInfo: ClientInfo = {
    /**
     * The default screen width we use when server-side rendering when we don't
     * know what the user's actual screen width is. 1920px is the width of the
     * [largest common screen resolution][1] so that should cover the majority of
     * devices.
     *
     * [1]: https://www.browserstack.com/guide/ideal-screen-sizes-for-responsive-design
     */
    screenWidth: 1920,
    /**
     * The default screen height we use when server-side rendering when we don't
     * know what the user's actual screen height is. 1080px is the height of the
     * [largest common screen resolution][1] so that should cover the majority of
     * devices.
     *
     * [1]: https://www.browserstack.com/guide/ideal-screen-sizes-for-responsive-design
     */
    screenHeight: 1080,
    /**
     * We use the New York time zone when we haven't gotten the client's actual
     * time zone since that's where our company is based.
     */
    timeZone: defaultTimeZone,
};

function getClientInfo(): ClientInfo {
    return {
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        timeZone: getCurrentTimeZone(),
    };
}

const ClientInfoContext = createContext<ClientInfo | null>(null);

/**
 * We include client information (like time zone) in React context. When server
 * side rendering we get this information from a cookie. Then when the client
 * loads we re-render the app with the real values.
 */
export function useClientInfo(): ClientInfo {
    const clientInfo = useContext(ClientInfoContext);

    if (clientInfo === null) {
        // In Jest tests use a dummy date context instead of requiring a root
        // context provider.
        if (typeof jest !== "undefined") {
            return defaultClientInfo;
        }

        throw new InternalError(
            "Expected component to be rendered inside a <ClientInfoContextProvider>",
        );
    }

    return clientInfo;
}

export function ClientInfoContextProvider({
    initialClientInfo,
    children,
}: {
    initialClientInfo: ClientInfo;
    children: ReactNode;
}) {
    const [clientInfo, setClientInfo] = useState(initialClientInfo);

    useEffect(() => {
        const actualClientInfo = getClientInfo();

        setClientInfo(clientInfo => {
            if (isDeepEqual(clientInfo, actualClientInfo)) return clientInfo;
            return actualClientInfo;
        });

        const clientInfoString = JSON.stringify(actualClientInfo);

        // Update the client info cookie to the client's actual information. Now in the
        // future server-side renders will have the right client info.
        const cookieClientInfoString = Cookies.get("client-info");
        if (cookieClientInfoString !== clientInfoString) {
            Cookies.set("client-info", clientInfoString, {expires: 365});
        }
    }, []);

    return <ClientInfoContext.Provider value={clientInfo}>{children}</ClientInfoContext.Provider>;
}
