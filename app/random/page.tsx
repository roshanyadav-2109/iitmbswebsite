import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-server";
import { AppShell } from "@/components/app-shell";
import { AnonAvatar } from "@/components/anon-avatar";
import { aliasFor, partnerIdOf, sideOf, type SessionRow } from "@/lib/random";
import { RandomConnect } from "./connect";

export const dynamic = "force-dynamic";

export const metadata = { title: "Random" };

export default async function RandomPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");

  // Kept chats — the ones this member chose to hold on to. Everything else
  // is swept by purge_random_sessions() a week after it ends.
  //
  // Each row is labelled with the partner's chosen handle, or the alias
  // generated for that session if they never picked one. Real names are not
  // read here: the projection below is displayName only.
  let kept: { id: string; name: string; startedAt: string; messageCount: number }[] = [];
  const admin = supabaseAdmin();
  if (admin) {
    const { data } = await admin
      .from("RandomSession")
      .select("*")
      .or(
        `and(userAId.eq.${me.id},keptByA.eq.true),and(userBId.eq.${me.id},keptByB.eq.true)`
      )
      .order("startedAt", { ascending: false })
      .limit(50);

    const rows = (data ?? []) as SessionRow[];
    const partnerIds = Array.from(
      new Set(rows.map((r) => partnerIdOf(r, me.id)).filter((x): x is string => !!x))
    );

    const handles = new Map<string, string>();
    if (partnerIds.length > 0) {
      const { data: people } = await admin
        .from("User")
        .select("id,displayName")
        .in("id", partnerIds);
      for (const p of (people ?? []) as any[]) {
        const h = (p.displayName ?? "").trim();
        if (h) handles.set(p.id, h);
      }
    }

    kept = rows.flatMap((s) => {
      const side = sideOf(s, me.id);
      const partnerId = partnerIdOf(s, me.id);
      if (!side || !partnerId) return [];
      return [{
        id: s.id,
        name: handles.get(partnerId) ?? aliasFor(s.id, side === "A" ? "B" : "A"),
        startedAt: s.startedAt,
        messageCount: s.messageCount
      }];
    });
  }

  return (
    <AppShell>
      {/* The chat window is the screen. The search runs inside it, and
          everything you can set lives in the sheet that slides up. */}
      <RandomConnect
        prefGender={me.randomPrefGender}
        prefWorkspace={me.randomPrefWorkspace}
        interests={me.interests}
        displayName={me.displayName}
      >
      </RandomConnect>
    </AppShell>
  );
}
