// src/routes/CompanyRoute.ts
import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import {CompanyController} from "../controllers/CompanyController";

const router = Router();
const controller = new CompanyController();

// Authentication & Company creation
router.post("/register", controller.registerCompany.bind(controller));
router.post("/login", controller.login.bind(controller));

// Lookup by Twilio number
router.get(
    "/number/:twilioNumber",
    authenticateToken,
    controller.getCompanyByNumber.bind(controller)
);

// Company Info
router.get("/info", authenticateToken, controller.getInfo.bind(controller));
router.post("/info", authenticateToken, controller.addInfo.bind(controller));
router.put("/info", authenticateToken, controller.updateInfo.bind(controller));
router.delete(
    "/info/:infoId",
    authenticateToken,
    controller.removeInfo.bind(controller)
);

// Company Details
router.get(
    "/details",
    authenticateToken,
    controller.getCompanyDetails.bind(controller)
);
router.put(
    "/details",
    authenticateToken,
    controller.updateCompanyDetails.bind(controller)
);

// Company Contacts
router.get(
    "/contact",
    authenticateToken,
    controller.getCompanyContact.bind(controller)
);
router.put(
    "/contact",
    authenticateToken,
    controller.updateCompanyContact.bind(controller)
);

// Company Hours
router.get(
    "/hours",
    authenticateToken,
    controller.getCompanyHours.bind(controller)
);
router.post(
    "/hours",
    authenticateToken,
    controller.addCompanyHour.bind(controller)
);
router.put(
    "/hours/:id",
    authenticateToken,
    controller.updateCompanyHour.bind(controller)
);
router.delete(
    "/hours/:id",
    authenticateToken,
    controller.deleteCompanyHour.bind(controller)
);

export default router;
