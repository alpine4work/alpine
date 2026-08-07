import Cookies from "js-cookie";
import {
    ReactElement,
    ReactNode,
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import {I18nProvider} from "react-aria";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {defaultTimeZone, getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {getRealmId} from "~/shared/id/realm_id.open_source.js";
import {BrowserId} from "~/shared/id/types/id_types.open_source.js";
import {
    ClientInfo,
    defaultClientInfo,
    getRenderingEngineFromUserAgent,
    isAppleDeviceUserAgent,
} from "~/shared/remix/client_info.js";

const clientInfo = new Lazy((): ClientInfo => {
    // In Jest tests we use a dummy client info since properties like
    // `window.screen.width` report 0.
    if (import.meta.jest) {
        return defaultClientInfo;
    }

    return {
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        // In integration tests, always use the default time zone. To help avoid time zone
        // issues.
        timeZone: process.env.NODE_ENV === "test" ? defaultTimeZone : getCurrentTimeZone(),
        locale: defaultLocale,
        renderingEngine: getRenderingEngineFromUserAgent(navigator.userAgent),
        // On the client, use `navigator.platform` to test if this is an Apple device in
        // case the user agent header is spoofed.
        isAppleDevice:
            isAppleDeviceUserAgent(navigator.userAgent) || /Mac/.test(navigator.platform),
        // We can safely look for `CyberworldsNativeMobile` in the user agent since it's a
        // unique string that should only be used by our native app shells.
        isNativeMobile: /CyberworldsNativeMobile/.test(navigator.userAgent),
        // Unlike other information in `ClientInfo`, the window spacing scale may change
        // over time as the user resizes their window. However, this value stays constant
        // in `ClientInfo` and represents the spacing scale at initial render.
        initialWindowSpacingScale: getSpacingScaleWithoutListening(),
    };
});

/**
 * Get the current client info without listening for changes. Can only be called on
 * the client otherwise will throw an error. Prefer `useClientInfo()` which works
 * on both the client and server.
 *
 * `ClientInfo` never changes after the page's initial load. All data in
 * `ClientInfo` should be immutable facts about the current device. Which is why we
 * don't have a `WithoutListening` suffix like other functions such as
 * `getPlatformWithoutListening()`.
 */
export function getClientInfo(): ClientInfo {
    assert(typeof window !== "undefined");
    return clientInfo.get();
}

// eslint-disable-next-line react-refresh/only-export-components
const BrowserIdContext = createContext<BrowserId | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
const ClientInfoContext = createContext<ClientInfo | null>(null);

/**
 * We give web browsers an identifier that persists across page reloads. You may
 * use this hook to access it.
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
 * side rendering we get this information from a cookie. Then when the client loads
 * we re-render the app with the real values.
 *
 * Client info is currently only computed when the app loads. We do not listen for
 * changes and re-render the app.
 */
export function useClientInfo(): ClientInfo {
    const clientInfo = useContext(ClientInfoContext);

    if (clientInfo === null) {
        // In Jest tests use a dummy client info context instead of requiring a root
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

export function useClientInfoContextProvider({
    browserId,
    initialClientInfo,
    cookieNameSuffix,
}: {
    browserId: BrowserId;
    initialClientInfo: ClientInfo;
    cookieNameSuffix: string;
}): {
    clientInfo: ClientInfo;
    render: (children: ReactNode) => ReactElement;
} {
    const [clientInfo, setClientInfo] = useState(initialClientInfo);

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const actualClientInfo = getClientInfo();

        setClientInfo(clientInfo => {
            if (isDeepEqual(clientInfo, actualClientInfo)) return clientInfo;
            return actualClientInfo;
        });

        const clientInfoString = JSON.stringify(actualClientInfo);

        // Update the client info cookie to the client's actual information. Now in the
        // future server-side renders will have the right client info.
        const cookieClientInfoString = Cookies.get(`client-info${cookieNameSuffix}`);
        if (cookieClientInfoString !== clientInfoString) {
            Cookies.set(`client-info${cookieNameSuffix}`, clientInfoString, {expires: 365});
        }
    }, [cookieNameSuffix]);

    return {
        clientInfo,
        render: (children: ReactNode) => (
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
        ),
    };
}
