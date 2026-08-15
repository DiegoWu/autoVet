import {AppHeader} from "@/components/app-header";
import {SignupForm} from "@/components/signup-form";

export default function SignupPage() {
  return (
    <main className="shell">
      <AppHeader />
      <div className="container" style={{paddingTop: 70}}>
        <SignupForm />
      </div>
    </main>
  );
}
