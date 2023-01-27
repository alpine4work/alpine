import {useMemo} from "react";

/**
 * Format a number as a human readable string. In English adds thousands
 * commas. For example `3000` becomes "3,000".
 */
export function PrettyNumber({number}: {number: number}) {
    const prettyNumber = useMemo(() => {
        const formatter = new Intl.NumberFormat("en-US", {
            notation: "standard",
            style: "decimal",
        });

        return formatter.format(number);
    }, [number]);

    return <>{prettyNumber}</>;
}
