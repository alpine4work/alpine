import Cookies from "js-cookie";
import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {I18nProvider} from "react-aria";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {getCurrentTimeZone} from "~/shared/helpers/date/time_zone.js";
import {getRealmId} from "~/shared/id/realm_id.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {ClientInfo, defaultClientInfo} from "~/shared/remix/client_info.js";

const clientInfo = new Lazy(
    (): ClientInfo => ({
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        timeZone: getCurrentTimeZone(),
        locale: "en-US",
    }),
);

/**
 * Get the current client info without listening for changes.
 */
export function getClientInfoWithoutListening(): ClientInfo {
    assert(typeof window !== "undefined");
    return clientInfo.get();
}

const BrowserIdContext = createContext<BrowserId | null>(null);
const ClientInfoContext = createContext<ClientInfo | null>(null);

/**
 * We give web browsers an identifier that persists across page reloads. You
 * may use this hook to access it.
 */
export function useBrowserId(): BrowserId {
    const browserId = useContext(BrowserIdContext);

    if (browserId === null) {
        // In Jest return a mock value instead of requiring a root context provider.
        if (import.meta.jest) {
            return getRealmId() as any as BrowserId;
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<ClientInfoContextProvider>`",
        );
    }

    return browserId;
}

/**
 * We include client information (like time zone) in React context. When server
 * side rendering we get this information from a cookie. Then when the client
 * loads we re-render the app with the real values.
 *
 * Client info is currently only computed when the app loads. We do not listen
 * for changes and re-render the app.
 */
export function useClientInfo(): ClientInfo {
    const clientInfo = useContext(ClientInfoContext);

    if (clientInfo === null) {
        // In Jest tests use a dummy date context instead of requiring a root
        // context provider.
        if (import.meta.jest) {
            return defaultClientInfo;
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<ClientInfoContextProvider>`",
        );
    }

    return clientInfo;
}

export function ClientInfoContextProvider({
    browserId,
    initialClientInfo,
    children,
}: {
    browserId: BrowserId;
    initialClientInfo: ClientInfo;
    children: ReactNode;
}) {
    const [clientInfo, setClientInfo] = useState(initialClientInfo);

    useEffect(() => {
        const actualClientInfo = getClientInfoWithoutListening();

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

    return (
        <BrowserIdContext.Provider value={browserId}>
            <ClientInfoContext.Provider value={clientInfo}>
                <I18nProvider
                    // Also render `react-aria`'s `I18nProvider` so that `react-aria` hooks get the
                    // correct locale.
                    locale={clientInfo.locale}
                >
                    {children}
                </I18nProvider>
            </ClientInfoContext.Provider>
        </BrowserIdContext.Provider>
    );
}
