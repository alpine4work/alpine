import {BlobFactory} from "~/client/blob_factory/blob_factory";
import {sprinkles} from "~/shared/styles/styles";

export default function HomePage() {
    return (
        <>
            <BlobFactory />
            <main className={sprinkles({position: "relative"})}>Hello, world</main>
        </>
    );
}
