"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, User as UserIcon, Heart as HeartIcon, Ruler as RulerIcon,
  Cake as CakeIcon, Quote as QuoteIcon, Sprout as SproutIcon,
  Users as UsersIcon, BadgeCheck as BadgeCheckIcon, MoreHorizontal, X
} from "lucide-react";
import { thumb } from "@/lib/cloudinary-thumb";

type Photo = { id: string; url: string; position: number };
type Prompt = { id: string; text: string };
type UserPrompt = { id: string; answer: string; position: number; prompt: Prompt };

export type DetailCandidate = {
  id: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  orientation: string | null;
  bio: string | null;
  height: string | null;
  location: string | null;
  intentions: string | null;
  relationshipType: string | null;
  verified: boolean;
  foundingMember: boolean;
  photos: Photo[];
  userPrompts: UserPrompt[];
};

const GENDER_LABEL: Record<string, string> = {
  man: "Man", woman: "Woman", nonbinary: "Non-binary", other: "Other"
};
const ORIENTATION_LABEL: Record<string, string> = {
  straight: "Straight", gay: "Gay", lesbian: "Lesbian",
  bisexual: "Bisexual", pansexual: "Pansexual", asexual: "Asexual", other: "Other"
};

export function ProfileViewClient({ candidate }: { candidate: DetailCandidate }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc() { setMenuOpen(false); }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  async function submitReport() {
    if (!reason.trim() || sending) return;
    setSending(true); setErr(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "user", targetId: candidate.id, reason: reason.trim() })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Couldn't send");
      }
      setSent(true);
      setTimeout(() => setReportOpen(false), 900);
    } catch (e: any) {
      setErr(e.message ?? "Couldn't send");
    } finally {
      setSending(false);
    }
  }

  async function blockUser() {
    await fetch("/api/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: candidate.id })
    });
    router.push("/hooks");
  }

  const blocks = buildBlocks(candidate.photos, candidate.userPrompts);

  return (
    <article>
      <header className="px-1 mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => router.back()}
          className="p-2 -ml-2 active:scale-95 transition-transform duration-100"
          style={{ touchAction: "manipulation" }}
        >
          <ArrowLeft size={22} strokeWidth={2} />
        </button>

        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <h2 className="font-extrabold text-2xl tracking-[-0.03em] truncate">{candidate.name ?? "—"}</h2>
          {candidate.verified && (
            <BadgeCheckIcon size={20} strokeWidth={2}
              style={{ color: "#D43A2F", fill: "transparent" }} aria-label="Verified" />
          )}
        </div>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="More"
            onClick={() => setMenuOpen((o) => !o)}
            className="p-2 -mr-2 text-ink">
            <MoreHorizontal size={22} strokeWidth={2} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-30 w-44 card-line py-1.5 text-sm">
              <button type="button"
                onClick={() => { setMenuOpen(false); setReportOpen(true); }}
                className="block w-full text-left px-4 py-2.5 hover:bg-tint transition"
                style={{ color: "#D43A2F" }}>
                Report
              </button>
              <button type="button"
                onClick={() => { setMenuOpen(false); blockUser(); }}
                className="block w-full text-left px-4 py-2.5 hover:bg-tint transition">
                Block
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="space-y-3">
        {blocks.map((b, i) => {
          if (b.kind === "photo")
            return <PhotoBlock key={`p${b.photo.id}-${i}`} photo={b.photo} alt={candidate.name ?? ""} />;
          if (b.kind === "prompt") return <PromptCard key={`q${b.up.id}-${i}`} up={b.up} />;
          return <InfoCard key={`d${i}`} candidate={candidate} />;
        })}
      </div>

      {reportOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center"
          onClick={() => !sending && setReportOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md bg-white rounded-t-2xl p-6"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-extrabold text-2xl tracking-[-0.03em]" style={{ color: "#D43A2F" }}>
                Report {candidate.name ?? "this profile"}
              </h3>
              <button onClick={() => setReportOpen(false)} aria-label="Close" className="p-2 -mr-2">
                <X size={22} strokeWidth={2} />
              </button>
            </div>
            <p className="text-sm text-muted">Tell us what's wrong. We read every report.</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              maxLength={500} rows={4} placeholder="What happened?"
              className="mt-4 w-full border border-hairline rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-ink" />
            {err && <p className="mt-3 text-sm" style={{ color: "#D43A2F" }}>{err}</p>}
            {sent && <p className="mt-3 text-sm">Report sent. Thanks for telling us.</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setReportOpen(false)} disabled={sending}
                className="flex-1 py-3 rounded-full border border-ink font-semibold text-sm">
                Cancel
              </button>
              <button type="button" onClick={submitReport} disabled={sending || !reason.trim() || sent}
                className="flex-1 py-3 rounded-full text-white font-semibold text-sm disabled:opacity-60"
                style={{ background: "#D43A2F" }}>
                {sending ? "Sending…" : sent ? "Sent" : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function buildBlocks(photos: Photo[], prompts: UserPrompt[]) {
  const blocks: ({ kind: "photo"; photo: Photo } | { kind: "prompt"; up: UserPrompt } | { kind: "details" })[] = [];
  if (photos[0]) blocks.push({ kind: "photo", photo: photos[0] });
  if (prompts[0]) blocks.push({ kind: "prompt", up: prompts[0] });
  blocks.push({ kind: "details" });
  let pi = 1, qi = 1;
  while (qi < prompts.length) {
    if (photos[pi]) blocks.push({ kind: "photo", photo: photos[pi++] });
    blocks.push({ kind: "prompt", up: prompts[qi++] });
  }
  while (pi < photos.length) blocks.push({ kind: "photo", photo: photos[pi++] });
  return blocks;
}

function PhotoBlock({ photo, alt }: { photo: Photo; alt: string }) {
  return (
    <figure className="rounded-2xl overflow-hidden border border-hairline bg-tint">
      <div className="relative aspect-[4/5]">
        <Image src={thumb(photo.url, 600)} alt={alt} fill sizes="500px" className="object-cover" />
      </div>
    </figure>
  );
}

function PromptCard({ up }: { up: UserPrompt }) {
  return (
    <article className="card-line p-6">
      <p className="text-sm text-muted">{up.prompt.text}</p>
      <p className="mt-3 font-semibold text-2xl leading-snug tracking-[-0.01em]">{up.answer}</p>
    </article>
  );
}

function InfoCard({ candidate }: { candidate: DetailCandidate }) {
  const rows: { icon: React.ReactNode; label: string }[] = [];
  if (candidate.gender) rows.push({ icon: <UserIcon size={20} strokeWidth={1.75} />, label: GENDER_LABEL[candidate.gender] ?? candidate.gender });
  if (candidate.orientation) rows.push({ icon: <HeartIcon size={20} strokeWidth={1.75} />, label: ORIENTATION_LABEL[candidate.orientation] ?? candidate.orientation });
  if (candidate.intentions) rows.push({ icon: <SproutIcon size={20} strokeWidth={1.75} />, label: candidate.intentions });
  if (candidate.relationshipType) rows.push({ icon: <UsersIcon size={20} strokeWidth={1.75} />, label: candidate.relationshipType });
  if (candidate.bio) rows.push({ icon: <QuoteIcon size={20} strokeWidth={1.75} />, label: candidate.bio });

  return (
    <div className="card-line p-5">
      <div className="grid grid-cols-2 gap-3 pb-4 border-b border-hairline">
        <TopCell icon={<CakeIcon size={20} strokeWidth={1.75} />} label={candidate.age != null ? String(candidate.age) : "—"} />
        <TopCell icon={<RulerIcon size={20} strokeWidth={1.75} />} label={candidate.height ?? "—"} />
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <span className="text-ink/80 shrink-0">{r.icon}</span>
            <span className="font-medium">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopCell({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 min-w-0">
      <span className="text-ink/80 shrink-0">{icon}</span>
      <span className="font-medium text-sm truncate">{label}</span>
    </div>
  );
}
