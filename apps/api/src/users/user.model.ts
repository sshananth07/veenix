import { Schema, model } from "mongoose";

const userSchema = new Schema(
  {
    authSubject: { type: String, required: true, unique: true },
    email: { type: String, required: true, lowercase: true, index: true },
    name: { type: String, default: "" },
    platformRole: { type: String, enum: ["superadmin", null], default: null },
  },
  { collection: "app_users", timestamps: true },
);
export const UserModel = model("AppUser", userSchema);
