import { test, expect, describe } from "bun:test"
import { createProvider } from "../src/cloud/factory"
import { AwsStorage } from "../src/cloud/aws"
import { GcpStorage } from "../src/cloud/gcp"
import { AzureStorage } from "../src/cloud/azure"

describe("createProvider", () => {
  test("creates AwsStorage for aws provider", () => {
    const provider = createProvider({ provider: "aws", bucket: "my-bucket" })
    expect(provider).toBeInstanceOf(AwsStorage)
    expect(provider.name).toBe("aws")
  })

  test("creates GcpStorage for gcp provider", () => {
    const provider = createProvider({ provider: "gcp", bucket: "my-bucket" })
    expect(provider).toBeInstanceOf(GcpStorage)
    expect(provider.name).toBe("gcp")
  })

  test("creates AzureStorage for azure provider", () => {
    const provider = createProvider({
      provider: "azure",
      account: "myaccount",
      container: "mycontainer",
    })
    expect(provider).toBeInstanceOf(AzureStorage)
    expect(provider.name).toBe("azure")
  })

  test("throws when aws has no bucket", () => {
    expect(() => createProvider({ provider: "aws" })).toThrow("AWS provider requires a bucket")
  })

  test("throws when gcp has no bucket", () => {
    expect(() => createProvider({ provider: "gcp" })).toThrow("GCP provider requires a bucket")
  })

  test("throws when azure has no account", () => {
    expect(() =>
      createProvider({ provider: "azure", container: "c" }),
    ).toThrow("Azure provider requires account and container")
  })

  test("throws when azure has no container", () => {
    expect(() =>
      createProvider({ provider: "azure", account: "a" }),
    ).toThrow("Azure provider requires account and container")
  })

  test("throws for unknown provider", () => {
    expect(() =>
      createProvider({ provider: "unknown" as any }),
    ).toThrow()
  })
})
