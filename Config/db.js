import { configDotenv } from "dotenv";
import mongoose from "mongoose";

configDotenv()

const connectDB = async () => {
  const mongoUri = `${process.env.MONGODB_URI}`;
  try {
    await mongoose.connect(mongoUri);
    console.log("mongodb successfully connected");
  } catch (error) {
    console.error("mongodb connection failed:", error);
    throw Error(error);
  }
};

export default connectDB;