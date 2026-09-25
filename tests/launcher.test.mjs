import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
test("portable launcher serves build, protects source paths and rejects writes", async () => {
  const child = spawn(process.execPath, ["scripts/start.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, SINTECH_NO_OPEN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Launcher did not start")),
        8000,
      );
      child.stdout.on("data", (d) => {
        if (d.toString().includes("running at")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error("Launcher exited: " + code));
      });
    });
    const get = (path, method = "GET") =>
      new Promise((resolve, reject) => {
        const r = http.request(
          { host: "127.0.0.1", port: 4173, path, method },
          (res) => {
            let body = "";
            res.on("data", (d) => (body += d));
            res.on("end", () =>
              resolve({ status: res.statusCode, headers: res.headers, body }),
            );
          },
        );
        r.on("error", reject);
        r.end();
      });
    const page = await get("/");
    assert.equal(page.status, 200);
    assert.match(page.body, /SINTECH ERP/);
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    const asset = page.body.match(/src="([^"]+\.js)"/)[1].replace(/^\.\//, "/");
    assert.equal((await get(asset)).status, 200);
    assert.equal((await get("/%2e%2e%2fpackage.json")).status, 403);
    assert.equal((await get("/.env.local")).status, 404);
    assert.equal((await get("/", "POST")).status, 405);
  } finally {
    child.kill();
  }
});
