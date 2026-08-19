import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy Policy — Pick" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Placeholder. Replace with a reviewed policy before launch — see
        PROJECT.md.
      </p>
      <p>
        When you log in with X we store your X id, handle, display name, profile
        image URL, and account creation date. Your embedded wallet is created and
        held by Privy; we store only its public address.
      </p>
      <p>
        We store the calls you make, your scores, and your reward claims. We do
        not sell personal data.
      </p>
    </LegalPage>
  );
}
