import axios from "axios";
import { WooCommerceService } from "../src/business/services/WooCommerceService";
import { WooCommerceIntegrationModel } from "../src/business/models/WooCommerceIntegrationModel";

jest.mock("axios");
jest.mock("../src/config/config", () => ({
  wooDefaultVersion: "wc/v3",
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const buildRepo = (integration: WooCommerceIntegrationModel | null) => ({
  getIntegration: jest.fn().mockResolvedValue(integration),
  upsertIntegration: jest.fn(),
  deleteIntegration: jest.fn(),
});

describe("WooCommerceService", () => {
  beforeAll(() => {
    process.env.MASTER_KEY = process.env.MASTER_KEY || "0123456789abcdef0123456789abcdef";
  });

  it("returns best product match by name", async () => {
    const integration = new WooCommerceIntegrationModel(
      BigInt(1),
      "https://store.example.com",
      "encrypted",
      "iv",
      "tag",
      "encrypted2",
      "iv2",
      "tag2",
      "wc/v3",
      null,
      null
    );
    jest.spyOn(integration, "consumerKey", "get").mockReturnValue("key");
    jest.spyOn(integration, "consumerSecret", "get").mockReturnValue("secret");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { id: 10, name: "Red Shirt" },
        { id: 11, name: "Blue Pants" },
      ],
    });

    const repo = buildRepo(integration);
    const service = new WooCommerceService(repo as any);
    const result = await service.getProductByName(BigInt(1), "red shirt");
    expect(result.id).toBe("10");
  });

  it("throws when no close match", async () => {
    const integration = new WooCommerceIntegrationModel(
      BigInt(1),
      "https://store.example.com",
      "encrypted",
      "iv",
      "tag",
      "encrypted2",
      "iv2",
      "tag2",
      "wc/v3",
      null,
      null
    );
    jest.spyOn(integration, "consumerKey", "get").mockReturnValue("key");
    jest.spyOn(integration, "consumerSecret", "get").mockReturnValue("secret");

    mockedAxios.get.mockResolvedValueOnce({
      data: [{ id: 10, name: "Completely Different" }],
    });

    const repo = buildRepo(integration);
    const service = new WooCommerceService(repo as any);
    await expect(service.getProductByName(BigInt(1), "red shirt")).rejects.toThrow(
      /No sufficiently close product/
    );
  });

  it("gets order status", async () => {
    const integration = new WooCommerceIntegrationModel(
      BigInt(1),
      "https://store.example.com",
      "encrypted",
      "iv",
      "tag",
      "encrypted2",
      "iv2",
      "tag2",
      "wc/v3",
      null,
      null
    );
    jest.spyOn(integration, "consumerKey", "get").mockReturnValue("key");
    jest.spyOn(integration, "consumerSecret", "get").mockReturnValue("secret");

    mockedAxios.get.mockResolvedValueOnce({
      data: { id: 55, status: "processing" },
    });

    const repo = buildRepo(integration);
    const service = new WooCommerceService(repo as any);
    const result = await service.getOrderStatus(BigInt(1), 55);
    expect(result.status).toBe("processing");
  });
});
