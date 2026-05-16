import { CloudStorage } from "./provider"
import { RemoteConfig } from "./config"
import { AwsStorage } from "./aws"
import { GcpStorage } from "./gcp"
import { AzureStorage } from "./azure"

export function createProvider(config: RemoteConfig): CloudStorage {
  switch (config.provider) {
    case "aws":
      if (!config.bucket) throw new Error("AWS provider requires a bucket")
      return new AwsStorage({ bucket: config.bucket, region: config.region })
    case "gcp":
      if (!config.bucket) throw new Error("GCP provider requires a bucket")
      return new GcpStorage({ bucket: config.bucket })
    case "azure":
      if (!config.account || !config.container)
        throw new Error("Azure provider requires account and container")
      return new AzureStorage({ account: config.account, container: config.container })
    default:
      throw new Error(`Unknown provider: ${(config as RemoteConfig).provider}`)
  }
}
