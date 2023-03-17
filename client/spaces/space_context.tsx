import {ReactNode, createContext, useContext, useMemo} from "react";
import {InternalError} from "~/shared/error/error";
import {AccountModel} from "~/shared/models/account_model";
import {SpaceModel} from "~/shared/models/space_model";

const SpaceContext = createContext<{
    readonly space: SpaceModel;
    readonly currentAccount: AccountModel;
} | null>(null);

/**
 * Context available when we are in a space route. Throws an
 * error if we are not in a space route.
 */
export function useSpaceContext() {
    const spaceContext = useContext(SpaceContext);
    if (!spaceContext) throw new InternalError("Must be in a space route to get space context");
    return spaceContext;
}

export function SpaceContextProvider({
    space,
    currentAccount,
    children,
}: {
    space: SpaceModel;
    currentAccount: AccountModel;
    children?: ReactNode;
}) {
    return (
        <SpaceContext.Provider
            value={useMemo(() => ({space, currentAccount}), [currentAccount, space])}
        >
            {children}
        </SpaceContext.Provider>
    );
}
