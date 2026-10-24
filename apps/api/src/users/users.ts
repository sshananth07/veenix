import type { CurrentUser } from "../common/context";
import type { Identity } from "../auth/identity";
import { UserModel } from "./user.model";

/** Our user record for a verified identity, created the first time we see it. No write unless something changed. */
export async function userFor(identity: Identity): Promise<CurrentUser> {
  const email = identity.email.toLowerCase();
  let u = await UserModel.findOne({ authSubject: identity.subject }).lean();
  if (!u || u.email !== email || u.name !== identity.name) {
    u = await UserModel.findOneAndUpdate(
      { authSubject: identity.subject },
      { $set: { email, name: identity.name } },
      { upsert: true, new: true, lean: true },
    );
  }
  return { id: u!._id, email: u!.email, name: u!.name, platformRole: (u!.platformRole as "superadmin" | null) ?? null };
}
