import { Router } from "express";
import { BillingController } from "../controllers/BillingController";
import { authenticateAdminToken } from "../middleware/adminAuth";

const router = Router();
const controller = new BillingController();

// Landing page checkout -> create company + mandate + trial
router.post("/landing/signup", controller.landingSignup.bind(controller));

// Admin: run billing + fetch invoice detail
router.post(
    "/admin/run",
    authenticateAdminToken,
    controller.runMonthlyBilling.bind(controller)
);

router.get(
    "/admin/invoices/:invoiceNumber",
    authenticateAdminToken,
    controller.getInvoice.bind(controller)
);

// Mollie webhook
router.post("/webhooks/mollie", controller.mollieWebhook.bind(controller));

export default router;
