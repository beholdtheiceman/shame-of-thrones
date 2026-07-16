// Hermes's built-in TextDecoder only supports UTF-8. h3-js (used by @sot/core for
// H3 hex/fief cells) ships Emscripten/WASM glue that runs `new TextDecoder('utf-16le')`
// at import time, which Hermes rejects ("Unknown encoding: utf-16le") and crashes the
// app on launch. Replace TextDecoder with a full polyfill BEFORE any other module loads.
// This file must be the very first import in index.ts.
import { TextDecoder } from "@zxing/text-encoding";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).TextDecoder = TextDecoder;
