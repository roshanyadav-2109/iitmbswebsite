"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Bookmark, ChevronsRight, CornerDownLeft, Eye, Shuffle, SlidersHorizontal } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { AnonAvatar } from "@/components/anon-avatar";
import { BottomSheet } from "@/components/bottom-sheet";
import { RandomOptions } from "../options";

const ACCENT = "#6D1F4E";
// Reveal is the one irreversible thing in this room — once both sides ask,
// real identities are published — so it gets its own deep red rather than
// the house accent.
const REVEAL_RED = "#C41111";
const POLL_MS = 3500;

// Small square frame beside each line.
const AVATAR = 26;

type Msg = { id: string; body: string; mine: boolean; createdAt: string };

type PublicSession = {
  id: string;
  startedAt: string;
  ended: boolean;
  endedByMe: boolean;
  endReason: string | null;
  myName: string;
  partnerName: string;
  keptByMe: boolean;
  revealAskedByMe: boolean;
  revealAskedByThem: boolean;
  revealed: boolean;
  conversationId: string | null;
  messageCount: number;
};

export function RandomRoom({
  session: initialSession,
  side,
  initialMessages,
  interests,
  prefGender,
  prefWorkspace,
  displayName
}: {
  session: PublicSession;
  side: "A" | "B";
  initialMessages: Msg[];
  interests: string[];
  prefGender: string;
  prefWorkspace: string;
  displayName: string | null;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [partnerTyping, setPartnerTyping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const msgsRef = useRef(msgs);
  // Live channel, kept so the composer can broadcast typing on it. Null
  // when Supabase is not configured — the indicator simply does not appear,
  // which is the right degradation for a cosmetic signal.
  const channelRef = useRef<any>(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous guard — React state lags a render behind, so a fast double
  // Enter would otherwise send the same line twice.
  const sendingRef = useRef(false);

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/random/${initialSession.id}`);
      if (res.ok) {
        const d = await res.json();
        if (d.session) setSession(d.session);
      }
    } catch {}
  }, [initialSession.id]);

  // Realtime when Supabase is configured, polling when it isn't. Same shape
  // as the existing conversation room, so behaviour is consistent.
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) {
      let stopped = false;
      async function tail() {
        if (stopped) return;
        if (document.visibilityState === "visible") {
          const cur = msgsRef.current;
          const last = cur[cur.length - 1]?.id ?? "";
          try {
            const res = await fetch(
              `/api/random/${initialSession.id}/messages?after=${encodeURIComponent(last)}`
            );
            if (res.ok) {
              const d = await res.json();
              if (d.messages?.length) mergeIncoming(d.messages);
            }
          } catch {}
          refreshSession();
        }
        setTimeout(tail, POLL_MS);
      }
      tail();
      return () => { stopped = true; };
    }

    const channel = sb.channel(`random:${initialSession.id}`, {
      config: { broadcast: { self: false } }
    });
    channel.on("broadcast", { event: "message" }, (payload) => {
      const p: any = payload.payload;
      if (!p?.id || p.from === side) return;   // my own echo
      mergeIncoming([{ id: p.id, body: p.body, mine: false, createdAt: p.createdAt }]);
    });
    channel.on("broadcast", { event: "ended" }, () => refreshSession());
    channel.on("broadcast", { event: "reveal" }, () => refreshSession());
    // Typing is broadcast-only — nothing is written down, and it expires on
    // a timer so a partner who closes the tab mid-sentence does not leave
    // "typing…" on screen forever.
    channel.on("broadcast", { event: "typing" }, (payload: any) => {
      if (payload?.payload?.from === side) return;
      setPartnerTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setPartnerTyping(false), 3500);
    });
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      channel.unsubscribe();
    };
  }, [initialSession.id, side, refreshSession]);

  // Throttled to one event every 1.5s. The receiver holds the indicator for
  // 3.5s, so a steady typist stays "typing" without us flooding the channel.
  function signalTyping() {
    const ch = channelRef.current;
    if (!ch || session.ended) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 1500) return;
    lastTypingSent.current = now;
    ch.send({ type: "broadcast", event: "typing", payload: { from: side } }).catch?.(() => {});
  }

  function mergeIncoming(incoming: Msg[]) {
    if (incoming.some((m) => !m.mine)) setPartnerTyping(false);
    setMsgs((m) => {
      const have = new Set(m.map((x) => x.id));
      const fresh = incoming.filter((x) => !have.has(x.id));
      return fresh.length ? [...m, ...fresh] : m;
    });
  }

  // A revealed session becomes a real conversation — move there once.
  useEffect(() => {
    if (session.revealed && session.conversationId) {
      router.push(`/chat/${session.conversationId}`);
    }
  }, [session.revealed, session.conversationId, router]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text || sendingRef.current || session.ended) return;
    sendingRef.current = true;
    setBody("");
    setError(null);
    try {
      const res = await fetch(`/api/random/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Couldn't send that.");
        setBody(text);   // hand the text back rather than losing it
      } else if (d.message) {
        mergeIncoming([d.message]);
      }
    } catch {
      setError("Network hiccup.");
      setBody(text);
    }
    sendingRef.current = false;
  }

  async function endAnd(next: boolean) {
    try {
      await fetch(`/api/random/${session.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: next ? "skipped" : "left" }),
        keepalive: true
      });
    } catch {}
    router.push("/random");
  }

  async function toggleKeep() {
    const keep = !session.keptByMe;
    setSession((s) => ({ ...s, keptByMe: keep }));   // optimistic
    try {
      const res = await fetch(`/api/random/${session.id}/keep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep })
      });
      const d = await res.json().catch(() => ({}));
      if (d.session) setSession(d.session);
    } catch {
      setSession((s) => ({ ...s, keptByMe: !keep }));
    }
  }

  async function askReveal() {
    try {
      const res = await fetch(`/api/random/${session.id}/reveal`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (d.session) setSession(d.session);
    } catch {}
  }

  async function block() {
    try {
      await fetch(`/api/random/${session.id}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: blockReason.trim() })
      });
    } catch {}
    router.push("/random");
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur">
        <div className="h-14 px-4 flex items-center gap-3">
          <Link href="/random" aria-label="Back" className="p-2 -ml-2 active:scale-95 transition">
            <ArrowLeft size={20} strokeWidth={2} />
          </Link>
          <AnonAvatar name={session.partnerName} size={28} />
          <p className="min-w-0 flex-1 font-semibold text-sm truncate text-ink">
            {session.partnerName}
          </p>
          {!session.ended && (
            <button
              type="button"
              onClick={() => setConnectOpen(true)}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white active:scale-95 transition"
              style={{ background: REVEAL_RED }}
            >
              Reveal
            </button>
          )}
          <button
            type="button"
            onClick={() => setBlockOpen(true)}
            aria-label="Block and report"
            title="Block and report"
            className="p-2 -mr-2 active:scale-95 transition text-ink"
          >
            <Ban size={20} />
          </button>
        </div>

        {/* Reveal state — the bridge into the dating half of the app. */}
        {!session.ended && (
          <div className="px-4 pb-3">
            {session.revealAskedByThem && !session.revealAskedByMe ? (
              <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: "var(--tint)" }}>
                <p className="text-xs flex-1">
                  <b>{session.partnerName}</b> wants to swap profiles.
                </p>
                <button
                  type="button"
                  onClick={() => setConnectOpen(true)}
                  className="rounded-full px-4 py-1.5 text-xs font-semibold text-white shrink-0"
                  style={{ background: REVEAL_RED }}
                >
                  Decide
                </button>
              </div>
            ) : session.revealAskedByMe ? (
              <p className="text-xs text-muted flex items-center gap-2">
                <Eye size={13} /> Waiting for them to reveal too.
              </p>
            ) : null}
          </div>
        )}
      </header>

      {/* Transcript */}
      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <p className="text-center text-sm text-muted py-16">
            You're both here and nobody knows who anybody is.<br />Say something.
          </p>
        )}
        {/* One column. Name on its own line with the message underneath,
            and every message is labelled rather than only the first of a
            run — with no left/right sides, the label is what makes a
            stranger chat readable at a glance. */}
        <ul className="space-y-3">
          {msgs.map((m) => {
            const who = m.mine ? session.myName : session.partnerName;
            return (
              <li key={m.id} className="flex gap-2 items-start">
                <AnonAvatar name={who} size={AVATAR} className="mt-[2px]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold tracking-[-0.01em] leading-tight text-ink">
                    {who}
                  </p>
                  <p className="mt-0.5 text-[14px] leading-[1.45] text-ink whitespace-pre-wrap break-words">
                    {m.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        {partnerTyping && !session.ended && (
          <div className="flex gap-2 items-start mt-3" aria-live="polite">
            <AnonAvatar name={session.partnerName} size={AVATAR} className="mt-[2px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold tracking-[-0.01em] leading-tight text-ink">
                {session.partnerName}
              </p>
              <div className="mt-1.5 flex items-center gap-1 h-4">
                <span className="sr-only">is typing</span>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{
                      background: "var(--muted)",
                      animationDelay: `${i * 120}ms`,
                      animationDuration: "900ms"
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {session.ended && (
          <div className="pt-8 text-center">
            <p className="text-sm font-semibold">
              {session.endedByMe ? "You ended this chat." : `${session.partnerName} left.`}
            </p>
            <p className="mt-1 text-xs text-muted">
              {session.keptByMe
                ? "Saved to your history."
                : "Tap the bookmark to keep it, or it'll be cleared in a week."}
            </p>
            <button
              type="button"
              onClick={() => router.push("/random")}
              className="mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white"
              style={{ background: ACCENT }}
            >
              <Shuffle size={16} /> Talk to someone else
            </button>
          </div>
        )}
      </div>

      {/* Composer */}
      {!session.ended && (
        <div className="border-t border-hairline bg-white" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {error && <p className="px-4 pt-2 text-xs" style={{ color: "#D43A2F" }}>{error}</p>}
          <form onSubmit={send} className="px-4 py-3 flex items-center gap-2">
            {/* Skip sits opposite send: one button leaves this person, the
                other talks to them. */}
            <button
              type="button"
              onClick={() => endAnd(true)}
              aria-label="Skip to someone new"
              title="Skip to someone new"
              className="shrink-0 w-11 h-11 rounded-full border border-hairline flex items-center justify-center text-muted hover:bg-tint transition active:scale-95"
            >
              <ChevronsRight size={20} />
            </button>

            <div className="relative flex-1">
              <input
                value={body}
                onChange={(e) => { setBody(e.target.value); signalTyping(); }}
                placeholder="Say something"
                maxLength={1000}
                aria-label="Message"
                className="w-full rounded-full bg-tint pl-5 pr-12 py-3 text-sm outline-none placeholder:text-ink/40"
              />
              <button
                type="button"
                onClick={() => setOptionsOpen(true)}
                aria-label="Interests and preferences"
                title="Interests & preferences"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-muted hover:bg-black/5 transition active:scale-95"
              >
                <SlidersHorizontal size={17} />
              </button>
            </div>

            <button
              type="submit"
              disabled={!body.trim()}
              aria-label="Send"
              className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white disabled:opacity-40 transition active:scale-95"
              style={{ background: ACCENT }}
            >
              <CornerDownLeft size={18} />
            </button>
          </form>
        </div>
      )}

      {/* Two ways to hold on to someone, because wanting to keep talking is
          not the same as wanting to be identified. Saving is one-sided and
          reversible; swapping profiles needs both people and is not. */}
      <BottomSheet
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Keep this connection"
      >
        <div className="space-y-3 -mt-1">
          <button
            type="button"
            onClick={async () => {
              if (!session.keptByMe) await toggleKeep();
              setConnectOpen(false);
            }}
            className="w-full text-left rounded-2xl border border-hairline p-4 hover:bg-tint transition"
          >
            <p className="text-sm font-semibold flex items-center gap-2">
              <Bookmark size={15} />
              {session.keptByMe ? "Saved — stays anonymous" : "Save, stay anonymous"}
            </p>
            <p className="mt-1 text-xs text-muted">
              Keeps the chat in your list so you can come back to it. They
              are not told, nobody sees a name or a photo, and you can undo
              it at any time.
            </p>
          </button>

          <button
            type="button"
            onClick={() => { askReveal(); setConnectOpen(false); }}
            disabled={session.revealAskedByMe}
            className="w-full text-left rounded-2xl border p-4 transition disabled:opacity-60"
            style={{ borderColor: REVEAL_RED }}
          >
            <p className="text-sm font-semibold flex items-center gap-2" style={{ color: REVEAL_RED }}>
              <Eye size={15} />
              {session.revealAskedByMe ? "Asked to swap profiles" : "Swap profiles & connect"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {session.revealAskedByMe
                ? "Waiting for them to agree. Nothing is shown until they do."
                : "Asks them to trade real profiles. It only happens if you both agree — and once it does, it cannot be undone."}
            </p>
          </button>
        </div>
      </BottomSheet>

      {/* Change what you are matched on without leaving the conversation.
          Saving re-renders this page's server component, so the next search
          uses the new tags — the current pairing is already made. */}
      <BottomSheet
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Interests & preferences"
      >
        <RandomOptions
          initialGender={prefGender}
          initialWorkspace={prefWorkspace}
          initialInterests={interests}
          initialName={displayName}
          onSaved={() => setOptionsOpen(false)}
        />
      </BottomSheet>

      {/* Block + report sheet */}
      {blockOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setBlockOpen(false)}>
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-6"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
          >
            <h2 className="font-bold text-lg">Block {session.partnerName}?</h2>
            <p className="mt-2 text-sm text-muted">
              This chat ends, and you two will never be paired again — here or
              anywhere else in the app. They aren't told.
            </p>
            <textarea
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="What happened? (optional — sends a report to moderation)"
              rows={3}
              className="mt-4 w-full rounded-xl bg-tint px-4 py-3 text-sm outline-none placeholder:text-ink/40 resize-none"
            />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setBlockOpen(false)}
                className="flex-1 rounded-full border border-hairline py-3 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={block}
                className="flex-1 rounded-full py-3 text-sm font-semibold text-white"
                style={{ background: "#D43A2F" }}
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
