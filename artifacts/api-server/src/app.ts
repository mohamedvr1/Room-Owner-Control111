import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import router from "./routes";
import { logger } from "./lib/logger";
import { setupSocketIO } from "./socket";

const app: Express = express();
export const httpServer = createServer(app);

export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/api/socket.io",
});

setupSocketIO(io);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
