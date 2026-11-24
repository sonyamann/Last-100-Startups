// The page lives at studio.sonyasupposedly.com/startups. In development,
// /startups/board.json is served straight from the pipeline's output.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const boardPath = fileURLToPath(new URL("../data/board.json", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/startups/",
  // The merge API and permalink pages come from the Node server (npm run
  // serve, port 3003).
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/startups/api": "http://localhost:3003",
      "/startups/m/": "http://localhost:3003",
    },
  },
  build: { outDir: fileURLToPath(new URL("../dist/web", import.meta.url)), emptyOutDir: true },
  plugins: [
    {
      name: "board-json",
      configureServer(server) {
        server.middlewares.use("/startups/board.json", (_req, res) => {
          if (!existsSync(boardPath)) {
            res.statusCode = 404;
            return res.end("Run the pipeline first: npm run pipeline");
          }
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(readFileSync(boardPath));
        });
      },
    },
  ],
});
