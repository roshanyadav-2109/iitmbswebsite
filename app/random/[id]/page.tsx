import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-server";
import { describeSession, loadSessionFor } from "@/lib/random";
import { AppShell } from "@/components/app-shell";
import { RandomRoom } from "./room";

export const dynamic = "force-dynamic";

export const metadata = { title: "Random chat" };

export default async function RandomRoomPage({ params }: { params: { id: string } }) {
  const me = await getSessionUser();
  if (!me) redirect("/login");

  // loadSessionFor returns null unless the caller is one of the two
  // participants — there is no way to read a room you were not paired into.
  const found = await loadSessionFor(params.id, me.id);
  if (!found) notFound();

  const admin = supabaseAdmin();
  let initialMessages: { id: string; body: string; mine: boolean; createdAt: string }[] = [];
  if (admin) {
    const { data } = await admin
      .from("RandomMessage")
      .select("id,body,fromUserId,createdAt")
      .eq("sessionId", params.id)
      .order("createdAt", { ascending: true })
      .limit(200);
    initialMessages = (data ?? []).map((m: any) => ({
      id: m.id,
      body: m.body,
      mine: m.fromUserId === me.id,
      createdAt: m.createdAt
    }));
  }

  return (
    <AppShell>
      <RandomRoom
        session={await describeSession(found.session, found.side)}
        side={found.side}
        initialMessages={initialMessages}
        interests={me.interests}
        prefGender={me.randomPrefGender}
        prefWorkspace={me.randomPrefWorkspace}
        displayName={me.displayName}
      />
    </AppShell>
  );
}
