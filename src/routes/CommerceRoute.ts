import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { CommerceController } from "../controllers/CommerceController";

const router = Router();
const controller = new CommerceController();

router.get("/stores", authenticateToken, controller.list);

export default router;
