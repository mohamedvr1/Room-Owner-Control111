import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomRouter from "./room";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roomRouter);

export default router;
