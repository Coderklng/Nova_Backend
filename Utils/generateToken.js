import { configDotenv } from "dotenv";
import jwt from "jsonwebtoken";

configDotenv();

export const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined in environment variables");
  }

  try {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
      expiresIn: "7d",
      algorithm: "HS256",
    });
  } catch (error) {
    console.error("JWT generation failed:", error.message);
    throw error;
  }
};