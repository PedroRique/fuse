import { redirect } from "next/navigation";
import { BoardApp } from "@/components/board/board-app";
import { getProfile, loadBoard } from "@/server/queries";

export const metadata = { title: "Board — Fuse" };

export default async function BoardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarded) redirect("/onboarding");
  const snapshot = await loadBoard();
  return <BoardApp snapshot={snapshot} />;
}
