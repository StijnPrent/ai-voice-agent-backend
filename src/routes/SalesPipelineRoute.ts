import { Router } from "express";
import { SalesPipelineController } from "../controllers/SalesPipelineController";
import { authenticateAdminToken } from "../middleware/adminAuth";

const router = Router();
const controller = new SalesPipelineController();

router.use(authenticateAdminToken);

// Phases
router.get("/phases", controller.listPhases.bind(controller));
router.post("/phases", controller.createPhase.bind(controller));
router.patch("/phases/:id", controller.updatePhase.bind(controller));
router.delete("/phases/:id", controller.deletePhase.bind(controller));

// Companies
router.get("/companies", controller.listCompanies.bind(controller));
router.get(
    "/companies/not-interested",
    controller.listNotInterestedCompanies.bind(controller)
);
router.get(
    "/companies/not-interested/reasons/summary",
    controller.getNotInterestedReasonSummary.bind(controller)
);
router.post("/companies", controller.createCompany.bind(controller));
router.get("/companies/:id", controller.getCompany.bind(controller));
router.patch(
    "/companies/:id/not-interested",
    controller.markNotInterested.bind(controller)
);
router.patch("/companies/:id", controller.updateCompany.bind(controller));
router.delete("/companies/:id", controller.deleteCompany.bind(controller));

// Not interested reasons
router.get("/not-interested/reasons", controller.listReasons.bind(controller));
router.post("/not-interested/reasons", controller.createReason.bind(controller));
router.patch("/not-interested/reasons/:id", controller.updateReason.bind(controller));
router.delete("/not-interested/reasons/:id", controller.deleteReason.bind(controller));

// Company Notes
router.post("/companies/:id/notes", controller.addNote.bind(controller));
router.patch("/companies/:id/notes/:noteId", controller.updateNote.bind(controller));
router.delete("/companies/:id/notes/:noteId", controller.deleteNote.bind(controller));

export default router;
