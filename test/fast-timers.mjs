// Preloaded by server.test.mjs: the once-a-minute push check runs every 200 ms instead.
const { setInterval: realSetInterval } = globalThis;
globalThis.setInterval = (callback, ms, ...args) => realSetInterval(callback, ms >= 60000 ? 200 : ms, ...args);
