import {AppHeader} from "@/components/app-header";
import {LoginForm} from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="shell">
      <AppHeader />
      <div className="container" style={{paddingTop: 70}}>
        <LoginForm />
      </div>
    </main>
  );
}
