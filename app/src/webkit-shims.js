/**
 * Standard JS that pdf.js 6 uses and WebKit has not shipped yet.
 *
 * V8 has all of it, so the app works in Chrome and breaks in the Tauri webview
 * on macOS. Both gaps below were found by running the real pipeline inside the
 * real WKWebView, not by reading release notes.
 *
 * Loaded twice: once by main.tsx for the page, and once prepended to the copied
 * pdf.js worker bundle by vite.config.ts, because a worker shares no globals
 * with the page and pdf.js needs both. Keep this plain JS with no imports so
 * prepending it to an ES module stays valid.
 */

/*
 * 1. TC39 "upsert": Map/WeakMap getOrInsert and getOrInsertComputed.
 * pdf.js calls these 67 times. Without them: "getOrInsertComputed is not a function".
 */
for (const Ctor of [Map, WeakMap]) {
  const proto = Ctor.prototype;

  if (!proto.getOrInsert) {
    Object.defineProperty(proto, "getOrInsert", {
      configurable: true,
      writable: true,
      value: function (key, value) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
    });
  }

  if (!proto.getOrInsertComputed) {
    Object.defineProperty(proto, "getOrInsertComputed", {
      configurable: true,
      writable: true,
      value: function (key, callbackfn) {
        if (this.has(key)) return this.get(key);
        const value = callbackfn(key);
        this.set(key, value);
        return value;
      },
    });
  }
}

/*
 * 2. Async iteration over a ReadableStream, ie "for await (const x of stream)".
 * page.getTextContent() does exactly that, and it runs for every PDF page, so
 * without this every PDF fails with "undefined is not a function (near
 * '...value of readableStream...')" and no document is ever read.
 * Mirrors the WHATWG default asyncIterator: read until done, and cancel the
 * stream when the loop exits early unless the caller opted out.
 */
if (typeof ReadableStream !== "undefined" && !ReadableStream.prototype[Symbol.asyncIterator]) {
  const asyncIterator = function ({ preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      next() {
        return reader.read();
      },
      async return(value) {
        if (preventCancel) {
          reader.releaseLock();
        } else {
          const cancelled = reader.cancel(value);
          reader.releaseLock();
          await cancelled;
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };

  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: asyncIterator,
  });
  Object.defineProperty(ReadableStream.prototype, "values", {
    configurable: true,
    writable: true,
    value: asyncIterator,
  });
}
