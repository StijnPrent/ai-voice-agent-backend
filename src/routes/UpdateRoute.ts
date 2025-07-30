import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import {UpdateController} from "../controllers/UpdateController";

const router = Router();
const controller = new UpdateController();

router.get("/get", authenticateToken, controller.checkForUpdates.bind(controller));

export default router;
