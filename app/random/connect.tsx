"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, CornerDownLeft, Loader2, SlidersHorizontal } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { RandomOptions } from "./options";

const ACCENT = "#6D1F4E";
const ONLINE_GREEN = "#16A34A";
// The queue row is swept after 25s without a beat, so poll well inside that.
const POLL_MS = 2000;

type Phase = "searching" | "stopped" | "error";

// What the wait says. Short, one mood each, and they rotate — a
// paragraph of reassurance is not what anyone reads while waiting. The
// emoji swaps with the line so the screen visibly moves even when the
// pool is quiet.
const WAITING_LINES: { emoji: string; text: string }[] = [
  { emoji: "👋", text: "Say hi to someone new" },
  { emoji: "🙈", text: "Anonymous until you reveal" },
  { emoji: "🌙", text: "Awake, no one to text" },
  { emoji: "🎧", text: "Quiet company, no pressure" },
  { emoji: "✨", text: "New here? Start with a stranger" },
  { emoji: "💬", text: "Just talk — no profiles" }
];

// Signing in lands you in the chat window itself — the search runs inside
// it rather than on a screen you have to click through. The composer is
// present but inert until someone is on the other end, so the room does not
// change shape when the match lands.
//
// Searching and polling are the same server call: POST /api/random/queue
// both enqueues and polls, returning a session id the moment one exists.
export function RandomConnect({
  prefGender,
  prefWorkspace,
  interests,
  displayName,
  children
}: {
  prefGender: string;
  prefWorkspace: string;
  interests: string[];
  displayName: string | null;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("searching");
  const [error, setError] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [sharedCount, setSharedCount] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [notifyState, setNotifyState] = useState<"idle" | "saving" | "done">("idle");
  const [sheetOpen, setSheetOpen] = useState(false);
  // Guards the poll loop against a late response landing after the user
  // stopped, and navigating them into a room they backed out of.
  const activeRef = useRef(false);

  const leaveQueue = useCallback(() => {
    activeRef.current = false;
    // keepalive so the request survives the page going away.
    fetch("/api/random/queue", { method: "DELETE", keepalive: true }).catch(() => {});
  }, []);

  const poll = useCallback(async () => {
    if (!activeRef.current) return;
    try {
      const res = await fetch("/api/random/queue", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!activeRef.current) return;

      if (!res.ok) {
        setError(data.error ?? "Couldn't reach the queue.");
        setPhase("error");
        activeRef.current = false;
        return;
      }

      if (data.status === "paired" && data.sessionId) {
        activeRef.current = false;
        router.push(`/random/${data.sessionId}`);
        return;
      }

      setOnlineCount(typeof data.onlineCount === "number" ? data.onlineCount : null);
      setSharedCount(typeof data.sharedCount === "number" ? data.sharedCount : null);
      if (data.notifyRegistered) setNotifyState("done");
      setTimeout(poll, POLL_MS);
    } catch {
      if (!activeRef.current) return;
      // A dropped request is not fatal — the queue row is still beating on
      // the server for another few seconds. Just try again.
      setTimeout(poll, POLL_MS);
    }
  }, [router]);

  const start = useCallback(() => {
    setError(null);
    setElapsed(0);
    setOnlineCount(null);
    setSharedCount(null);
    setNotifyState("idle");
    setPhase("searching");
    activeRef.current = true;
    poll();
  }, [poll]);

  function stop() {
    leaveQueue();
    setPhase("stopped");
  }

  // Straight into the search on arrival. Interests are optional — with
  // none set you are still paired, just without the overlap bonus.
  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leave the queue if the tab closes while we are still waiting.
  useEffect(() => {
    function onHide() {
      if (activeRef.current) leaveQueue();
    }
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (activeRef.current) leaveQueue();
    };
  }, [leaveQueue]);

  useEffect(() => {
    if (phase !== "searching") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "searching") return;
    const t = setInterval(
      () => setLineIndex((i) => (i + 1) % WAITING_LINES.length),
      2800
    );
    return () => clearInterval(t);
  }, [phase]);

  // Not searching still shows how many people are around — GET, so reading
  // the number does not put us back in the queue.
  useEffect(() => {
    if (phase === "searching") return;
    let stopped = false;
    async function read() {
      if (stopped) return;
      try {
        const res = await fetch("/api/random/queue");
        if (res.ok) {
          const d = await res.json();
          if (stopped) return;
          if (typeof d.onlineCount === "number") setOnlineCount(d.onlineCount);
          if (typeof d.sharedCount === "number") setSharedCount(d.sharedCount);
        }
      } catch {}
      if (!stopped) setTimeout(read, 15000);
    }
    read();
    return () => { stopped = true; };
  }, [phase]);

  // Thin-pool escape hatch: stop waiting, get a push when the pool wakes up.
  async function notifyMe() {
    setNotifyState("saving");
    try {
      const res = await fetch("/api/random/notify", { method: "POST" });
      if (!res.ok) { setNotifyState("idle"); return; }
      setNotifyState("done");
      activeRef.current = false;
      setPhase("stopped");
    } catch {
      setNotifyState("idle");
    }
  }

  const searching = phase === "searching";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header, same shape the room uses so the window does not jump when
          a match lands. */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur">
        <div className="h-14 px-4 flex items-center gap-3">
          <span
            className="w-7 h-7 shrink-0 rounded-[5px] border border-hairline"
            style={{ background: "var(--tint)" }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-ink truncate">
              {searching ? "Searching…" : "Not searching"}
            </p>
            {onlineCount !== null ? (
              <p
                className="text-[11px] truncate flex items-center gap-1.5"
                style={{ color: ONLINE_GREEN }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: ONLINE_GREEN }}
                  aria-hidden
                />
                {onlineCount} online
                {sharedCount ? ` · ${sharedCount} match your interests` : ""}
              </p>
            ) : (
              <p className="text-[11px] text-muted truncate">
                {searching ? "Checking who's around" : "Tap search to look again"}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Where the transcript will be. */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        {searching ? (
          <>
            <Loader2 size={28} className="animate-spin" style={{ color: ACCENT }} />
            <p className="mt-4 text-[15px] font-semibold">Searching for someone to talk to…</p>
            <p
              key={lineIndex}
              className="mt-1.5 text-sm text-muted flex items-center gap-2 animate-[fadeIn_300ms_ease-out]"
            >
              <span className="text-base leading-none">{WAITING_LINES[lineIndex].emoji}</span>
              {WAITING_LINES[lineIndex].text}
            </p>

            {elapsed > 25 && notifyState !== "done" && (
              <>
                <p className="mt-6 text-sm text-muted max-w-xs">
                  It&apos;s quiet right now. Leave this open and we&apos;ll connect you the
                  second someone shows up.
                </p>
                <button
                  type="button"
                  onClick={notifyMe}
                  disabled={notifyState === "saving"}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-hairline px-4 py-2 text-xs font-semibold text-ink hover:bg-tint transition disabled:opacity-60"
                >
                  <BellRing size={14} />
                  {notifyState === "saving" ? "Setting up…" : "Notify me instead"}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={stop}
              className="mt-5 text-xs font-semibold text-muted underline underline-offset-4"
            >
              Stop searching
            </button>
          </>
        ) : (
          <>
            {error && (
              <p className="mb-4 text-sm font-semibold" style={{ color: "#D43A2F" }}>
                {error}
              </p>
            )}
            {notifyState === "done" && !error && (
              <p className="mb-4 text-sm text-muted inline-flex items-center gap-1.5">
                <Check size={14} /> We&apos;ll notify you when someone&apos;s around.
              </p>
            )}
            <button
              type="button"
              onClick={start}
              className="rounded-full px-7 py-3 text-sm font-semibold text-white transition active:scale-[0.99]"
              style={{ background: ACCENT, boxShadow: "0 8px 26px rgba(109,31,78,0.35)" }}
            >
              Search again
            </button>
          </>
        )}
      </div>

      {/* Composer, present but inert until there is someone to talk to.
          The options icon sits inside the input, so the button on the right
          stays the send button and the row keeps the shape it will have
          once there is someone to talk to. */}
      <div className="border-t border-hairline bg-white">
        <div className="px-4 py-3 flex items-center gap-2">
          <div className="relative flex-1">
            <div className="rounded-full bg-tint pl-5 pr-12 py-3 text-sm text-ink/35 select-none">
              Waiting for someone…
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-expanded={sheetOpen}
              aria-label="Interests and preferences"
              title="Interests & preferences"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-muted hover:bg-black/5 transition active:scale-95"
            >
              <SlidersHorizontal size={17} />
            </button>
          </div>
          <span
            className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white opacity-40"
            style={{ background: ACCENT }}
            aria-hidden
          >
            <CornerDownLeft size={18} />
          </span>
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Interests &amp; preferences"
      >
        <RandomOptions
          initialGender={prefGender}
          initialWorkspace={prefWorkspace}
          initialInterests={interests}
          initialName={displayName}
          onSaved={() => setSheetOpen(false)}
        />
        {children}
      </BottomSheet>
    </div>
  );
}
