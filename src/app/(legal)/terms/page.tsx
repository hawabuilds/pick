import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms of Service — Pick" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Placeholder. Replace with reviewed terms before launch — see PROJECT.md.
      </p>
      <p>
        Pick is free to play. There is no betting, staking, or wagering of any
        kind. Players make directional calls on tokenized real-world assets and
        earn points; rewards are funded by the project, not by other players.
      </p>
      <p>
        Calls are resolved against the official closing price published by our
        market-data provider, never against an on-chain token price.
      </p>
      <p>
        One account per person. Accounts created to farm rewards will be removed
        along with any unclaimed rewards.
      </p>
    </LegalPage>
  );
}
