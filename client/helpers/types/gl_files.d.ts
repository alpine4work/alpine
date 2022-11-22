declare module "*.frag" {
    declare let asset: string;
    // eslint-disable-next-line only-erasable-types, import/no-default-export
    export default asset;
}

declare module "*.vert" {
    declare let asset: string;
    // eslint-disable-next-line only-erasable-types, import/no-default-export
    export default asset;
}
