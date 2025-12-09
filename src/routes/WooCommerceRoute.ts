import { Router } from "express";
import { WooCommerceController } from "../controllers/WooCommerceController";
import { authenticateToken } from "../middleware/auth";

const router = Router();
const controller = new WooCommerceController();

router.post("/connect", authenticateToken, controller.connect);
router.get("/status", authenticateToken, controller.status);
router.delete("/disconnect", authenticateToken, controller.disconnect);

export default router;
