import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import { getSessionUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-server";
import { AppShell } from "@/components/app-shell";
import { AnonAvatar } from "@/components/anon-avatar";
import { thumb } from "@/lib/cloudinary-thumb";
import { aliasFor, partnerIdOf, sideOf, type SessionRow } from "@/lib/random";

export const dynamic = "force-dynamic";

// Everyone you are connected to, in one place. This used to be split
// across /hooks (matched + sent) and /matches (the same matched people
// again, with a last message). Two pages listing the same relationship
// differently is a thing to keep in sync forever, so they are one page:
//
//   Matched    — it is mutual. Row opens the conversation.
//   Requests   — one-sided, both directions. Received was previously
//                shown nowhere at all, so likes sent to you were invisible.
//   Anonymous  — random chats you saved, still without identities. These
//                were only reachable inside the Random options sheet.

type Person = {
  key: string;
  otherId: string;
  name: string | null;
  photo: string | null;
  conversationId: string | null;
  preview: string | null;
};

type AnonRow = {
  id: string;
  alias: string;
  messageCount: number;
  startedAt: string;
};

type Tab = "matched" | "requests" | "anonymous";

export default async function HooksPage({ searchParams }: { searchParams: { tab?: string } }) {
  const me = await getSessionUser();
  if (!me) redirect("/login");

  const tab: Tab =
    searchParams.tab === "requests" || searchParams.tab === "sent"
      ? "requests"
      : searchParams.tab === "anonymous"
        ? "anonymous"
        : "matched";

  let matched: Person[] = [];
  let sent: Person[] = [];
  let received: Person[] = [];
  let anonymous: AnonRow[] = [];
  let dbError = false;

  const admin = supabaseAdmin();
  if (!admin) {
    dbError = true;
  } else {
    try {
      // Everything that does not depend on another result goes together.
      const [outRes, inRes, convRes, randRes] = await Promise.all([
        admin
          .from("Hook")
          .select("id,toUserId,createdAt, toUser:User!Hook_toUserId_fkey(id,name)")
          .eq("fromUserId", me.id)
          .order("createdAt", { ascending: false }),
        admin
          .from("Hook")
          .select("id,fromUserId,createdAt, fromUser:User!Hook_fromUserId_fkey(id,name)")
          .eq("toUserId", me.id)
          .order("createdAt", { ascending: false }),
        // Only the newest message per conversation — embedding the whole
        // transcript to show one line of preview is how the old page did
        // it, and it scales with how much people talk.
        admin
          .from("Conversation")
          .select("id,userAId,userBId,updatedAt,matchId, messages:Message(body,createdAt)")
          .or(`userAId.eq.${me.id},userBId.eq.${me.id}`)
          .order("createdAt", { ascending: false, foreignTable: "messages" })
          .limit(1, { foreignTable: "messages" }),
        admin
          .from("RandomSession")
          .select("*")
          .or(`and(userAId.eq.${me.id},keptByA.eq.true),and(userBId.eq.${me.id},keptByB.eq.true)`)
          .order("startedAt", { ascending: false })
          .limit(50)
      ]);

      const outgoing = (outRes.data ?? []) as any[];
      const incoming = (inRes.data ?? []) as any[];

      const outIds = new Set(outgoing.map((r) => r.toUserId));
      const inIds = new Set(incoming.map((r) => r.fromUserId));

      // One photo lookup for everyone on the page.
      const everyone = Array.from(new Set([...outIds, ...inIds]));
      const photoByUser: Record<string, string> = {};
      if (everyone.length > 0) {
        const { data: photos } = await admin
          .from("Photo")
          .select("userId,url,position")
          .in("userId", everyone)
          .order("position", { ascending: true });
        for (const p of (photos ?? []) as any[]) {
          if (!photoByUser[p.userId]) photoByUser[p.userId] = p.url;
        }
      }

      const convByOther = new Map<string, { id: string; preview: string | null }>();
      for (const c of (convRes.data ?? []) as any[]) {
        const other = c.userAId === me.id ? c.userBId : c.userAId;
        convByOther.set(other, {
          id: c.id,
          preview: c.messages?.[0]?.body ?? null
        });
      }

      const person = (otherId: string, name: string | null, key: string): Person => {
        const conv = convByOther.get(otherId);
        return {
          key,
          otherId,
          name,
          photo: photoByUser[otherId] ?? null,
          conversationId: conv?.id ?? null,
          preview: conv?.preview ?? null
        };
      };

      matched = outgoing
        .filter((r) => inIds.has(r.toUserId))
        .map((r) => person(r.toUserId, r.toUser?.name ?? null, r.id));

      sent = outgoing
        .filter((r) => !inIds.has(r.toUserId))
        .map((r) => person(r.toUserId, r.toUser?.name ?? null, r.id));

      received = incoming
        .filter((r) => !outIds.has(r.fromUserId))
        .map((r) => person(r.fromUserId, r.fromUser?.name ?? null, r.id));

      // Saved random chats. A session that revealed already has a real
      // Conversation and shows under Matched, so it is left out here
      // rather than listed twice under two different names.
      anonymous = ((randRes.data ?? []) as SessionRow[]).flatMap((s) => {
        if (s.conversationId) return [];
        const side = sideOf(s, me.id);
        const partnerId = partnerIdOf(s, me.id);
        if (!side || !partnerId) return [];
        return [{
          id: s.id,
          alias: aliasFor(s.id, side === "A" ? "B" : "A"),
          messageCount: s.messageCount,
          startedAt: s.startedAt
        }];
      });
    } catch (e) {
      console.error("connections query failed:", e);
      dbError = true;
    }
  }

  // Handles are the one thing we cannot derive without a second lookup, so
  // the anonymous rows carry the generated alias unless the partner picked
  // one. Kept deliberately simple: only displayName is read, never name.
  if (!dbError && anonymous.length > 0 && admin) {
    const { data: rand } = await admin
      .from("RandomSession")
      .select("id,userAId,userBId")
      .in("id", anonymous.map((a) => a.id));
    const partnerIds = ((rand ?? []) as any[])
      .map((r) => (r.userAId === me.id ? r.userBId : r.userAId));
    if (partnerIds.length > 0) {
      const { data: people } = await admin
        .from("User")
        .select("id,displayName")
        .in("id", Array.from(new Set(partnerIds)));
      const handle = new Map<string, string>();
      for (const p of (people ?? []) as any[]) {
        const h = (p.displayName ?? "").trim();
        if (h) handle.set(p.id, h);
      }
      const partnerBySession = new Map<string, string>(
        ((rand ?? []) as any[]).map((r) => [r.id, r.userAId === me.id ? r.userBId : r.userAId])
      );
      anonymous = anonymous.map((a) => {
        const pid = partnerBySession.get(a.id);
        return pid && handle.get(pid) ? { ...a, alias: handle.get(pid)! } : a;
      });
    }
  }

  const requests = [...received, ...sent];
  const counts = { matched: matched.length, requests: requests.length, anonymous: anonymous.length };

  return (
    <AppShell>
      <div className="px-4 pt-4 pb-12">
        <div className="grid grid-cols-3 gap-2">
          <Chip href="/hooks?tab=matched" label="Matched" count={counts.matched} active={tab === "matched"} />
          <Chip href="/hooks?tab=requests" label="Requests" count={counts.requests} active={tab === "requests"} />
          <Chip href="/hooks?tab=anonymous" label="Anonymous" count={counts.anonymous} active={tab === "anonymous"} />
        </div>

        {dbError ? (
          <div className="card-line p-5 mt-6">
            <p className="font-semibold">Couldn&apos;t load.</p>
          </div>
        ) : tab === "anonymous" ? (
          anonymous.length === 0 ? (
            <Empty line="Chats you save from Random show up here, still anonymous." />
          ) : (
            <ul className="mt-6 space-y-3">
              {anonymous.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/random/${a.id}`}
                    className="card-line flex items-center gap-3 p-3 active:bg-tint transition"
                  >
                    <AnonAvatar name={a.alias} size={46} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-base truncate">{a.alias}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {a.messageCount} {a.messageCount === 1 ? "message" : "messages"}
                        {" · "}
                        {new Date(a.startedAt).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short"
                        })}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : tab === "requests" ? (
          requests.length === 0 ? (
            <Empty line="No requests waiting." />
          ) : (
            <>
              {received.length > 0 && (
                <Section title="They asked you">
                  {received.map((p) => (
                    <li key={p.key}><PersonRow person={p} action="view" /></li>
                  ))}
                </Section>
              )}
              {sent.length > 0 && (
                <Section title="You asked">
                  {sent.map((p) => (
                    <li key={p.key}><PersonRow person={p} action="none" /></li>
                  ))}
                </Section>
              )}
            </>
          )
        ) : matched.length === 0 ? (
          <Empty line="Nobody matched yet. Hook someone on Discover, or reveal in a random chat." />
        ) : (
          <ul className="mt-6 space-y-3">
            {matched.map((p) => (
              <li key={p.key}><PersonRow person={p} action="chat" /></li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted font-semibold mb-3">
        {title}
      </p>
      <ul className="space-y-3">{children}</ul>
    </div>
  );
}

function Chip({
  href,
  label,
  count,
  active
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full text-[0.85rem] font-semibold border transition active:scale-[0.97] " +
        (active ? "bg-ink text-white border-ink" : "border-hairline text-ink hover:bg-tint")
      }
    >
      {label}
      {count > 0 && (
        <span className={active ? "text-white/70" : "text-muted"}>{count}</span>
      )}
    </Link>
  );
}

function PersonRow({ person, action }: { person: Person; action: "chat" | "view" | "none" }) {
  const body = (
    <>
      <div className="relative w-14 h-14 rounded-full overflow-hidden bg-tint shrink-0">
        {person.photo && (
          <Image src={thumb(person.photo, 150)} alt="" fill className="object-cover" sizes="56px" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-base truncate">{person.name ?? "—"}</p>
        {person.preview && (
          <p className="mt-0.5 text-sm text-muted line-clamp-1">{person.preview}</p>
        )}
      </div>
      {action === "chat" && (
        <span
          aria-hidden
          className="shrink-0 w-11 h-11 rounded-full bg-ink text-white flex items-center justify-center"
        >
          <MessageSquareText size={18} strokeWidth={2} />
        </span>
      )}
    </>
  );

  // A matched row opens the conversation; a request opens their profile so
  // you can decide. A sent request has nothing useful to open yet.
  if (action === "chat" && person.conversationId) {
    return (
      <Link
        href={`/chat/${person.conversationId}`}
        className="card-line flex items-center gap-3 p-3 active:bg-tint transition"
      >
        {body}
      </Link>
    );
  }
  if (action === "view") {
    return (
      <Link
        href={`/profile/${person.otherId}`}
        className="card-line flex items-center gap-3 p-3 active:bg-tint transition"
      >
        {body}
      </Link>
    );
  }
  return <div className="card-line flex items-center gap-3 p-3">{body}</div>;
}

function Empty({ line }: { line: string }) {
  return (
    <div className="mt-12 flex flex-col items-center text-center">
      <SeatedFigure />
      <p className="mt-4 text-sm text-muted max-w-xs">{line}</p>
    </div>
  );
}

function SeatedFigure() {
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" fill="none" aria-hidden>
      <ellipse cx="100" cy="186" rx="68" ry="4" fill="#1C1B19" opacity="0.08" />
      <line x1="138" y1="56" x2="138" y2="124" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="138" y1="64" x2="148" y2="64" stroke="#1C1B19" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="138" y1="76" x2="148" y2="76" stroke="#1C1B19" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="138" y1="88" x2="148" y2="88" stroke="#1C1B19" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="138" y1="100" x2="148" y2="100" stroke="#1C1B19" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="78" y1="124" x2="146" y2="124" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="86" y1="124" x2="82" y2="172" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="138" y1="124" x2="142" y2="172" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="106" cy="58" r="13" fill="white" stroke="#1C1B19" strokeWidth="2.5" />
      <path d="M 106 71 Q 96 86 96 110 Q 96 120 108 124" fill="none" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 104 96 Q 92 108 92 124" fill="none" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 102 77 Q 90 70 92 60" fill="none" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 108 124 Q 84 138 78 172" fill="none" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 108 124 Q 96 150 100 172" fill="none" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="74" y1="172" x2="62" y2="172" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="96" y1="172" x2="84" y2="172" stroke="#1C1B19" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
