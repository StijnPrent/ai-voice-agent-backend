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

router.get(
    "/calendars",
    authenticateToken,
    controller.listCalendars.bind(controller)
);

router.post(
    "/availability",
  (req, res) => {
    res.json({
      availability: {
        operatingWindow: {
          start: "2024-01-08T09:00:00.000Z",
          end: "2024-01-08T17:00:00.000Z",
        },
        busy: [
          {
            start: "2024-01-08T11:00:00.000Z",
            end: "2024-01-08T11:45:00.000Z",
          },
        ],
      },
      availableRanges: [
        {
          start: "2024-01-08T09:00:00.000Z",
          end: "2024-01-08T11:00:00.000Z",
          durationMinutes: 120,
        },
        {
          start: "2024-01-08T11:45:00.000Z",
          end: "2024-01-08T17:00:00.000Z",
          durationMinutes: 315,
        },
      ],
    });
  }
    // controller.checkAvailability.bind(controller)
);

router.post(
    "/cancel",
    controller.cancelEvent.bind(controller)
);

router.delete(
    "/disconnect",
    authenticateToken,
    controller.disconnect.bind(controller)
);

export default router;
