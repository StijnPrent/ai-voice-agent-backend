import "reflect-metadata";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { container } from "tsyringe";
import voiceRoutes from "./routes/VoiceRoute";
import { VoiceSessionManager } from "./business/services/VoiceSessionManager";
import companyRoutes from "./routes/CompanyRoute";
import emailRoute from "./routes/EmailRoute";
import voiceSettingsRoutes from "./routes/VoiceSettingsRoute";
import { WebSocketServer } from "./websocket/WebSocketServer";
import "./container";
import googleRoute from "./routes/GoogleRoute";
import outlookRoute from "./routes/OutlookRoute";
import integrationRoute from "./routes/IntegrationRoute";
import updateRoute from "./routes/UpdateRoute";
import schedulingRoute from "./routes/SchedulingRoute";
import callRoute from "./routes/CallRoute";
import analyticsRoute from "./routes/AnalyticsRoute";
import { VapiRoute } from "./routes/VapiRoute";
import InternalVapiRoute from "./routes/InternalVapiRoute";
import adminRoute from "./routes/AdminRoute";
import salesPipelineRoute from "./routes/SalesPipelineRoute";
import { mountLeadsMcpServer } from "./mcp/server";
import leadAgentRoute from "./routes/LeadAgentRoute";
import shopifyRoute from "./routes/ShopifyRoute";
import wooCommerceRoute from "./routes/WooCommerceRoute";
import commerceRoute from "./routes/CommerceRoute";
import billingRoute from "./routes/BillingRoute";

const app = express();

const voiceSessionManager = container.resolve(VoiceSessionManager);
const vapiRoute = container.resolve(VapiRoute);
const internalVapiRoute = container.resolve(InternalVapiRoute);

app.set("trust proxy", true);

const allowedOrigins = [
    "http://localhost:3000", // local dev
    "http://localhost:3001",
    "https://app.callingbird.nl",
    "https://admin.callingbird.nl",
    "https://callingbird.nl",
    /\.callingbird\.nl$/, // any subdomain *.callingbird.nl
];

app.use(
  cors({
      origin: function (origin, callback) {
          if (!origin) return callback(null, true); // allow curl / postman etc.

          // Check if origin is an exact match or matches regex (for wildcard)
          if (
            allowedOrigins.some((o) =>
              typeof o === "string" ? o === origin : o.test(origin)
            )
          ) {
              callback(null, true);
          } else {
              console.warn("❌ Blocked CORS origin:", origin);
              callback(new Error("Not allowed by CORS"));
          }
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Internal-Api-Key"],
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
// Serve static assets (e.g., email footer images) from /public
app.use(express.static("public"));
app.use("/voice", voiceRoutes(voiceSessionManager));
app.use('/company', companyRoutes);
app.use("/email", emailRoute);
app.use('/voice-settings', voiceSettingsRoutes);
app.use("/google", googleRoute);
app.use("/outlook", outlookRoute);
app.use("/integrations", integrationRoute);
app.use("/updates", updateRoute);
app.use("/scheduling", schedulingRoute);
app.use("/calls", callRoute);
app.use("/analytics", analyticsRoute);
app.use("/vapi", vapiRoute.getRouter());
app.use("/internal/vapi", internalVapiRoute.getRouter());
app.use("/admin", adminRoute);
app.use("/api", salesPipelineRoute);
app.use("/agents", leadAgentRoute);
app.use("/shopify", shopifyRoute);
app.use("/woocommerce", wooCommerceRoute);
app.use("/commerce", commerceRoute);
app.use("/billing", billingRoute);
mountLeadsMcpServer(app);

const server = createServer(app);
const webSocketServer = container.resolve(WebSocketServer);
webSocketServer.start();

// Luister naar het 'upgrade' event voor WebSockets
server.on('upgrade', (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head);
});

const PORT = process.env.PORT || 3002;

//health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send(`${PORT}`);
});
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
