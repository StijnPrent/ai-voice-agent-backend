// src/routes/EmailRoute.ts
import { Router } from "express";
import { CompanyController } from "../controllers/CompanyController";

const router = Router();
const controller = new CompanyController();

router.post("/verification/resend", controller.resendVerificationEmail.bind(controller));
router.post("/verification/confirm", controller.confirmVerification.bind(controller));
router.get("/verification/confirm", controller.confirmVerificationAndRedirect.bind(controller));
router.post("/verification/send", controller.triggerVerificationEmail.bind(controller));
router.post("/password/request-reset", controller.requestPasswordReset.bind(controller));
router.post("/password/reset", controller.resetPassword.bind(controller));
router.post("/early-access", controller.submitEarlyAccess.bind(controller));
router.get("/early-access/unsubscribe", controller.unsubscribeEarlyAccess.bind(controller));

export default router;
