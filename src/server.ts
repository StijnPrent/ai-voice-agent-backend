import "reflect-metadata";
import express from "express";
import { createServer } from "http";
import { container } from "tsyringe";
import voiceRoutes from "./routes/voice";
import companyRoutes from "./routes/company";
import { WebSocketServer } from "./websocket/WebSocketServer";
import "./container";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/voice", voiceRoutes);
app.use('/company', companyRoutes);

const server = createServer(app);
const webSocketServer = container.resolve(WebSocketServer);
webSocketServer.start(server);

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
