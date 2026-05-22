import { Router } from "express";

const router = Router();

router.get("/room", (_req, res) => {
  res.json({
    name: "Voice Room",
    participantCount: 0,
    participants: [],
  });
});

router.post("/room/join", (req, res) => {
  const { name } = req.body as { name?: string; isOwner?: boolean };
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  res.json({
    success: true,
    participantId: Math.random().toString(36).slice(2),
    isOwner: false,
  });
});

export default router;
