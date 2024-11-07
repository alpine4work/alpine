import {To} from "react-router";

export type PeekStackContext = {
    readonly push: (to: To, options?: {focus?: boolean}) => Promise<void>;
};
