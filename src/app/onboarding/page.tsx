import { redirect } from "next/navigation";
import { getProfile } from "@/server/queries";
import { Onboarding } from "./onboarding";

export const metadata = { title: "Welcome — Fuse" };

export default async function OnboardingPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.onboarded) redirect("/board");
  return <Onboarding />;
}
