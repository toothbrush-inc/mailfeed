import { ClientRegistry } from "@boundaryml/baml"
import type { ResolvedSettings } from "@/lib/settings"

export function buildClientRegistry(settings: ResolvedSettings): ClientRegistry {
  const cr = new ClientRegistry()
  cr.setPrimary(settings.ai.bamlClient)
  return cr
}
