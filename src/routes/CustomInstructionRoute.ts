import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { CustomInstructionController } from "../controllers/CustomInstructionController";

const router = Router();
const controller = new CustomInstructionController();

router.get("/", authenticateToken, controller.list.bind(controller));
router.post("/", authenticateToken, controller.create.bind(controller));
router.delete("/:id", authenticateToken, controller.remove.bind(controller));

export default router;
