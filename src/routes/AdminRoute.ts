import { Router } from "express";
import { AdminController } from "../controllers/AdminController";
import { authenticateAdminToken } from "../middleware/adminAuth";

const router = Router();
const controller = new AdminController();

// Authentication
router.post("/auth/login", controller.login.bind(controller));

// Dashboard
router.get(
    "/dashboard/metrics",
    authenticateAdminToken,
    controller.getDashboardMetrics.bind(controller)
);
router.get(
    "/dashboard/revenue-history",
    authenticateAdminToken,
    controller.getRevenueHistory.bind(controller)
);
router.get(
    "/dashboard/recent-invoices",
    authenticateAdminToken,
    controller.getRecentInvoices.bind(controller)
);

// Clients
router.get("/clients", authenticateAdminToken, controller.getClients.bind(controller));
router.get(
    "/clients/:id",
    authenticateAdminToken,
    controller.getClient.bind(controller)
);
router.get(
    "/clients/:id/call-history",
    authenticateAdminToken,
    controller.getClientCallHistory.bind(controller)
);
router.get(
    "/clients/:id/recent-calls",
    authenticateAdminToken,
    controller.getClientRecentCalls.bind(controller)
);
router.put(
    "/clients/:id",
    authenticateAdminToken,
    controller.updateClient.bind(controller)
);
router.patch(
    "/clients/:id/twilio-number",
    authenticateAdminToken,
    controller.updateClientTwilioNumber.bind(controller)
);

// Invoices
router.get(
    "/invoices",
    authenticateAdminToken,
    controller.getInvoices.bind(controller)
);

// Settings
router.get(
    "/settings/pricing",
    authenticateAdminToken,
    controller.getPricing.bind(controller)
);
router.put(
    "/settings/pricing",
    authenticateAdminToken,
    controller.updatePricing.bind(controller)
);

export default router;
