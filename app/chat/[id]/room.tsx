"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BadgeCheck, ImagePlus, X as XIcon, Download, MoreHorizontal } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ChatMenu } from "@/components/chat-menu";
import { Button } from "@/components/ui/button";
import { thumb } from "@/lib/cloudinary-thumb";

type Msg = {
  id: string;
  body: string | null;
  fromUserId: string;
  createdAt: string;
  messageType?: "text" | "photo";
  photoUrl?: string | null;
  viewsRemaining?: number | null;
};

// Bottom nav is hidden on chat routes, so the input sits flush at the
// bottom (just the safe-area inset, no nav offset).
const NAV_HEIGHT_PX = 0;

export function ChatRoom({
  conversationId,
  meId,
  otherUserId,
  otherName,
  otherVerified,
  otherActive,
  otherPhoto,
  initialMessages,
  initialLocked
}: {
  conversationId: string;
  meId: string;
  otherUserId: string;
  otherName: string;
  otherVerified: boolean;
  otherActive: boolean;
  otherPhoto: string | null;
  initialMessages: Msg[];
  initialLocked: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [locked, setLocked] = useState(initialLocked);
  // Live "active" state — seeded from the server snapshot, refreshed by a
  // lightweight poll so the green dot turns on/off while you're in the chat.
  const [active, setActive] = useState(otherActive);
  const [viewer, setViewer] = useState<{ msgId: string; url: string; viewsRemaining: number } | null>(null);
  const [reportMsgId, setReportMsgId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Synchronous re-entry guard. React state for `sending` doesn't flip
  // until next render, so rapid Enter / double-click can fire send()
  // twice before `sending` becomes true. The ref blocks that.
  const sendingRef = useRef(false);
  const msgsRef = useRef(msgs);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  useEffect(() => {
    function ping() {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/chat/${conversationId}/heartbeat`, { method: "POST" }).catch(() => {});
    }
    async function checkPresence() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/chat/${conversationId}/presence`);
        if (res.ok) { const d = await res.json(); setActive(!!d.active); }
      } catch {}
    }
    ping();
    checkPresence();
    // 5-min heartbeat (write) keeps my lastSeenAt fresh; 60s presence poll
    // (read) keeps the other person's green dot live while we're in chat.
    const t = setInterval(ping, 5 * 60_000);
    const p = setInterval(checkPresence, 60_000);
    return () => { clearInterval(t); clearInterval(p); };
  }, [conversationId]);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) {
      let stopped = false;
      async function poll() {
        if (stopped) return;
        if (document.visibilityState === "visible") {
          // Read latest msgs through the ref so this effect doesn't need
          // `msgs` in its dep array.
          const cur = msgsRef.current;
          const last = cur[cur.length - 1]?.id ?? "";
          const res = await fetch(`/api/chat/${conversationId}/messages?after=${last}`);
          if (res.ok) {
            const data = await res.json();
            if (data.messages?.length) {
              setMsgs((m) => {
                const have = new Set(m.map((x) => x.id));
                const incoming = data.messages.filter((x: Msg) => !have.has(x.id));
                return incoming.length ? [...m, ...incoming] : m;
              });
            }
          }
        }
        setTimeout(poll, 4000);
      }
      poll();
      return () => { stopped = true; };
    }
    const channel = sb.channel(`conv:${conversationId}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "message" }, (payload) => {
      const m = payload.payload as Msg;
      // Self-broadcasts (server fan-out arrives back at the sender):
      // skip them — the POST response already replaced the optimistic
      // temp with the real row. Without this we double-show on send.
      if (m.fromUserId === meId) return;
      setMsgs((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    });
    channel.on("broadcast", { event: "photoView" }, (payload) => {
      const { messageId, viewsRemaining, expired } = payload.payload as {
        messageId: string; viewsRemaining: number; expired: boolean;
      };
      setMsgs((prev) => prev.map((p) =>
        p.id === messageId
          ? { ...p, viewsRemaining, photoUrl: expired ? null : p.photoUrl }
          : p
      ));
    });
    channel.subscribe();
    return () => { channel.unsubscribe(); };
    // Crucially DO NOT depend on `msgs` here — that caused the channel
    // to tear down + re-subscribe on every send, briefly running two
    // subscriptions and replaying the broadcast as a duplicate.
  }, [conversationId, meId]);

  async function send() {
    const text = body.trim();
    if (!text || sendingRef.current || locked) return;
    sendingRef.current = true;
    setSending(true);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Msg = {
      id: tempId, body: text, fromUserId: meId,
      createdAt: new Date().toISOString(), messageType: "text"
    };
    setBody("");
    setMsgs((m) => [...m, optimistic]);

    try {
      const res = await fetch(`/api/chat/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.locked) setLocked(true);
        setMsgs((m) => m.filter((x) => x.id !== tempId));
        return;
      }
      const data = await res.json();
      // Replace temp with real. If a race had already added the real id
      // (e.g. via a stale subscription), drop the duplicate.
      setMsgs((m) => {
        const already = m.some((x) => x.id === data.message.id);
        const next = m.map((x) => (x.id === tempId ? data.message : x));
        if (!already) return next;
        return next.filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
      });
    } catch {
      setMsgs((m) => m.filter((x) => x.id !== tempId));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function sendPhoto(file: File) {
    if (uploading || locked) return;
    setUploading(true);
    try {
      const sb = supabaseBrowser();
      if (!sb) throw new Error("Photo upload unavailable.");
      const { data: sig, error: sigErr } = await sb.functions.invoke<{
        timestamp: number; folder: string; signature: string;
        apiKey: string; cloudName: string; error?: string;
      }>("cloudinary-signature");
      if (sigErr) throw sigErr;
      if (!sig || sig.error) throw new Error(sig?.error ?? "No signature");

      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", sig.apiKey);
      fd.append("timestamp", String(sig.timestamp));
      fd.append("signature", sig.signature);
      fd.append("folder", sig.folder);
      const upRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
        method: "POST", body: fd
      });
      const upData = await upRes.json();
      if (!upData.secure_url) throw new Error(upData.error?.message ?? "Upload failed");

      const res = await fetch(`/api/chat/${conversationId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: upData.secure_url, publicId: upData.public_id })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Couldn't send");
      }
      const data = await res.json();
      setMsgs((m) => [...m, data.message]);
    } catch (e) {
      console.error("photo send failed:", e);
    } finally {
      setUploading(false);
    }
  }

  async function openPhoto(msg: Msg) {
    if (msg.messageType !== "photo") return;
    // Sender already holds the URL — open without spending a view.
    if (msg.fromUserId === meId && msg.photoUrl) {
      setViewer({ msgId: msg.id, url: msg.photoUrl, viewsRemaining: msg.viewsRemaining ?? 0 });
      return;
    }
    if ((msg.viewsRemaining ?? 0) <= 0) return;

    try {
      const res = await fetch(`/api/chat/${conversationId}/messages/${msg.id}/view`, { method: "POST" });
      if (res.status === 410) {
        setMsgs((prev) => prev.map((p) => p.id === msg.id ? { ...p, viewsRemaining: 0, photoUrl: null } : p));
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setMsgs((prev) => prev.map((p) =>
        p.id === msg.id ? { ...p, viewsRemaining: data.viewsRemaining } : p
      ));
      setViewer({ msgId: msg.id, url: data.url, viewsRemaining: data.viewsRemaining });
    } catch {}
  }

  function savePhoto(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `mismatched-${Date.now()}.jpg`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function reportMessage() {
    if (!reportMsgId) return;
    await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "message", targetId: reportMsgId, reason: "Reported from chat" })
    }).catch(() => {});
    setReportMsgId(null);
  }

  return (
    <div className="desktop:fixed desktop:top-5 desktop:bottom-5 desktop:left-[440px] desktop:right-5 desktop:flex desktop:flex-col desktop:bg-white desktop:border desktop:border-hairline desktop:rounded-2xl desktop:overflow-hidden desktop:shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
      <header className="fixed top-0 inset-x-0 z-40 bg-white border-b border-hairline desktop:static desktop:z-auto desktop:flex-shrink-0 desktop:border-b-hairline">
        <div className="mx-auto desktop:mx-0 max-w-md desktop:max-w-none h-14 px-3 flex items-center gap-2">
          <Link href="/hooks" aria-label="Back" className="p-2 -ml-2 text-ink active:scale-95 transition">
            <ArrowLeft size={22} strokeWidth={2} />
          </Link>
          <Link
            href={`/profile/${otherUserId}`}
            className="flex-1 flex items-center gap-3 min-w-0 active:opacity-70 transition"
          >
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-full overflow-hidden bg-tint">
                {otherPhoto && (
                  <Image src={thumb(otherPhoto, 100)} alt="" fill className="object-cover" sizes="36px" />
                )}
              </div>
              {/* Active dot sits OUTSIDE the clipped circle, overlapping the
                  frame edge — the outer div isn't overflow-hidden. */}
              {active && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white"
                  style={{ background: "#22C55E" }} aria-label="Active" />
              )}
            </div>
            <div className="flex items-center gap-1 min-w-0">
              <h1 className="font-extrabold text-base tracking-[-0.02em] truncate">{otherName}</h1>
              {otherVerified && (
                <BadgeCheck size={16} strokeWidth={2}
                  style={{ color: "#D43A2F", fill: "transparent" }} aria-label="Verified" />
              )}
            </div>
          </Link>
          <ChatMenu otherUserId={otherUserId} otherName={otherName} />
        </div>
      </header>

      <div
        ref={scroller}
        className="overflow-y-auto desktop:flex-1 desktop:!pt-0 desktop:!pb-0 desktop:!min-h-0"
        style={{
          paddingTop: "56px",
          minHeight: `calc(100vh - 56px - 64px - ${NAV_HEIGHT_PX}px - env(safe-area-inset-bottom))`,
          paddingBottom: `calc(${NAV_HEIGHT_PX + 70}px + env(safe-area-inset-bottom))`
        }}
      >
        <div className="mx-auto desktop:mx-0 max-w-md desktop:max-w-none px-4 py-4 space-y-3">
          {msgs.map((m) => {
            const mine = m.fromUserId === meId;
            if ((m.messageType ?? "text") === "photo") {
              return (
                <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                  <PhotoBubble
                    msg={m}
                    mine={mine}
                    onOpen={() => openPhoto(m)}
                    onReport={() => setReportMsgId(m.id)}
                  />
                </div>
              );
            }
            return (
              <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    "max-w-[78%] desktop:max-w-[60ch] px-4 py-2.5 text-[0.95rem] leading-relaxed " +
                    (mine
                      ? "bg-ink text-white rounded-[18px] rounded-br-[6px]"
                      : "bg-tint text-ink rounded-[18px] rounded-bl-[6px]")
                  }
                  onContextMenu={(e) => {
                    if (mine) return;
                    e.preventDefault();
                    setReportMsgId(m.id);
                  }}
                >
                  {m.body}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="fixed inset-x-0 z-30 bg-white border-t border-hairline desktop:static desktop:z-auto desktop:flex-shrink-0"
        style={{ bottom: `calc(${NAV_HEIGHT_PX}px + env(safe-area-inset-bottom))` }}
      >
        <div className="mx-auto desktop:mx-0 max-w-md desktop:max-w-none px-4 py-3">
          {locked ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm leading-snug">This chat is paused. Upgrade to keep talking.</p>
              <Link href="/upgrade" className="shrink-0 px-5 py-2.5 rounded-full bg-ink text-white text-sm font-semibold">
                Upgrade
              </Link>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <button
                type="button"
                aria-label="Send photo"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="shrink-0 p-2 -ml-1 text-ink disabled:opacity-50 active:scale-95 transition-transform duration-100"
                style={{ touchAction: "manipulation" }}
              >
                <ImagePlus size={22} strokeWidth={2} />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) sendPhoto(f);
                  e.currentTarget.value = "";
                }}
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                placeholder={uploading ? "Uploading photo…" : "Message"}
                rows={1}
                maxLength={1000}
                disabled={uploading}
                className="field min-h-[2.5rem] resize-none"
              />
              <Button onClick={send} disabled={sending || !body.trim() || uploading}>Send</Button>
            </div>
          )}
        </div>
      </div>

      {viewer && (
        <PhotoViewer
          url={viewer.url}
          viewsRemaining={viewer.viewsRemaining}
          onClose={() => setViewer(null)}
          onSave={() => savePhoto(viewer.url)}
        />
      )}

      {reportMsgId && (
        <ReportMessageSheet
          onCancel={() => setReportMsgId(null)}
          onConfirm={reportMessage}
        />
      )}
    </div>
  );
}

function PhotoBubble({
  msg, mine, onOpen, onReport
}: {
  msg: Msg; mine: boolean; onOpen: () => void; onReport: () => void;
}) {
  const remaining = msg.viewsRemaining ?? 0;
  const expired = remaining <= 0 || (!mine && !msg.photoUrl && remaining <= 0);
  const exhausted = remaining <= 0;

  const label = exhausted
    ? "Photo expired"
    : mine
      ? `Sent · ${remaining} ${remaining === 1 ? "view" : "views"} left`
      : `Tap to view · ${remaining} ${remaining === 1 ? "view" : "views"} left`;

  return (
    <button
      type="button"
      onClick={exhausted ? undefined : onOpen}
      onContextMenu={(e) => { if (!mine) { e.preventDefault(); onReport(); } }}
      disabled={exhausted}
      className={
        "max-w-[78%] flex items-center gap-3 px-4 py-3 text-left transition-transform duration-100 active:scale-[0.98] " +
        (mine
          ? "bg-ink text-white rounded-[18px] rounded-br-[6px]"
          : "bg-tint text-ink rounded-[18px] rounded-bl-[6px]") +
        (exhausted ? " opacity-60" : "")
      }
      style={{ touchAction: "manipulation" }}
    >
      <div
        className={"w-12 h-12 rounded-xl flex items-center justify-center shrink-0 " + (mine ? "bg-white/15" : "bg-ink/10")}
      >
        <PhotoGlyph color={mine ? "#fff" : "#1C1B19"} />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-[0.95rem] leading-tight">Photo</p>
        <p className={"mt-0.5 text-xs " + (mine ? "text-white/75" : "text-muted")}>{label}</p>
      </div>
    </button>
  );
}

function PhotoGlyph({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="1.6" />
      <path d="M21 17l-5-5-9 9" />
    </svg>
  );
}

function PhotoViewer({
  url, viewsRemaining, onClose, onSave
}: {
  url: string; viewsRemaining: number; onClose: () => void; onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} aria-label="Close" className="p-2 text-white">
          <XIcon size={24} strokeWidth={2} />
        </button>
        <p className="text-white text-xs tracking-wide">
          {viewsRemaining > 0
            ? `${viewsRemaining} ${viewsRemaining === 1 ? "view" : "views"} remaining`
            : "Last view — photo will expire after this"}
        </p>
        <button onClick={onSave} aria-label="Save" className="p-2 text-white">
          <Download size={22} strokeWidth={2} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center px-4 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="max-w-full max-h-full object-contain" />
      </div>
    </div>
  );
}

function ReportMessageSheet({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md bg-white rounded-t-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
      >
        <h3 className="font-extrabold text-xl tracking-[-0.02em]" style={{ color: "#D43A2F" }}>Report this message?</h3>
        <p className="mt-2 text-sm text-muted">We'll review it and act on the account if needed.</p>
        <div className="mt-5 flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-3 rounded-full border border-ink font-semibold text-sm">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-3 rounded-full text-white font-semibold text-sm"
            style={{ background: "#D43A2F" }}>
            Report
          </button>
        </div>
      </div>
    </div>
  );
}
