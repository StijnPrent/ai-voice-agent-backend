import axios from "axios";
import { ShopifyService } from "../src/business/services/ShopifyService";
import { ShopifyIntegrationModel } from "../src/business/models/ShopifyIntegrationModel";

jest.mock("axios");
jest.mock("../src/config/config", () => ({
  shopifyApiVersion: "2024-07",
  shopifyClientId: "id",
  shopifyClientSecret: "secret",
  shopifyRedirectUri: "https://cb",
  shopifyScopes: "read_products,read_orders",
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const buildRepo = (integration: ShopifyIntegrationModel | null) => ({
  getIntegration: jest.fn().mockResolvedValue(integration),
  upsertIntegration: jest.fn(),
  deleteIntegration: jest.fn(),
});

describe("ShopifyService", () => {
  beforeAll(() => {
    process.env.MASTER_KEY = process.env.MASTER_KEY || "0123456789abcdef0123456789abcdef";
  });

  it("returns best product match by name", async () => {
    const integration = new ShopifyIntegrationModel(
      BigInt(1),
      "store.myshopify.com",
      "encrypted",
      "iv",
      "tag",
      null,
      null,
      null
    );
    jest.spyOn(integration, "accessToken", "get").mockReturnValue("token");

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        products: [
          { id: 1, title: "Blue Pants" },
          { id: 2, title: "Red Shirt" },
        ],
      },
    });

    const repo = buildRepo(integration);
    const service = new ShopifyService(repo as any);
    const result = await service.getProductByName(BigInt(1), "red shirt");
    expect(result.id).toBe("2");
  });

  it("throws when multiple best matches", async () => {
    const integration = new ShopifyIntegrationModel(
      BigInt(1),
      "store.myshopify.com",
      "encrypted",
      "iv",
      "tag",
      null,
      null,
      null
    );
    jest.spyOn(integration, "accessToken", "get").mockReturnValue("token");

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        products: [
          { id: 1, title: "Blue Pants" },
          { id: 2, title: "Blue Pant" },
        ],
      },
    });

    const repo = buildRepo(integration);
    const service = new ShopifyService(repo as any);
    await expect(service.getProductByName(BigInt(1), "blue pants")).rejects.toThrow(
      /Multiple products/
    );
  });

  it("gets order status", async () => {
    const integration = new ShopifyIntegrationModel(
      BigInt(1),
      "store.myshopify.com",
      "encrypted",
      "iv",
      "tag",
      null,
      null,
      null
    );
    jest.spyOn(integration, "accessToken", "get").mockReturnValue("token");

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        order: {
          id: 42,
          fulfillment_status: "fulfilled",
        },
      },
    });

    const repo = buildRepo(integration);
    const service = new ShopifyService(repo as any);
    const result = await service.getOrderStatus(BigInt(1), 42);
    expect(result.status).toBe("fulfilled");
  });
});
