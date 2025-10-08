// src/routes/CallRoute.ts
import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { CallController } from "../controllers/CallController";

const router = Router();
const controller = new CallController();

router.get("/phone-numbers", authenticateToken, controller.getCallerNumbers.bind(controller));
router.get("/by-phone-number", authenticateToken, controller.getCallsByPhoneNumber.bind(controller));
router.get("/:callSid", authenticateToken, controller.getCallDetails.bind(controller));

export default router;
