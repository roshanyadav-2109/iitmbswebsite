import { redirect } from "next/navigation";

// /matches used to be a second list of the same matched people, with a
// message preview. It merged into /hooks, which now carries Matched,
// Requests and Anonymous in one place. Kept as a redirect because the
// installed PWA, push notifications and old links still point here.
export default function MatchesPage() {
  redirect("/hooks");
}
