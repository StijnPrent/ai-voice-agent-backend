// src/routes/CompanyRoute.ts
import { Router } from "express";
import { CompanyController } from "../controllers/CompanyController";
import { authenticateToken } from "../middleware/auth";

const router = Router();
const controller = new CompanyController();

router.post("/login", controller.login.bind(controller));
router.post("/", controller.createCompany.bind(controller));

router.get("/number/:id", authenticateToken, controller.getCompanyByNumber.bind(controller));
router.get("/info", authenticateToken, controller.getInfo.bind(controller));
router.post("/info", authenticateToken, controller.addInfo.bind(controller));
router.delete("/info/:infoId", authenticateToken, controller.removeInfo.bind(controller));

export default router;