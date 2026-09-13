const express = require("express");
const { getPublicTurnstileConfig } = require("../services/turnstileVerification");

const router = express.Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  return res.json({ turnstile: getPublicTurnstileConfig() });
});

module.exports = router;
