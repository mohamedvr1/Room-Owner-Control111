import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomRouter from "./room";
import bordersRouter from "./borders";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roomRouter);
router.use(bordersRouter);

export default router;
