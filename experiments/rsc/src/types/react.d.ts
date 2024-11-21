/**
 * Represents an entry in the React Server Components import manifest.
 * Part of the build-time bundling process where:
 * - Client components marked with 'use client' are identified
 * - Their dependencies are bundled into separate chunks
 * - References are stored in react-client-manifest.json
 * This enables RSC to know how to load client components and their dependencies.
 * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#react-server-dom-webpackplugin
 */
type ImportManifestEntry = {
  id: string
  // chunks is a double indexed array of chunkId / chunkFilename pairs
  chunks: string[]
  name: string
}

type ClientReferenceManifestEntry = ImportManifestEntry

/**
 * Maps client component IDs to their manifest entries for RSC bundling.
 * This manifest is used by both server and client to coordinate the loading
 * of client components and their dependencies in the RSC architecture.
 */
type ClientManifest = {
  [id: string]: ClientReferenceManifestEntry
}

declare module 'react-server-dom-webpack/server.edge' {
  type Options = {
    environmentName?: string
    identifierPrefix?: string
    signal?: AbortSignal
    onError?: (error: mixed) => void
    onPostpone?: (reason: string) => void
  }

  /**
   * Edge runtime version of renderToReadableStream for RSC rendering.
   * Converts React elements into a special format called React Flight format,
   * which can serialize Server Components, including:
   * - Server Component render output
   * - Client Component references
   * - Props passed to Client Components
   * The stream can then be consumed by client-side RSC APIs to reconstruct the UI.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#rendertopipeablestream-from-react-server-dom-webpackserver
   */
  // https://github.com/facebook/react/blob/0711ff17638ed41f9cdea712a19b92f01aeda38f/packages/react-server-dom-webpack/src/ReactFlightDOMServerEdge.js#L48
  export function renderToReadableStream(
    model: ReactClientValue,
    webpackMap: ClientManifest,
    options?: Options,
  ): ReadableStream

  /**
   * Registers a client component reference for use in RSC.
   * Part of the system that enables Server Components to render Client Components by:
   * - Creating a proxy for the Client Component
   * - Allowing props to be passed from Server to Client Components
   * - Managing the client-side loading and hydration process
   * Used in conjunction with the 'use client' directive to mark Client Components.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#client-components
   */
  // https://github.com/facebook/react/blob/0711ff17638ed41f9cdea712a19b92f01aeda38f/packages/react-server-dom-webpack/src/ReactFlightWebpackReferences.js#L36
  export function registerClientReference<T>(
    proxyImplementation: T,
    id: string,
    exportName: string,
  ): T
}

// Should be able to use just react-dom/server, but right now we can't
// See https://github.com/facebook/react/issues/26906
declare module 'react-dom/server.edge' {
  export * from 'react-dom/server'
}

declare module 'react-server-dom-webpack/client' {
  // https://github.com/facebook/react/blob/dfaed5582550f11b27aae967a8e7084202dd2d90/packages/react-server-dom-webpack/src/ReactFlightDOMClientBrowser.js#L31
  export type Options<A, T> = {
    callServer?: (id: string, args: A) => Promise<T>
  }

  /**
   * Creates a Promise-like structure from a fetch Response containing RSC data.
   * Key client-side API that:
   * - Handles fetching RSC data from the server
   * - Processes the React Flight format response
   * - Reconstructs the React element tree
   * - Manages Client Component loading and hydration
   * Used when the client needs to fetch and render new Server Components.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#createfromfetch-from-react-server-dom-webpackclient
   */
  export function createFromFetch<A, T>(
    // `Response` is a Web Response:
    // https://developer.mozilla.org/en-US/docs/Web/API/Response
    promiseForResponse: Promise<Response>,
    options?: Options<A, T>,
  ): Thenable<T>

  /**
   * Encodes client-side values to be sent to the server.
   * Part of the Server Actions system that:
   * - Serializes client-side arguments
   * - Handles File objects and FormData
   * - Ensures secure server-client communication
   * Used when invoking Server Actions from Client Components.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#server-actions
   */
  export function encodeReply(
    // https://github.com/facebook/react/blob/dfaed5582550f11b27aae967a8e7084202dd2d90/packages/react-client/src/ReactFlightReplyClient.js#L65
    value: ReactServerValue,
  ): Promise<string | URLSearchParams | FormData>
}

declare module 'react-server-dom-webpack/server' {
  import type { Writable } from 'stream'
  import type { Busboy } from 'busboy'

  // It's difficult to know the true type of `ServerManifest`.
  // A lot of react's source files are stubs that are replaced at build time.
  // Going off this reference for now: https://github.com/facebook/react/blob/b09e102ff1e2aaaf5eb6585b04609ac7ff54a5c8/packages/react-server-dom-webpack/src/ReactFlightClientConfigBundlerWebpack.js#L40
  type ServerManifest = {
    [id: string]: ImportManifestEntry
  }

  /**
   * Decodes client replies in RSC server actions.
   * Part of the Server Actions system that:
   * - Deserializes client-side arguments
   * - Validates the data format
   * - Makes arguments available to server action functions
   * Used when receiving data from client-side Server Action calls.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#server-actions
   */
  export function decodeReply<T>(
    body: string | FormData,
    webpackMap?: ServerManifest,
  ): Promise<T>

  /**
   * Decodes multipart form data replies in RSC server actions.
   * Specialized version of decodeReply that:
   * - Handles multipart/form-data format
   * - Processes file uploads and form submissions
   * - Uses busboy for efficient streaming processing
   * Essential for Server Actions that involve file uploads.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#server-actions
   */
  export function decodeReplyFromBusboy<T>(
    busboyStream: Busboy,
    webpackMap?: ServerManifest,
  ): Promise<T>

  type PipeableStream = {
    abort(reason: any): void
    pipe<T extends Writable>(destination: T): T
  }

  /**
   * Renders React Server Components to a pipeable stream format.
   * Core RSC rendering function that:
   * - Renders Server Components to React Flight format
   * - Handles async data fetching during render
   * - Streams output progressively to the client
   * - Includes Client Component references and props
   * Used for the initial server-side rendering of RSC trees.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#rendertopipeablestream-from-react-server-dom-webpackserver
   */
  export function renderToPipeableStream(
    model: ReactClientValue,
    webpackMap: ClientManifest,
  ): PipeableStream
}

declare module 'react-server-dom-webpack/client.browser' {
  /**
   * Creates a server action reference on the client.
   * Enables Client Components to call Server Actions by:
   * - Creating a client-side proxy for the server function
   * - Handling argument serialization
   * - Managing the network request to the server
   * - Processing the server's response
   * Key part of the Server Actions system for client-server interaction.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#server-actions
   */
  export function createServerReference<A, T>(id: string, callServer: (id: string, args: A) => Promise<T>)
}

declare module 'react-server-dom-webpack/client.edge' {
  /**
   * Creates a Promise-like structure from a ReadableStream of RSC data.
   * Core client-side RSC processing function that:
   * - Reads the React Flight format stream
   * - Reconstructs the React element tree
   * - Manages Client Component loading
   * - Handles progressive streaming updates
   * Used in conjunction with server-side rendering functions to process RSC output.
   * @see https://timtech.blog/posts/react-server-components-rsc-no-framework/#createfromreadablestream-from-react-server-dom-webpackclient
   */
  export function createFromReadableStream<T>(stream: ReadableStream, webpackMap: ClientManifest): Thenable<T>
}
