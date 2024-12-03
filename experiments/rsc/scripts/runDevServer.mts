import express from "express";
import { createBuilder, createServer as createViteServer } from "vite";
import { Miniflare, MiniflareOptions } from "miniflare";
import { resolve } from "node:path";

import { miniflareOptions, viteConfigs } from "./lib/configs.mjs";
import {
  DEV_SERVER_PORT,
  DIST_DIR,
  WORKER_DIST_DIR,
} from "./lib/constants.mjs";
import { buildVendorBundles } from "./buildVendorBundles.mjs";
import { codegenTypes } from "./codegenTypes.mjs";
import { dispatchNodeRequestToMiniflare } from "./lib/requestUtils.mjs";

let promisedSetupComplete = Promise.resolve();

const setup = async () => {
  const updateWorker = async () => {
    console.log("Rebuilding worker...");

    const result = (await builder.build(builder.environments["worker"])) as {
      output: (
        | {
            type: "asset";
          }
        | {
            type: "chunk";
            fileName: string;
            code: string;
          }
      )[];
    };

    const bundles = result.output
      .filter((output) => output.type === "chunk")
      .map(({ fileName, code }) => ({
        type: "ESModule" as const,
        path: resolve(WORKER_DIST_DIR, fileName),
        contents: code,
      }));

    await miniflare.setOptions({
      ...miniflareOptions,
      modules: bundles,
    });
  };

  const builder = await createBuilder(
    viteConfigs.dev({
      updateWorker,
    }),
  );

  const viteDevServer = await createViteServer(
    viteConfigs.dev({
      updateWorker,
    }),
  );

  const miniflare = new Miniflare({
    ...miniflareOptions,
    script: "",
  } as MiniflareOptions);

  // context(justinvdm, 2024-11-28): We don't need to wait for the initial bundle builds to complete before starting the dev server, we only need to have this complete by the first request
  promisedSetupComplete = new Promise(setImmediate)
    .then(() => buildVendorBundles().then(updateWorker))
    .then(() => {
      // context(justinvdm, 2024-11-28): Types don't affect runtime, so we don't need to block the dev server on them
      void codegenTypes();
    });

  return {
    miniflare,
    viteDevServer,
  };
};

const createServers = async () => {
  const { miniflare, viteDevServer } = await setup();

  const app = express();

  if (process.env.PREVIEW) {
    app.use("/static", express.static(resolve(DIST_DIR, "client", "assets")));
  }

  app.use(async (req, res) => {
    const url = new URL(req.url as string, `http://${req.headers.host}`);

    if (
      url.pathname.startsWith("/src") ||
      url.pathname.startsWith("/node_modules") ||
      url.pathname.startsWith("/@") ||
      url.pathname.startsWith("/__vite")
    ) {
      viteDevServer.middlewares(req, res);
      return;
    }

    try {
      await promisedSetupComplete;
      return await dispatchNodeRequestToMiniflare({
        miniflare,
        request: req,
        response: res,
      });
    } catch (error) {
      console.error("Request handling error:", error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  process.on("beforeExit", async () => {
    await miniflare.dispose();
  });

  app.listen(DEV_SERVER_PORT, () => {
    console.log(`
🚀 Dev server fired up and ready to rock! 🔥
⭐️ Local: http://localhost:${DEV_SERVER_PORT}
`);
  });
};

createServers();
