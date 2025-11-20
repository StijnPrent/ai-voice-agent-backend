import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { SchedulingController } from "../controllers/SchedulingController";

const router = Router();
const controller = new SchedulingController();

// Appointment Types
router.get("/appointment-types", authenticateToken, controller.getAppointmentTypes.bind(controller));
router.post("/appointment-types", authenticateToken, controller.addAppointmentType.bind(controller));
router.put("/appointment-types", authenticateToken, controller.updateAppointmentType.bind(controller));
router.delete("/appointment-types/:id", authenticateToken, controller.deleteAppointmentType.bind(controller));

// Appointment Categories
router.get("/appointment-categories", authenticateToken, controller.getAppointmentCategories.bind(controller));
router.post("/appointment-categories", authenticateToken, controller.addAppointmentCategory.bind(controller));
router.put("/appointment-categories/:id", authenticateToken, controller.updateAppointmentCategory.bind(controller));
router.delete("/appointment-categories/:id", authenticateToken, controller.deleteAppointmentCategory.bind(controller));

// Staff Members
router.get("/staff-members", authenticateToken, controller.getStaffMembers.bind(controller));
router.post("/staff-members", authenticateToken, controller.addStaffMember.bind(controller));
router.put("/staff-members", authenticateToken, controller.updateStaffMember.bind(controller));
router.delete("/staff-members/:id", authenticateToken, controller.deleteStaffMember.bind(controller));

export default router;
