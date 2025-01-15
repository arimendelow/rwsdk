import { App } from "./app/App"
import { type SessionDO } from "./session";
import { setupDb } from "./db";

import { transformRscToHtmlStream } from "./render/transformRscToHtmlStream";
import { injectRSCPayload } from "rsc-html-stream/server";
import { renderToRscStream } from "./render/renderToRscStream";

import { ssrWebpackRequire } from "./imports/worker";
import { rscActionHandler } from "./register/worker";
import { setupR2Storage } from "./r2storage";
import InvoiceListPage from "./app/InvoiceListPage";
import InvoiceDetailPage from "./app/pages/invoiceDetail/Page";

// todo(peterp, 2024-11-25): Make these lazy.
const routes = {
  "/": InvoiceListPage,
  "/invoice/:id": InvoiceDetailPage,
}

export { SessionDO } from "./session";

export default {
  async fetch(request: Request, env: Env) {
    globalThis.__webpack_require__ = ssrWebpackRequire;

    const id = env.SESSION_DO.idFromName("default");
    // todo(justinvdm, 2025-01-15): Get codegen working for DO classes
    const obj = env.SESSION_DO.get(id) as DurableObjectStub<SessionDO>;
    console.log(await obj.cowsay());

    try {
      const url = new URL(request.url);

      const isRSCRequest = url.searchParams.has("__rsc");
      const isRSCActionHandler = url.searchParams.has("__rsc_action_id");

      if (isRSCActionHandler) {
        await rscActionHandler(request);
      }

      if (url.pathname.startsWith("/assets/")) {
        url.pathname = url.pathname.slice("/assets/".length);
        return env.ASSETS.fetch(new Request(url.toString(), request));
      }

      setupDb(env);
      setupR2Storage(env);

      // The worker access the bucket and returns it to the user, we dont let them access the bucket directly
      if (request.method === "GET" && url.pathname.startsWith("/bucket/")) {
        const filename = url.pathname.slice("/bucket/".length);
        const object = await env.valley_directory_r2.get(filename);

        if (object === null) {
          return new Response("Object Not Found", { status: 404 });
        }

        const headers = new Headers();
        if (filename.endsWith(".jpg") || filename.endsWith(".png")) {
          headers.set("content-type", "image/jpeg");
        }

        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);

        return new Response(object.body, {
          headers,
        });
      }


      const renderPage = async (Page: any, props = {}) => {
        const rscPayloadStream = renderToRscStream(<Page {...props} />);

        if (isRSCRequest) {
          return new Response(rscPayloadStream, {
            headers: { "content-type": "text/x-component; charset=utf-8" },
          });
        }
        const [rscPayloadStream1, rscPayloadStream2] = rscPayloadStream.tee();

        const htmlStream = await transformRscToHtmlStream({
          stream: rscPayloadStream1,
          Parent: App,
        });

        const html = htmlStream.pipeThrough(
          injectRSCPayload(rscPayloadStream2),
        );
        return new Response(html, {
          headers: { "content-type": "text/html" },
        });
      };

      const pathname = new URL(request.url).pathname as keyof typeof routes;
      const Page = routes[pathname];
      if (Page) {
        return renderPage(Page)
      }

      if (pathname.startsWith("/invoice/")) {
        const id = pathname.slice("/invoice/".length);
        return renderPage(InvoiceDetailPage, { id });
      }

      if (!Page) {
        return new Response("Not found", { status: 404 });
      }

    } catch (e) {
      console.error("Unhandled error", e);
      throw e;
    }
  }
}