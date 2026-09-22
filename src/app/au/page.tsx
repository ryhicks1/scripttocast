import HomeView from "@/components/HomeView";

export const metadata = {
  title: "Script To Cast — Australia",
  description:
    "Turn scripts and self-tape briefs into casting breakdowns using Australian role types and Australian English.",
};

/** Australian market: AU role-type vocabulary and Australian English. */
export default function AustralianHome() {
  return <HomeView locale="au" />;
}
