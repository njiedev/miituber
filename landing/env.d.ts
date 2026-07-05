/// <reference types="vite/client" />

/** Mii data files imported as asset URLs (vite assetsInclude: "**\/*.ffsd"). */
declare module "*.ffsd?url" {
  const url: string;
  export default url;
}
