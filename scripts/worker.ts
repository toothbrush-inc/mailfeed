import "dotenv/config"
import { runWorkerLoop } from "@/lib/scheduled-sync"

const once = process.argv.includes("--once")

runWorkerLoop({ once })
  .then(() => {
    if (once) process.exit(0)
  })
  .catch((error) => {
    console.error("[Worker] fatal", error)
    process.exit(1)
  })
