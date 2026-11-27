import User from "../Models/userModel.js";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const FREE_DAILY_LIMIT = 20; // Apne Groq/Gemini quota ke hisaab se adjust kar lo

export const checkChatSession = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Admin ya paid tiers ke liye koi 24-hour lock nahi
    if (user.role === "admin" || user.subscriptionTier !== "free") {
      return next();
    }

    const now = new Date();

    // Agar 24 hours poore ho chuke hain, toh session reset karo
    if (user.sessionResetAt && now >= user.sessionResetAt) {
      user.dailyChatCount = 0;
      user.sessionResetAt = null;
    }

    // Agar limit hit ho chuki hai aur 24 hours abhi baki hain
    if (user.dailyChatCount >= FREE_DAILY_LIMIT) {
      const remainingMs = user.sessionResetAt - now;
      const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));

      return res.status(429).json({
        success: false,
        message: `Daily free session limit poori ho gayi hai. Agla session ${remainingHours} ghante baad chalu hoga.`,
        resetAt: user.sessionResetAt,
      });
    }

    // Pehli chat par 24-hour timer start karo aur count badhao
    if (!user.sessionResetAt) {
      user.sessionResetAt = new Date(now.getTime() + TWENTY_FOUR_HOURS);
    }

    user.dailyChatCount += 1;
    await user.save();

    next();
  } catch (error) {
    res.status(500).json({ message: "Session check failed", error: error.message });
  }
};
