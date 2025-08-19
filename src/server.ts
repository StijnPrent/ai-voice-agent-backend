import "reflect-metadata";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { container } from "tsyringe";
import voiceRoutes from "./routes/VoiceRoute";
import companyRoutes from "./routes/CompanyRoute";
import voiceSettingsRoutes from "./routes/VoiceSettingsRoute";
import { WebSocketServer } from "./websocket/WebSocketServer";
import "./container";
import googleRoute from "./routes/GoogleRoute";
import outlookRoute from "./routes/OutlookRoute";
import integrationRoute from "./routes/IntegrationRoute";
import updateRoute from "./routes/UpdateRoute";
import schedulingRoute from "./routes/SchedulingRoute";

const app = express();

app.use(cors({
    origin: process.env.FRONTEND_URL,
    methods: ["GET","POST","PUT","DELETE","OPTIONS"],
    allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/voice", voiceRoutes);
app.use('/company', companyRoutes);
app.use('/voice-settings', voiceSettingsRoutes);
app.use("/google", googleRoute)
app.use("/outlook", outlookRoute)
app.use("/integrations", integrationRoute)
app.use("/updates", updateRoute)
app.use("/scheduling", schedulingRoute)

const server = createServer(app);
const webSocketServer = container.resolve(WebSocketServer);
webSocketServer.start();

// Luister naar het 'upgrade' event voor WebSockets
server.on('upgrade', (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head);
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));