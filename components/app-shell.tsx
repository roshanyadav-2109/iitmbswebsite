"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Shuffle, Compass, MessageSquareText, Quote, CircleUser, Download } from "lucide-react";
import { ChatListPanel } from "@/components/chat-list-panel";
import { PushPermissionPrompt } from "@/components/push-permission-prompt";

// Mobile: black bottom bar with five icon tabs (Random, Discover, Chats,
// Spill, You). Random leads because it is the primary feature. "Chats" is
// /hooks, which holds matched people, requests and saved anonymous chats
// in one list — there is no separate matches page any more.
// md+: floating vertical pill on the left with four tabs (Chats is dropped
// because lg+ shows a permanent chat list panel right next to the sidebar).
// lg+: chat list panel renders alongside the sidebar — picking a chat opens
// it in the main area.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <main className="flex-1 mx-auto w-full max-w-md pb-24 desktop:pb-6 desktop:mx-0 desktop:ml-[440px]">
        {children}
      </main>
      <SideNav />
      <ChatListPanel />
      <PushPermissionPrompt />
    </div>
  );
}

const MOBILE_TABS = [
  { href: "/random",      label: "Random",   Icon: Shuffle },
  { href: "/discover",    label: "Discover", Icon: Compass },
  { href: "/hooks",       label: "Chats",    Icon: MessageSquareText },
  { href: "/confessions", label: "Spill",    Icon: Quote },
  { href: "/me",          label: "You",      Icon: CircleUser }
];

// Desktop sidebar has no Chats tab — the chat list panel is permanent.
const DESKTOP_TABS = [
  { href: "/random",      label: "Random",   Icon: Shuffle },
  { href: "/discover",    label: "Discover", Icon: Compass },
  { href: "/hooks",       label: "Chats",    Icon: MessageSquareText },
  { href: "/confessions", label: "Spill",    Icon: Quote },
  { href: "/me",          label: "You",      Icon: CircleUser }
];

function SideNav() {
  const path = usePathname();
  // Chat takes over the screen — its own input bar sits at the bottom, so
  // hide the tab bar there.
  const hideBottomNav = path.startsWith("/chat/") || /^\/random\/[^/]+/.test(path);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    const installed =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setCanInstall(!installed);
  }, []);

  async function installApp() {
    const deferred = typeof window !== "undefined" ? window.__mismatchedInstallPrompt : null;
    if (deferred) {
      try {
        await deferred.prompt();
        await deferred.userChoice.catch(() => null);
      } catch {}
      window.__mismatchedInstallPrompt = null;
      setCanInstall(false);
    }
  }

  return (
    <>
      {/* Mobile bottom bar — shown on every touch device (and any non-fine
          pointer), regardless of viewport width. Hidden inside a chat. */}
      <nav
        className={
          "fixed bottom-0 inset-x-0 z-30 " + (hideBottomNav ? "hidden" : "desktop:hidden")
        }
        style={{
          background: "#0a0a0a",
          paddingBottom: "env(safe-area-inset-bottom)"
        }}
      >
        <div className="mx-auto max-w-md">
          <ul className="grid grid-cols-5">
            {MOBILE_TABS.map((t) => {
              const active = path === t.href || path.startsWith(`${t.href}/`);
              const Icon = t.Icon;
              return (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    aria-label={t.label}
                    className={
                      "flex items-center justify-center py-4 transition-opacity " +
                      (active ? "text-white" : "text-white/45 hover:text-white/75")
                    }
                  >
                    <Icon size={24} strokeWidth={1.75} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Desktop floating vertical sidebar — real desktops only */}
      <nav
        className="hidden desktop:flex fixed top-1/2 -translate-y-1/2 left-5 z-30 flex-col gap-1 p-2 rounded-2xl"
        style={{
          background: "#0a0a0a",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)"
        }}
        aria-label="Primary"
      >
        {DESKTOP_TABS.map((t) => {
          const active = path === t.href || path.startsWith(`${t.href}/`);
          const Icon = t.Icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-label={t.label}
              className="group relative w-12 h-12 flex items-center justify-center rounded-xl transition-colors hover:bg-white/5"
            >
              <Icon
                size={22}
                strokeWidth={1.85}
                className={
                  active
                    ? "text-white"
                    : "text-white/55 group-hover:text-white transition-colors"
                }
              />
              <span
                className="
                  absolute left-full top-1/2 -translate-y-1/2 ml-3
                  px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap text-white
                  opacity-0 -translate-x-2
                  group-hover:opacity-100 group-hover:translate-x-0
                  transition-all duration-200 ease-out
                  pointer-events-none
                "
                style={{
                  background: "#0a0a0a",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.18)"
                }}
              >
                {t.label}
              </span>
            </Link>
          );
        })}

        {canInstall && (
          <button
            type="button"
            onClick={installApp}
            aria-label="Download app"
            className="group relative w-12 h-12 flex items-center justify-center rounded-xl transition-colors hover:bg-white/5 mt-1 border-t border-white/10 pt-2"
          >
            <Download size={22} strokeWidth={1.85} className="text-white/55 group-hover:text-white transition-colors" />
            <span
              className="
                absolute left-full top-1/2 -translate-y-1/2 ml-3
                px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap text-white
                opacity-0 -translate-x-2
                group-hover:opacity-100 group-hover:translate-x-0
                transition-all duration-200 ease-out
                pointer-events-none
              "
              style={{ background: "#0a0a0a", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}
            >
              Download app
            </span>
          </button>
        )}
      </nav>
    </>
  );
}
