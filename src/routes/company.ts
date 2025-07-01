import { Router } from "express";
import { CompanyController } from "../controllers/CompanyController";

const router = Router();
const controller = new CompanyController();
router.post("/", controller.createCompany.bind(controller));
router.get("/number/:id", controller.getCompanyByNumber.bind(controller));
router.get("/info/:companyId", controller.getInfo.bind(controller))
router.post("/info", controller.addInfo.bind(controller));
router.delete("/info/:infoId", controller.removeInfo.bind(controller));
export default router;