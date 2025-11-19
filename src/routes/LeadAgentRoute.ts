import { Router } from "express";
import { LeadAgentController } from "../controllers/LeadAgentController";

const router = Router();
const controller = new LeadAgentController();

// POST /agents/lead { prompt: string }
router.post("/lead", controller.run.bind(controller));

export default router;
