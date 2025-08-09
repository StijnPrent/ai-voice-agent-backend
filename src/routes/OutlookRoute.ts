
// src/routes/OutlookRoute.ts
import { Router } from "express";
import { OutlookController } from "../controllers/OutlookController";

const router = Router();
const controller = new OutlookController();

// Step 1: Redirect user to Outlook OAuth consent screen
// GET /api/oauth2/outlook/url?companyId=<64-char-id>
router.get(
    "/oauth2/url",
    controller.getAuthUrl.bind(controller)
);
router.get(
    "/oauth2/callback",
    controller.handleCallback.bind(controller)
);
router.post(
    "/schedule",
    controller.scheduleEvent.bind(controller)
);

export default router;
