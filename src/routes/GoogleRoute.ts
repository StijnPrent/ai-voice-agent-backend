// src/routes/GoogleCalendarRoute.ts
import { Router } from "express";
import { GoogleController } from "../controllers/GoogleController";
import {authenticateToken} from "../middleware/auth";

const router = Router();
const controller = new GoogleController();

// Step 1: Redirect user to Google OAuth consent screen
// GET /api/oauth2/google/url?companyId=<64-char-id>
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

router.delete(
    "/disconnect",
    authenticateToken,
    controller.disconnect.bind(controller)
);

export default router;
