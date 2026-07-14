import { notFound } from "next/navigation";
import { ModerationQueue } from "@/components/ModerationQueue";
import { sessionInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  const info = await sessionInfo();
  if (info.kind !== "user" || info.user.role !== "moderator") notFound();

  return (
    <div className="stone-wall min-h-dvh px-4 py-6">
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-[15px] uppercase tracking-widest text-brass">▸ The Small Council</p>
        <h1 className="mt-2 font-display text-[13px] leading-relaxed text-ink">Review Queue</h1>
        <ModerationQueue />
      </div>
    </div>
  );
}
