import "reflect-metadata";
import express from "express";
import voiceRoutes from "./routes/voice";
import companyRoutes from "./routes/company";
import "./container";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/voice", voiceRoutes);
app.use('/company', companyRoutes);

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));