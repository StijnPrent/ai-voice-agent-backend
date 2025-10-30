import "reflect-metadata";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { container } from "tsyringe";
import voiceRoutes from "./routes/VoiceRoute";
import { VoiceSessionManager } from "./business/services/VoiceSessionManager";
import companyRoutes from "./routes/CompanyRoute";
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

const app = express();

const voiceSessionManager = container.resolve(VoiceSessionManager);
const vapiRoute = container.resolve(VapiRoute);
const internalVapiRoute = container.resolve(InternalVapiRoute);

app.set("trust proxy", true);

app.use(cors({
    origin: process.env.FRONTEND_URL,
    methods: ["GET","POST","PUT","DELETE","OPTIONS"],
    allowedHeaders: ["Content-Type","Authorization","X-Internal-Api-Key"]
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/voice", voiceRoutes(voiceSessionManager));
app.use('/company', companyRoutes);
app.use('/voice-settings', voiceSettingsRoutes);
app.use("/google", googleRoute)
app.use("/outlook", outlookRoute)
app.use("/integrations", integrationRoute)
app.use("/updates", updateRoute)
app.use("/scheduling", schedulingRoute)
app.use("/calls", callRoute)
app.use("/analytics", analyticsRoute)
app.use("/vapi", vapiRoute.getRouter())
app.use("/internal/vapi", internalVapiRoute.getRouter())

const server = createServer(app);
const webSocketServer = container.resolve(WebSocketServer);
webSocketServer.start();

// Luister naar het 'upgrade' event voor WebSockets
server.on('upgrade', (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head);
});

const PORT = process.env.PORT || 3003;

//health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send(`${PORT}`);
});
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));