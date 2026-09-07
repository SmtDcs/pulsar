import { buildServer } from "./server.js";
import { config } from "./config.js";

const app = buildServer();

app.listen({ port: config.port, host: "0.0.0.0" }).then((url) => {
  console.log(`Pulsar sequencer listening on ${url}`);
  console.log(`  RPC:              ${config.rpcUrl}`);
  console.log(`  SessionRegistry:  ${config.sessionRegistryId}`);
  console.log(`  SlowTicTacToe:    ${config.slowTicTacToeId || "(not set — L1 mode disabled)"}`);
}).catch((err) => {
  console.error("failed to start:", err);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}
