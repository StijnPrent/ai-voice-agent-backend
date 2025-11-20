import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { PhorestController } from "../controllers/PhorestController";

const router = Router();
const controller = new PhorestController();

router.post("/connect", authenticateToken, controller.connect.bind(controller));
router.delete("/disconnect", authenticateToken, controller.disconnect.bind(controller));
router.get("/appointments", authenticateToken, controller.getAppointments.bind(controller));
router.post("/appointments/confirm", authenticateToken, controller.confirmAppointments.bind(controller));
router.post("/appointments/cancel", authenticateToken, controller.cancelAppointments.bind(controller));
router.get("/staff", authenticateToken, controller.listStaff.bind(controller));
router.patch("/staff/:staffMemberId", authenticateToken, controller.attachStaffMember.bind(controller));

export default router;
