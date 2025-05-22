import {Box} from "~/client/design/box.js";
import {UnimplementedError} from "~/shared/error/error.js";

export default function PeopleSettings() {
    if (process.env.NODE_ENV === "production")
        throw new UnimplementedError("Shouldn't be able to open people settings in production");

    return (
        <Box width="full" height="full">
            People page has not been implemented yet.
        </Box>
    );
}
