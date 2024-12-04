import { MiniflareOptions } from "miniflare";
import { getD1Databases } from "../lib/getD1Databases";
import { D1_PERSIST_PATH } from "../lib/constants.mjs";

export const miniflareConfig: Partial<MiniflareOptions> = {
  // context(justinvdm, 2024-11-21): `npx wrangler d1 migrations apply` creates a sqlite file in `.wrangler/state/v3/d1`
  d1Persist: D1_PERSIST_PATH,
  modules: true,
  compatibilityFlags: [
    "streams_enable_constructors",
    "transformstream_enable_standard_constructor",
    "nodejs_compat",
  ],
  d1Databases: await getD1Databases(),
};
