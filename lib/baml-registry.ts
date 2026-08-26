import { ClientRegistry } from "@boundaryml/baml"
import type { ResolvedSettings } from "@/lib/settings"
import { BAML_CLIENTS } from "@/lib/ai-provider"
import { keyNameForEnvVar, type AiKeys } from "@/lib/user-keys"

export function buildClientRegistry(settings: ResolvedSettings, aiKeys?: AiKeys): ClientRegistry {
  const cr = new ClientRegistry()
  if (aiKeys) {
    // Re-register each leaf client the user holds a key for; a registry
    // client shadows the baml_src client of the same name, so the user's
    // key applies whichever client is primary (and to leaves referenced by
    // the strategy clients). Without a user key the static client — and the
    // host's env key — stays in effect. Retry policies defined in baml_src
    // are not re-attachable here; an overridden client just loses retries.
    for (const client of BAML_CLIENTS) {
      if (!client.provider || !client.model) continue
      const keyName = keyNameForEnvVar(client.envVar)
      const userKey = keyName ? aiKeys[keyName] : undefined
      if (userKey) {
        cr.addLlmClient(client.name, client.provider, { model: client.model, api_key: userKey })
      }
    }
  }
  cr.setPrimary(settings.ai.bamlClient)
  return cr
}
