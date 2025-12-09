import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { ProductKnowledgeController } from "../controllers/ProductKnowledgeController";

const router = Router();
const controller = new ProductKnowledgeController();

router.get("/", authenticateToken, controller.list.bind(controller));
router.get("/:id", authenticateToken, controller.getById.bind(controller));
router.post("/", authenticateToken, controller.create.bind(controller));
router.put("/:id", authenticateToken, controller.update.bind(controller));
router.post("/ingest", authenticateToken, controller.ingest.bind(controller));

export default router;
