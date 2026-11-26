import mongoose from "mongoose";

// 1. Local MongoDB connection "Nova" database)
// 2. User Schema Definition
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      unique: true,
      match: [/^\S+@\S+\.\S+$/, "Please Enter Valid Email"],
    },
    password: {
      type: String,
      required: true,
    },
    subscriptionTier: {
      type: String,
      enum: ["free", "startup", "enterprise"],
      default: "free",
    },
    role:{
       type:String,
       enum:["user","admin"],
       default:"user"
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
    },
  },
  {
    // Automatically adds createdAt and updatedAt fields
    timestamps: true,
  }
);

// 3. Model Creation & Export
const User = mongoose.model("User", userSchema);

export default User;