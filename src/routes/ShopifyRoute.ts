import { Router } from "express";
import { ShopifyController } from "../controllers/ShopifyController";
import { authenticateToken } from "../middleware/auth";

const router = Router();
const controller = new ShopifyController();

router.post("/start", authenticateToken, controller.startAuth);
router.get("/callback", controller.handleCallback);
router.get("/status", authenticateToken, controller.status);
router.delete("/disconnect", authenticateToken, controller.disconnect);

export default router;
