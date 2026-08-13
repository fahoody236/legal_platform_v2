import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import casesRouter from "./cases";
import documentsRouter from "./documents";
import billingRouter from "./billing";
import tasksRouter from "./tasks";
import contractsRouter from "./contracts";
import aiDraftsRouter from "./ai_drafts";
import dashboardRouter from "./dashboard";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(casesRouter);
router.use(documentsRouter);
router.use(billingRouter);
router.use(tasksRouter);
router.use(contractsRouter);
router.use(aiDraftsRouter);
router.use(dashboardRouter);
router.use(chatRouter);

export default router;
